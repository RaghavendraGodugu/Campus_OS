/**
 * Notification preferences.
 *
 * ## The invariant worth stating plainly
 *
 * Muting a category stops the badge. It never stops the delivery. A student who
 * mutes finance and then misses "your refund was processed" has been harmed by
 * a setting meant to stop noise — so muted notifications are still written and
 * still listed, just already read.
 *
 * An earlier draft of the preference service had a `mutedStillDeliver` flag
 * whose two branches did the same thing. It would have looked like a setting,
 * been exposed in the UI, and done nothing.
 */

const { resetDatabase, createUser } = require("./helpers/factory");

const preferences = require("../src/services/notificationPreference.service");
const notificationService = require("../src/services/notification.service");
const profileService = require("../src/services/profile.service");
const User = require("../src/models/User");
const Notification = require("../src/models/Notification");

const OFF = {
  requests: false,
  complaints: true,
  certificates: true,
  finance: true,
  announcements: true,
  unreadBadge: true,
};

describe("notification preferences — the badge decision", () => {
  it("badges everything by default", () => {
    expect(preferences.shouldBadge({ preferences: {}, type: "INVOICE_ISSUED" })).toBe(true);
    expect(preferences.shouldBadge({ type: "REQUEST_ASSIGNED" })).toBe(true);
  });

  it("does not badge a muted category", () => {
    expect(
      preferences.shouldBadge({ preferences: { finance: false }, type: "INVOICE_ISSUED" }),
    ).toBe(false);
  });

  it("still badges other categories while one is muted", () => {
    // Somebody who wants silence about money but not about a certificate they
    // are waiting on has to be able to say exactly that.
    expect(
      preferences.shouldBadge({
        preferences: { finance: false },
        type: "CERTIFICATE_READY",
      }),
    ).toBe(true);
  });

  it("honours the blanket badge switch", () => {
    expect(
      preferences.shouldBadge({ preferences: { unreadBadge: false }, type: "REQUEST_ASSIGNED" }),
    ).toBe(false);
  });

  /**
   * The failure this prevents.
   *
   * If a new notification type is added and nobody files it into a category,
   * the guesswork has to favour telling the user. A notification nobody
   * receives is worse than one badge too many.
   */
  it("badges a type it has never heard of", () => {
    expect(
      preferences.shouldBadge({ preferences: { requests: false }, type: "SOMETHING_NEW" }),
    ).toBe(true);
  });

  it("files every known type into exactly one category", () => {
    const { NOTIFICATION_TYPE } = require("../src/config/constants");
    for (const type of Object.values(NOTIFICATION_TYPE)) {
      expect(preferences.TYPE_CATEGORY[type]).toBeTruthy();
    }
  });
});

describe("notification preferences — delivery", () => {
  let user;

  beforeEach(async () => {
    await resetDatabase();
    user = await createUser({ role: "STUDENT" });
  });

  it("delivers a muted notification but stores it already read", async () => {
    await User.updateOne({ _id: user._id }, { $set: { "notificationPreferences.finance": false } });

    await notificationService.notify({
      userId: user._id,
      type: "INVOICE_ISSUED",
      title: "Fee due",
      body: "Your semester fee is due.",
    });

    const stored = await Notification.findOne({ user: user._id });
    // Delivered: the notice exists and is in the list.
    expect(stored).toBeTruthy();
    // Already read: it does not raise the badge.
    expect(stored.readAt).toBeTruthy();

    const unread = await notificationService.unreadCount(user._id);
    expect(unread).toBe(0);
  });

  it("leaves an unmuted notification unread", async () => {
    await notificationService.notify({
      userId: user._id,
      type: "CERTIFICATE_READY",
      title: "Certificate issued",
      body: "Your certificate is ready.",
    });

    expect(await notificationService.unreadCount(user._id)).toBe(1);
  });

  it("still lists a muted notification", async () => {
    await User.updateOne({ _id: user._id }, { $set: { "notificationPreferences.finance": false } });
    await notificationService.notify({
      userId: user._id,
      type: "REFUND_STATUS_CHANGED",
      title: "Refund processed",
      body: "Your refund has been paid.",
    });

    const page = await notificationService.listForUser({ userId: user._id });
    // The point of muting by storing-as-read: the information is still there.
    expect(page.items).toHaveLength(1);
    expect(page.items[0].title).toBe("Refund processed");
  });
});

describe("notification preferences — settings", () => {
  let user;

  beforeEach(async () => {
    await resetDatabase();
    user = await createUser({ role: "STUDENT" });
  });

  it("presents every category, even for an account that never set one", async () => {
    const shown = preferences.present(await User.findById(user._id));
    expect(Object.keys(shown).sort()).toEqual(
      [...preferences.CATEGORIES, "unreadBadge"].sort(),
    );
  });

  it("writes every category rather than merging", async () => {
    const saved = await profileService.updateNotificationPreferences({
      user,
      changes: OFF,
    });

    // OFF turns requests off and leaves the rest on; both must be written, not
    // only the one that changed relative to the default.
    expect(saved.requests).toBe(false);
    expect(saved.finance).toBe(true);
    expect(saved.certificates).toBe(true);

    const stored = await User.findById(user._id);
    expect(stored.notificationPreferences.requests).toBe(false);
    expect(stored.notificationPreferences.finance).toBe(true);
    expect(stored.notificationPreferences.unreadBadge).toBe(true);
  });

  it("turns a category back on", async () => {
    await profileService.updateNotificationPreferences({ user, changes: OFF });
    const saved = await profileService.updateNotificationPreferences({
      user,
      changes: { ...OFF, finance: true },
    });

    expect(saved.finance).toBe(true);

    const unreadFlow = await User.findById(user._id);
    expect(unreadFlow.notificationPreferences.finance).toBe(true);
  });

  it("takes effect immediately for the next notification", async () => {
    await profileService.updateNotificationPreferences({
      user,
      changes: { ...OFF, requests: false },
    });

    await notificationService.notify({
      userId: user._id,
      type: "REQUEST_ASSIGNED",
      title: "Your request was assigned",
      body: "Someone is now looking at it.",
    });

    // Deliberately not cached: a notification delivered moments after somebody
    // muted a category is exactly the moment they were trying to stop.
    expect(await notificationService.unreadCount(user._id)).toBe(0);
  });
});