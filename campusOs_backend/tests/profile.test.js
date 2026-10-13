/**
 * Profile.
 *
 * The whole point of this feature is the boundary: what a person may change
 * about themselves, and what the institution keeps. Most of these tests are
 * refusals.
 */

const {
  getApp,
  resetDatabase,
  createUser,
  createStudent,
  loginAs,
} = require("./helpers/factory");

const { ROLES } = require("../src/config/constants");

beforeEach(resetDatabase);

const patchAs = (agent, csrf, body) =>
  agent.patch("/api/v1/profile").set("X-CSRF-Token", csrf).send(body);

describe("reading a profile", () => {
  it("returns the caller's own profile", async () => {
    const user = await createUser({ role: ROLES.HOD, fullName: "Priya Sharma" });
    const { agent } = await loginAs(user);

    const res = await agent.get("/api/v1/profile");

    expect(res.status).toBe(200);
    expect(res.body.data.user.fullName).toBe("Priya Sharma");
    expect(res.body.data.user.email).toBe(user.email);
  });

  it("includes the academic record for a student, read-only", async () => {
    const student = await createStudent();
    const { agent } = await loginAs(student.user);

    const res = await agent.get("/api/v1/profile");

    expect(res.body.data.student.rollNumber).toBe(student.student.rollNumber);
    expect(res.body.data.student.program).not.toBeNull();
    // The point of including them: a profile that hides the roll number makes
    // people ask, and asking lands in a support queue.
    expect(res.body.data.user.role).toBe(ROLES.STUDENT);
  });

  it("includes no student record for staff", async () => {
    const user = await createUser({ role: ROLES.HOD });
    const { agent } = await loginAs(user);

    const res = await agent.get("/api/v1/profile");

    expect(res.body.data.student).toBeNull();
  });

  it("states what is editable rather than leaving the client to guess", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent } = await loginAs(user);

    const res = await agent.get("/api/v1/profile");

    expect(res.body.data.editableFields).toEqual(["fullName", "phone"]);
  });

  it("never returns the password hash", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent } = await loginAs(user);

    const body = JSON.stringify((await agent.get("/api/v1/profile")).body);
    expect(body).not.toContain("passwordHash");
  });

  it("requires a session", async () => {
    const request = require("supertest");
    expect((await request(getApp()).get("/api/v1/profile")).status).toBe(401);
  });

  it("takes no user id, so another profile cannot be named", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent } = await loginAs(user);

    // There is no /profile/:id route at all.
    expect((await agent.get("/api/v1/profile/some-user-id")).status).toBe(404);
  });
});

