/**
 * Notifications and announcements.
 *
 * The backend has been writing notifications since the request workflow landed
 * and had no way to read them. These tests cover that read side, and the
 * audience rules that decide who may see an announcement at all.
 *
 * The audience tests are written as attacks rather than happy paths, because the
 * failure mode here is not "the notice is missing" but "a student reads a notice
 * addressed to faculty". One of them exists because of a bug that would have
 * shipped exactly that.
 */

const {
  getApp,
  resetDatabase,
  createUser,
  createStudent,
  createDepartment,
  createProgram,
  loginAs,
  expectError,
} = require("./helpers/factory");

const { ROLES } = require("../src/config/constants");
const Notification = require("../src/models/Notification");
const Announcement = require("../src/models/Announcement");
const notificationService = require("../src/services/notification.service");
const announcementService = require("../src/services/announcement.service");

beforeEach(resetDatabase);

/** POST/GET with the CSRF header a browser would send. */
const postAs = (agent, csrf, url, body) =>
  agent.post(url).set("X-CSRF-Token", csrf).send(body);

/** Post an announcement as an officer and return the response body. */
async function postAnnouncement(author, overrides = {}) {
  const { agent, csrfToken } = await loginAs(author);
  const res = await postAs(agent, csrfToken, "/api/v1/announcements", {
    title: "Library closure on Monday",
    body: "The central library will be closed on Monday for stock-taking.",
    ...overrides,
  });
  return { agent, csrfToken, res };
}

/** An officer entitled to post announcements. */
const officer = () => createUser({ role: ROLES.DEAN });

// ===========================================================================
// Notification read side
// ===========================================================================

