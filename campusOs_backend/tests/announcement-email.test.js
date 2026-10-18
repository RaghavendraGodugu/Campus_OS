/**
 * Announcements by email.
 *
 * The bell and the inbox are deliberately not treated the same way. Muting a
 * notification stops the badge but never the in-app record, because the list is
 * something you can read whenever you like. An email that arrives cannot be
 * un-read, so a muted category must stop the email — and these tests exist to
 * keep that distinction from being "tidied" away.
 */

const {
  resetDatabase,
  createUser,
  createStudent,
  createDepartment,
  createProgram,
} = require("./helpers/factory");

const announcementService = require("../src/services/announcement.service");
const mailer = require("../src/services/mailer.service");
const User = require("../src/models/User");
const Announcement = require("../src/models/Announcement");
const { ROLES } = require("../src/config/constants");

/** Post one notice and return the stored announcement. */
async function notice(overrides = {}) {
  const announcement = await announcementService.createAnnouncement({
    title: "Examination schedule published",
    body: "The timetable for the end-semester examination is now available.",
    audience: { scope: "ALL" },
    // Without this the notice is scheduled rather than live, and the fan-out
    // does not run.
    publishedAt: new Date(),
    ...overrides,
    user: await createUser({ role: ROLES.DEAN }),
    req: {},
  });

  return announcement;
}

/** Everyone who was actually emailed. */
function mailedTo() {
  return mailer.readMailbox().map((entry) => entry.to);
}

describe("announcement email", () => {
  beforeEach(async () => {
    await resetDatabase();
    mailer.clearMailbox();
  });

  it("sends to nobody until an address is confirmed", async () => {
    await createStudent();

    await notice();

    // Admin-created accounts start unconfirmed, and institutional news posted to
    // an address nobody has proven belongs to them would land in a stranger's
    // inbox.
    expect(mailedTo()).toHaveLength(0);
  });

  it("sends to a confirmed address", async () => {
    const { user: student } = await createStudent();
    await User.updateOne({ _id: student._id }, { $set: { emailVerified: true } });

    await notice();

    expect(mailedTo()).toContain(student.email);
  });

  /**
   * The asymmetry, stated as a test.
   *
   * Muted means the badge is hidden and the notice still appears in the app. It
   * does not mean "and then also email it to me".
   */
  it("does not email a category the person has muted", async () => {
    const { user: student } = await createStudent();
    await User.updateOne(
      { _id: student._id },
      { $set: { emailVerified: true, "notificationPreferences.announcements": false } }
    );

    await notice();

    expect(mailedTo()).not.toContain(student.email);
  });

  it("still delivers a muted person's in-app notice, because muting is not silence", async () => {
    const { user: student } = await createStudent();
    await User.updateOne(
      { _id: student._id },
      { $set: { emailVerified: true, "notificationPreferences.announcements": false } }
    );

    const announcement = await notice();

    // The app still has it. That is the whole point of the distinction.
    const stored = await Announcement.findById(announcement._id);
    expect(stored.notifiedCount).toBeGreaterThan(0);
    expect(mailedTo()).not.toContain(student.email);
  });

  it("never sends to a deactivated account", async () => {
    const { user: student } = await createStudent();
    await User.updateOne(
      { _id: student._id },
      { $set: { emailVerified: true, isActive: false } }
    );

    await notice();

    expect(mailedTo()).not.toContain(student.email);
  });

  it("marks an urgent notice urgent in the subject line too", async () => {
    const { user: student } = await createStudent();
    await User.updateOne({ _id: student._id }, { $set: { emailVerified: true } });

    await notice({ priority: "URGENT" });

    expect(
      mailer.readMailbox().some((entry) => entry.subject.startsWith("Urgent:"))
    ).toBe(true);
  });

  it("includes a link back to the notice", async () => {
    const { user: student } = await createStudent();
    await User.updateOne({ _id: student._id }, { $set: { emailVerified: true } });

    const announcement = await notice();

    const message = mailer.readMailbox().find((entry) => entry.to === student.email);
    expect(message.text).toContain(`/announcements/${announcement.reference}`);
  });

  /**
   * A mail server having a bad day must not stop a notice reaching the campus.
   *
   * The notification is the record; the email is a convenience on top of it.
   */
  it("still delivers in-app when the mailer fails", async () => {
    const { user: student } = await createStudent();
    await User.updateOne({ _id: student._id }, { $set: { emailVerified: true } });

    const sent = mailer.send;
    mailer.send = async () => ({
      delivered: false,
      transport: "dev",
      error: "mail down",
    });

    try {
      const announcement = await notice();

      const stored = await Announcement.findById(announcement._id);
      expect(stored.notifiedCount).toBeGreaterThan(0);
    } finally {
      mailer.send = sent;
    }
  });

  /**
   * A programme notice has to be resolved through the Student collection, and
   * that path is different from every other scope. Getting it wrong made the
   * whole posting fail, not just the email — so the audience resolver is
   * exercised here for every scope rather than only the easy one.
   */
  it("handles a programme audience, which resolves through a different path", async () => {
    const department = await createDepartment();
    const bsc = await createProgram(department);
    const { user: student } = await createStudent({ department, program: bsc });
    await User.updateOne({ _id: student._id }, { $set: { emailVerified: true } });

    const announcement = await notice({
      audience: { scope: "PROGRAM", program: bsc._id.toString() },
    });

    // The posting must succeed, and the student must actually be reached.
    expect(announcement.reference).toBeTruthy();
    expect(mailedTo()).toContain(student.email);
  });

  it("records how many were emailed, which is usually fewer than the audience", async () => {
    const confirmed = await createStudent();
    await User.updateOne({ _id: confirmed.user._id }, { $set: { emailVerified: true } });
    await createStudent(); // left unconfirmed

    const announcement = await notice();

    // Three accounts are in the audience — the two students and the dean who
    // posted — but only one address has been confirmed. An admin reading this
    // number is being told who was actually reached, not how big the college is.
    const stored = await Announcement.findById(announcement._id);
    expect(stored.emailedCount).toBe(1);
    expect(stored.notifiedCount).toBe(3);
  });
});