describe("updating a profile", () => {
  it("changes the display name and phone", async () => {
    const user = await createUser({ role: ROLES.FACULTY, fullName: "Old Name" });
    const { agent, csrfToken } = await loginAs(user);

    const res = await patchAs(agent, csrfToken, {
      fullName: "New Name",
      phone: "+91 98765 43210",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.user.fullName).toBe("New Name");
    expect(res.body.data.user.phone).toBe("+91 98765 43210");
  });

  /**
   * The boundary the feature exists to hold.
   *
   * A student's programme, roll number and semester are their academic identity,
   * not their profile. Letting them edit those would let a student move
   * themselves to another programme.
   */
  it("refuses to let a student change their academic record", async () => {
    const student = await createStudent();
    const { agent, csrfToken } = await loginAs(student.user);

    const res = await patchAs(agent, csrfToken, {
      rollNumber: "HACKED001",
      semester: 9,
      program: "6acb6bdc304551b7a6e31399",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot change/i);

    const fresh = await agent.get("/api/v1/profile");
    expect(fresh.body.data.student.rollNumber).toBe(student.student.rollNumber);
  });

  it("refuses to let anyone change their own role or email", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent, csrfToken } = await loginAs(user);

    const res = await patchAs(agent, csrfToken, {
      role: ROLES.SUPER_ADMIN,
      email: "attacker@elsewhere.test",
    });

    expect(res.status).toBe(400);
    // An email is the login identifier and the recovery route: changing it
    // through a form turns account takeover into a submission.
    expect(res.body.message).toMatch(/cannot change/i);

    const me = await agent.get("/api/v1/auth/me");
    expect(me.body.data.user.role).toBe(ROLES.FACULTY);
    expect(me.body.data.user.email).toBe(user.email);
  });

  it("names the field it refused, so the error is actionable", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent, csrfToken } = await loginAs(user);

    const res = await patchAs(agent, csrfToken, { role: ROLES.DEAN });

    expect(res.body.message).toMatch(/role/);
  });

  it("rejects an implausible name", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent, csrfToken } = await loginAs(user);

    expect((await patchAs(agent, csrfToken, { fullName: "x" })).status).toBe(400);
    expect((await patchAs(agent, csrfToken, { fullName: "a".repeat(200) })).status).toBe(
      400
    );
  });

  it("rejects a phone number that is not one", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent, csrfToken } = await loginAs(user);

    const res = await patchAs(agent, csrfToken, { phone: "not a phone number!!" });
    expect(res.status).toBe(400);
  });

  it("requires CSRF", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent } = await loginAs(user);

    const res = await agent.patch("/api/v1/profile").send({ fullName: "No CSRF" });
    expect(res.status).toBe(403);
  });

  it("records who changed what, without the values", async () => {
    const AuditLog = require("../src/models/AuditLog");
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent, csrfToken } = await loginAs(user);

    await patchAs(agent, csrfToken, { phone: "+91 90000 00000" });

    const entry = await AuditLog.findOne({ actor: user._id, action: "UPDATE" });
    expect(entry).not.toBeNull();
    // The field names, never the values: a phone number is personal data and
    // the audit trail is read by people who do not need it.
    expect(entry.metadata.fields).toEqual(["phone"]);
    expect(JSON.stringify(entry.metadata)).not.toContain("90000");
  });
});

describe("changing a password from the profile", () => {
  it("accepts a strong replacement and refuses a weak one", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent, csrfToken } = await loginAs(user);

    const weak = await agent
      .post("/api/v1/profile/change-password")
      .set("X-CSRF-Token", csrfToken)
      .send({ currentPassword: "TestPass123!", newPassword: "short" });
    expect(weak.status).toBe(400);

    const strong = await agent
      .post("/api/v1/profile/change-password")
      .set("X-CSRF-Token", csrfToken)
      .send({ currentPassword: "TestPass123!", newPassword: "NewPassphrase2026x" });
    expect(strong.status).toBe(200);
  });

  it("refuses the wrong current password", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent, csrfToken } = await loginAs(user);

    const res = await agent
      .post("/api/v1/profile/change-password")
      .set("X-CSRF-Token", csrfToken)
      .send({ currentPassword: "NotMyPassword1", newPassword: "NewPassphrase2026x" });

    expect(res.status).toBe(401);
  });
});

describe("signing out everywhere", () => {
  it("revokes the other sessions", async () => {
    const User = require("../src/models/User");
    const user = await createUser({ role: ROLES.FACULTY });

    // Two extra devices, so there is something to revoke.
    await loginAs(user);
    await loginAs(user);

    const before = await User.findById(user._id).lean();
    const liveBefore = (before.refreshTokens ?? []).filter((t) => !t.revokedAt).length;
    expect(liveBefore).toBeGreaterThan(1);

    const { agent, csrfToken } = await loginAs(user);
    const res = await agent
      .post("/api/v1/profile/sign-out-everywhere")
      .set("X-CSRF-Token", csrfToken)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/every other device/i);

    const after = await User.findById(user._id).lean();
    expect((after.refreshTokens ?? []).every((t) => Boolean(t.revokedAt))).toBe(true);
    expect(after.sessionsInvalidatedAt).not.toBeNull();
  });

  it("requires CSRF, since it revokes sessions", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { agent } = await loginAs(user);

    const res = await agent.post("/api/v1/profile/sign-out-everywhere").send({});
    expect(res.status).toBe(403);
  });
});