describe("notifications", () => {
  /** Put one notification in a user's inbox. */
  async function seed(user, overrides = {}) {
    return Notification.create({
      user: user._id,
      type: "REQUEST_STATUS_CHANGED",
      title: "Your request moved",
      body: "A clerk picked up your request.",
      ...overrides,
    });
  }

  it("lists only the caller's own notifications", async () => {
    const alice = await createUser({ role: ROLES.HOD });
    const bob = await createUser({ role: ROLES.HOD });

    // Distinct timestamps: two notifications written in the same millisecond
    // have no defined order, so asserting one would be asserting a coin flip.
    const now = Date.now();
    await seed(alice, { title: "For Alice", createdAt: new Date(now - 2000) });
    await seed(alice, { title: "Also for Alice", createdAt: new Date(now) });
    await seed(bob, { title: "For Bob", createdAt: new Date(now) });

    const { agent } = await loginAs(alice);
    const res = await agent.get("/api/v1/notifications");

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    // Newest first.
    expect(res.body.data.map((n) => n.title)).toEqual(["Also for Alice", "For Alice"]);
    expect(res.body.data.some((n) => n.title === "For Bob")).toBe(false);
  });

  it("counts only the caller's unread", async () => {
    const alice = await createUser({ role: ROLES.HOD });
    const bob = await createUser({ role: ROLES.HOD });

    const a1 = await seed(alice);
    await seed(alice, { readAt: new Date() });
    await seed(bob);

    const { agent } = await loginAs(alice);
    const res = await agent.get("/api/v1/notifications/unread-count");

    expect(res.body.data.unread).toBe(1);
    void a1;
  });

  it("filters to unread on request", async () => {
    const alice = await createUser({ role: ROLES.HOD });
    await seed(alice, { title: "Unread one" });
    await seed(alice, { title: "Already read", readAt: new Date() });

    const { agent } = await loginAs(alice);
    const res = await agent.get("/api/v1/notifications?unreadOnly=true");

    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].title).toBe("Unread one");
  });

  it("marks one of the caller's notifications read", async () => {
    const alice = await createUser({ role: ROLES.HOD });
    const notification = await seed(alice);

    const { agent, csrfToken } = await loginAs(alice);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/notifications/${notification._id}/read`,
      {}
    );

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(true);
    expect(res.body.data.unread).toBe(0);
    expect((await Notification.findById(notification._id).lean()).readAt).not.toBeNull();
  });

  /**
   * The scoping test. `markRead` filters on both `_id` and `user`, so naming
   * someone else's notification is a no-op rather than a write into their
   * inbox.
   */
  it("will not mark another user's notification read", async () => {
    const alice = await createUser({ role: ROLES.HOD });
    const bob = await createUser({ role: ROLES.HOD });
    const bobsNotification = await seed(bob);

    const { agent, csrfToken } = await loginAs(alice);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/notifications/${bobsNotification._id}/read`,
      {}
    );

    // Not 403: reporting "unchanged" would confirm the id exists.
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(false);

    expect((await Notification.findById(bobsNotification._id).lean()).readAt).toBeNull();
  });

  it("marks only the caller's notifications read in bulk", async () => {
    const alice = await createUser({ role: ROLES.HOD });
    const bob = await createUser({ role: ROLES.HOD });
    await seed(alice);
    await seed(alice);
    const bobs = await seed(bob);

    const { agent, csrfToken } = await loginAs(alice);
    const res = await postAs(agent, csrfToken, "/api/v1/notifications/read-all", {});

    expect(res.body.data.updated).toBe(2);
    expect((await Notification.findById(bobs._id).lean()).readAt).toBeNull();
  });

  it("rejects a malformed id rather than treating it as not found", async () => {
    const alice = await createUser({ role: ROLES.HOD });
    const { agent, csrfToken } = await loginAs(alice);

    const res = await postAs(
      agent,
      csrfToken,
      "/api/v1/notifications/not-an-id/read",
      {}
    );
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const request = require("supertest");
    const res = await request(getApp()).get("/api/v1/notifications");
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// Announcements — posting
// ===========================================================================

describe("posting announcements", () => {
  it("lets an officer post to everyone and notifies them", async () => {
    const author = await officer();
    const student = await createStudent();

    const { res } = await postAnnouncement(author, {
      title: "Campus closed for the holiday",
      body: "The campus will be closed on Monday and Tuesday for the holiday.",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.announcement.reference).toMatch(/^AN-\d{4}-\d{6}$/);
    expect(res.body.data.announcement.notifiedCount).toBeGreaterThan(0);

    // The student was actually notified, not merely counted.
    const inbox = await Notification.find({ user: student.user._id }).lean();
    expect(inbox.some((n) => n.title.includes("Campus closed"))).toBe(true);
  });

  it("refuses to let a student post", async () => {
    const student = await createStudent();
    const { res } = await postAnnouncement(student.user);

    expect(res.status).toBe(403);
    expect(await Announcement.countDocuments({})).toBe(0);
  });

  it("refuses to let ordinary staff post", async () => {
    // Accounts, faculty and HOD all have ANNOUNCEMENT_READ but not MANAGE.
    for (const role of [
      ROLES.ACCOUNTS_ADMIN,
      ROLES.FACULTY,
      ROLES.HOD,
      ROLES.SUPPORT_STAFF,
    ]) {
      const user = await createUser({ role });
      const { res } = await postAnnouncement(user);
      expect(res.status).toBe(403);
    }
    expect(await Announcement.countDocuments({})).toBe(0);
  });

  it("rejects an audience whose scope has no selector", async () => {
    const author = await officer();

    // A DEPARTMENT notice with no department would address everyone.
    const { res } = await postAnnouncement(author, { audience: { scope: "DEPARTMENT" } });
    expect(res.status).toBe(400);
    // The specific reason is in the field details; the summary stays generic.
    const detail = JSON.stringify(res.body.error?.details ?? res.body.details ?? "");
    expect(detail).toMatch(/department/i);

    const { res: rolesRes } = await postAnnouncement(author, {
      audience: { scope: "ROLES" },
    });
    expect(rolesRes.status).toBe(400);

    expect(await Announcement.countDocuments({})).toBe(0);
  });

  it("rejects an expiry that precedes publication", async () => {
    const author = await officer();
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();

    const { res } = await postAnnouncement(author, {
      publishedAt: future,
      expiresAt: past,
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown field rather than storing it", async () => {
    const author = await officer();
    const { res } = await postAnnouncement(author, { isPinnedEverywhere: true });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// Announcements — who may read them
// ===========================================================================

describe("announcement audience", () => {
  it("shows an everyone-notice to every role", async () => {
    const author = await officer();
    await postAnnouncement(author, { title: "General notice for all" });

    for (const role of [ROLES.STUDENT, ROLES.FACULTY, ROLES.HOD, ROLES.ACCOUNTS_ADMIN]) {
      const user =
        role === ROLES.STUDENT
          ? (await createStudent()).user
          : await createUser({ role });
      const { agent } = await loginAs(user);
      const res = await agent.get("/api/v1/announcements");
      expect(res.body.meta.total).toBe(1);
    }
  });

  it("shows a ROLES notice only to those roles", async () => {
    const author = await officer();
    const { res } = await postAnnouncement(author, {
      title: "Accounts reconciliation window",
      body: "The month-end reconciliation runs on Saturday from 09:00.",
      audience: { scope: "ROLES", roles: [ROLES.ACCOUNTS_ADMIN] },
    });
    const reference = res.body.data.announcement.reference;

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const faculty = await createUser({ role: ROLES.FACULTY });
    const student = await createStudent();

    const accountsRes = await (
      await loginAs(accounts)
    ).agent.get("/api/v1/announcements");
    expect(accountsRes.body.meta.total).toBe(1);

    const facultyRes = await (await loginAs(faculty)).agent.get("/api/v1/announcements");
    expect(facultyRes.body.meta.total).toBe(0);

    const studentRes = await (
      await loginAs(student.user)
    ).agent.get("/api/v1/announcements");
    expect(studentRes.body.meta.total).toBe(0);

    void reference;
  });

  it("shows a DEPARTMENT notice only to that department", async () => {
    const cse = await createDepartment();
    const ece = await createDepartment();

    const author = await officer();
    const { res } = await postAnnouncement(author, {
      title: "CSE departmental board",
      body: "The departmental board meets on Wednesday to review the curriculum.",
      audience: { scope: "DEPARTMENT", department: cse._id.toString() },
    });
    const reference = res.body.data.announcement.reference;

    const inCse = await createUser({ role: ROLES.FACULTY, department: cse });
    const inEce = await createUser({ role: ROLES.FACULTY, department: ece });

    const cseRes = await (await loginAs(inCse)).agent.get("/api/v1/announcements");
    expect(cseRes.body.meta.total).toBe(1);

    const eceRes = await (await loginAs(inEce)).agent.get("/api/v1/announcements");
    expect(eceRes.body.meta.total).toBe(0);

    // Direct fetch by reference is filtered by the same rule as the list.
    const direct = await (
      await loginAs(inEce)
    ).agent.get(`/api/v1/announcements/${reference}`);
    expectError(direct, 404, "NOT_FOUND");
  });

  it("shows a PROGRAM notice only to students in that programme", async () => {
    const dept = await createDepartment();
    const bsc = await createProgram(dept);
    const msc = await createProgram(dept);

    const author = await officer();
    const { res } = await postAnnouncement(author, {
      title: "BSc registration opens",
      body: "Course registration for the BSc programme opens on Monday morning.",
      audience: { scope: "PROGRAM", program: bsc._id.toString() },
    });
    const reference = res.body.data.announcement.reference;

    const inBsc = await createStudent({ department: dept, program: bsc });
    const inMsc = await createStudent({ department: dept, program: msc });

    const bscRes = await (await loginAs(inBsc.user)).agent.get("/api/v1/announcements");
    expect(bscRes.body.meta.total).toBe(1);

    const mscRes = await (await loginAs(inMsc.user)).agent.get("/api/v1/announcements");
    expect(mscRes.body.meta.total).toBe(0);

    const direct = await (
      await loginAs(inMsc.user)
    ).agent.get(`/api/v1/announcements/${reference}`);
    expectError(direct, 404, "NOT_FOUND");
  });

  /**
   * Regression guard for a leak the audience query would have opened.
   *
   * A viewer with no department must contribute no department clause at all. If
   * it contributed `{ "audience.department": null }`, it would match every
   * DEPARTMENT announcement that failed to name one — and, since the schema
   * permits such a record to exist in the database even though it refuses to
   * create one now, that is a real widening rather than a theoretical one.
   *
   * A student is the natural case: their department lives on the Student
   * profile, so a user record with it unset is entirely normal.
   */
  it("does not let a viewer with no department match a department notice", async () => {
    const dept = await createDepartment();
    const author = await officer();

    const posted = await postAnnouncement(author, {
      title: "CSE only",
      body: "This notice names a department and must not reach anyone else.",
      audience: { scope: "DEPARTMENT", department: dept._id.toString() },
    });

    // A viewer whose user record carries no department at all.
    const detached = await createUser({ role: ROLES.FACULTY });
    expect(detached.department ?? null).toBeNull();

    const { agent } = await loginAs(detached);
    const res = await agent.get("/api/v1/announcements");

    expect(res.body.meta.total).toBe(0);
    const direct = await agent.get(
      `/api/v1/announcements/${posted.res.body.data.announcement.reference}`
    );
    expectError(direct, 404, "NOT_FOUND");
  });

  /**
   * The guard itself, asserted on the query rather than on its symptoms.
   *
   * A viewer with no department must contribute no department clause. Emitting
   * `{ "audience.department": null }` instead would match every DEPARTMENT
   * announcement that failed to name one — the exact widening this prevents.
   */
  it("builds no department clause for a viewer who has no department", async () => {
    const viewer = {
      _id: "507f1f77bcf86cd799439011",
      role: ROLES.FACULTY,
      department: null,
    };

    const query = await announcementService.audienceQueryFor(viewer);

    expect(query.$or.some((clause) => "audience.department" in clause)).toBe(false);
    // The branches the viewer *can* satisfy are still present.
    expect(query.$or.some((clause) => clause["audience.scope"] === "ALL")).toBe(true);
    expect(query.$or.some((clause) => clause["audience.scope"] === "ROLES")).toBe(true);
  });

  it("builds no programme clause for a viewer who has no programme", async () => {
    const viewer = {
      _id: "507f1f77bcf86cd799439011",
      role: ROLES.FACULTY,
      department: null,
    };

    const query = await announcementService.audienceQueryFor(viewer);

    expect(query.$or.some((clause) => "audience.program" in clause)).toBe(false);
  });

  it("builds no audience filter at all for an announcement manager", async () => {
    const manager = await createUser({ role: ROLES.PRINCIPAL });
    const query = await announcementService.audienceQueryFor(manager);

    // null means "no filter": managers must be able to see the whole archive.
    expect(query).toBeNull();
  });

  it("lets an announcement manager see notices outside their own audience", async () => {
    const author = await officer();
    const { res } = await postAnnouncement(author, {
      title: "Accounts only notice",
      body: "This notice is addressed to the accounts department alone.",
      audience: { scope: "ROLES", roles: [ROLES.ACCOUNTS_ADMIN] },
    });

    // A second officer, who is not accounts staff, still manages the archive.
    const otherOfficer = await createUser({ role: ROLES.PRINCIPAL });
    const { agent } = await loginAs(otherOfficer);
    const list = await agent.get("/api/v1/announcements");
    expect(list.body.meta.total).toBe(1);

    const direct = await agent.get(
      `/api/v1/announcements/${res.body.data.announcement.reference}`
    );
    expect(direct.status).toBe(200);
  });

  it("notifies only the audience, not the whole college", async () => {
    const cse = await createDepartment();
    const ece = await createDepartment();
    const inCse = await createUser({ role: ROLES.FACULTY, department: cse });
    const inEce = await createUser({ role: ROLES.FACULTY, department: ece });

    await postAnnouncement(await officer(), {
      title: "CSE notice",
      body: "Only the CSE department should see this notification.",
      audience: { scope: "DEPARTMENT", department: cse._id.toString() },
    });

    const cseInbox = await Notification.find({ user: inCse._id }).lean();
    const eceInbox = await Notification.find({ user: inEce._id }).lean();

    expect(cseInbox.length).toBe(1);
    expect(eceInbox.length).toBe(0);
  });
});

// ===========================================================================
// Announcements — lifecycle
// ===========================================================================

describe("announcement lifecycle", () => {
  it("keeps a scheduled notice hidden until it is due", async () => {
    const author = await officer();
    const student = await createStudent();

    await postAnnouncement(author, {
      title: "Future notice",
      body: "This notice is scheduled for tomorrow and is not live yet.",
      publishedAt: new Date(Date.now() + 86400000).toISOString(),
    });

    const { agent } = await loginAs(student.user);
    const res = await agent.get("/api/v1/announcements");

    expect(res.body.meta.total).toBe(0);
    // And nobody was disturbed by it yet.
    expect(await Notification.countDocuments({ user: student.user._id })).toBe(0);
  });

  it("hides a notice once it expires", async () => {
    const author = await officer();
    const student = await createStudent();

    const { res } = await postAnnouncement(author, {
      title: "Short-lived notice",
      body: "This notice expires almost immediately after being posted.",
      expiresAt: new Date(Date.now() + 50).toISOString(),
    });
    const reference = res.body.data.announcement.reference;

    await new Promise((resolve) => setTimeout(resolve, 120));

    const { agent } = await loginAs(student.user);
    const list = await agent.get("/api/v1/announcements");
    expect(list.body.meta.total).toBe(0);

    const direct = await agent.get(`/api/v1/announcements/${reference}`);
    expectError(direct, 404, "NOT_FOUND");
  });

  it("archives without deleting, and stops listing it", async () => {
    const author = await officer();
    const student = await createStudent();

    const posted = await postAnnouncement(author, {
      title: "Notice to be withdrawn",
      body: "This notice is about to be withdrawn by an officer.",
    });
    const reference = posted.res.body.data.announcement.reference;

    const { agent, csrfToken } = await loginAs(author);
    const archiveRes = await postAs(
      agent,
      csrfToken,
      `/api/v1/announcements/${reference}/archive`,
      {}
    );

    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.data.announcement.status).toBe("ARCHIVED");

    // Kept, not destroyed — an archived notice is still an audit record.
    expect(await Announcement.countDocuments({ reference })).toBe(1);

    const reader = await loginAs(student.user);
    const list = await reader.agent.get("/api/v1/announcements");
    expect(list.body.meta.total).toBe(0);

    const direct = await reader.agent.get(`/api/v1/announcements/${reference}`);
    expectError(direct, 404, "NOT_FOUND");
  });

  it("refuses to archive twice", async () => {
    const author = await officer();
    const posted = await postAnnouncement(author, {
      title: "Notice archived once",
      body: "Archiving this notice a second time should be refused.",
    });
    const reference = posted.res.body.data.announcement.reference;

    const { agent, csrfToken } = await loginAs(author);
    expect(
      (await postAs(agent, csrfToken, `/api/v1/announcements/${reference}/archive`, {}))
        .status
    ).toBe(200);

    const second = await postAs(
      agent,
      csrfToken,
      `/api/v1/announcements/${reference}/archive`,
      {}
    );
    expectError(second, 409, "CONFLICT");
  });

  it("pins a notice to the top of the list", async () => {
    const author = await officer();
    const student = await createStudent();

    await postAnnouncement(author, {
      title: "Older routine notice",
      body: "A routine notice posted earlier.",
    });
    const pinned = await postAnnouncement(author, {
      title: "Pinned urgent notice",
      body: "This notice should sit above the routine one.",
      pinned: true,
    });
    const reference = pinned.res.body.data.announcement.reference;

    const { agent, csrfToken } = await loginAs(author);
    expect(
      (
        await postAs(agent, csrfToken, `/api/v1/announcements/${reference}/pin`, {
          pinned: true,
        })
      ).status
    ).toBe(200);

    const { agent: reader } = await loginAs(student.user);
    const res = await reader.get("/api/v1/announcements");

    expect(res.body.data[0].title).toBe("Pinned urgent notice");
    expect(res.body.data[0].pinned).toBe(true);
  });

  it("refuses a malformed reference", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent } = await loginAs(user);
    const res = await agent.get("/api/v1/announcements/not-a-reference");
    expect(res.status).toBe(400);
  });

  it("404s an unknown reference rather than 500ing", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent } = await loginAs(user);
    const res = await agent.get("/api/v1/announcements/AN-2026-999999");
    expectError(res, 404, "NOT_FOUND");
  });
});

// ===========================================================================
// Announcements — fan-out
// ===========================================================================

describe("announcement fan-out", () => {
  /**
   * Fan-out must be resumable. `notifyMany` dedupes per recipient, so topping up
   * a truncated send adds only what is missing — which is what makes it safe to
   * run the sweep again rather than leaving part of the college uninformed.
   */
  it("does not duplicate notifications when re-run", async () => {
    const author = await officer();
    const posted = await postAnnouncement(author, {
      title: "Notice sent twice",
      body: "The fan-out for this notice is deliberately run a second time.",
    });

    const announcement = await Announcement.findOne({
      reference: posted.res.body.data.announcement.reference,
    });
    const before = await Notification.countDocuments({ type: "ANNOUNCEMENT" });

    await announcementService.fanOut({ announcement });

    const after = await Notification.countDocuments({ type: "ANNOUNCEMENT" });
    expect(after).toBe(before);
  });

  it("records how many inboxes were notified", async () => {
    const author = await officer();
    const posted = await postAnnouncement(author, {
      title: "Notice with a recorded count",
      body: "The number of notified inboxes is recorded on the announcement.",
    });

    const announcement = await Announcement.findOne({
      reference: posted.res.body.data.announcement.reference,
    });

    expect(announcement.notifiedCount).toBeGreaterThan(0);
    // Nobody was missed, so this must not claim a truncation.
    expect(announcement.fanOutTruncated).toBe(false);
  });

  it("marks a priority urgent in the notification title", async () => {
    const author = await officer();
    const student = await createStudent();

    await postAnnouncement(author, {
      title: "Water supply interrupted",
      body: "Water supply will be interrupted across campus this afternoon.",
      priority: "URGENT",
    });

    const inbox = await Notification.find({ user: student.user._id }).lean();
    expect(inbox.some((n) => n.title.startsWith("Urgent:"))).toBe(true);
  });

  it("never exceeds the notification body cap, however long the notice", async () => {
    const author = await officer();
    const student = await createStudent();

    await postAnnouncement(author, {
      title: "Very long notice",
      body: "Exhaustive detail. ".repeat(250),
    });

    const inbox = await Notification.find({ user: student.user._id }).lean();
    expect(inbox.length).toBe(1);
    expect(inbox[0].body.length).toBeLessThanOrEqual(500);
  });
});

// ===========================================================================
// The read service itself
// ===========================================================================

describe("notification service read helpers", () => {
  it("returns an empty page rather than failing when a user has none", async () => {
    const user = await createUser({ role: ROLES.FACULTY });

    const result = await notificationService.listForUser({ userId: user._id.toString() });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(await notificationService.unreadCount(user._id.toString())).toBe(0);
  });
});
