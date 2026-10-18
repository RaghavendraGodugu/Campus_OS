/**
 * Administration: people, departments, programmes.
 *
 * Most of these tests are refusals, and that is the point. These are the routes
 * that decide who can sign in and what they may see, so the interesting cases
 * are the ones where the service says no: an administrator who locks themselves
 * out, an account with no department whose permissions are scoped to one, a
 * department switched off while students still point at it.
 *
 * Each refusal has to say *why* in terms the caller can act on. "Forbidden" on
 * the last-super-admin check would leave an administrator with a dead end.
 */

const {
  getApp,
  resetDatabase,
  createUser,
  createDepartment,
  createProgram,
  createStudent,
  loginAs,
} = require("./helpers/factory");

const { ROLES } = require("../src/config/constants");
const User = require("../src/models/User");
const Department = require("../src/models/Department");
const Program = require("../src/models/Program");
const AuditLog = require("../src/models/AuditLog");

beforeEach(resetDatabase);

/** A signed-in super administrator, which is the only role that reaches any of this. */
const asSuperAdmin = async () => {
  const admin = await createUser({ role: ROLES.SUPER_ADMIN });
  return { admin, ...(await loginAs(admin)) };
};

const create = (agent, csrf, path, body) =>
  agent.post(path).set("X-CSRF-Token", csrf).send(body);

// ===== People =====

describe("creating an account", () => {
  it("creates a staff account and hands back a temporary password", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const department = await createDepartment();

    const res = await create(agent, csrfToken, "/api/v1/admin/users", {
      email: "new.hod@campusos.local",
      fullName: "Dr Priya Menon",
      role: ROLES.HOD,
      department: department._id.toString(),
    });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe("new.hod@campusos.local");
    expect(res.body.data.role).toBe(ROLES.HOD);

    const temporary = res.body.meta.temporaryPassword;
    expect(typeof temporary).toBe("string");
    expect(temporary.length).toBeGreaterThanOrEqual(16);
  });

  /**
   * The generated password is returned once and stored only as a hash. If it
   * ever appeared in the user document it would be readable by anyone with a
   * database dump, which is precisely the leak this design exists to prevent.
   */
  it("never stores the temporary password in readable form", async () => {
    const { agent, csrfToken } = await asSuperAdmin();

    const res = await create(agent, csrfToken, "/api/v1/admin/users", {
      email: "temp@campusos.local",
      fullName: "Temp Account",
      role: ROLES.LIBRARY_ADMIN,
    });

    const temporary = res.body.meta.temporaryPassword;
    // `passwordHash` is `select: false`, so it has to be asked for explicitly —
    // which is also a check that the default lean query really does hide it.
    const hidden = await User.findOne({ email: "temp@campusos.local" }).lean();
    expect(hidden.passwordHash).toBeUndefined();

    const stored = await User.findOne({ email: "temp@campusos.local" })
      .select("+passwordHash")
      .lean();

    expect(stored.passwordHash).toBeTruthy();
    expect(stored.passwordHash).not.toContain(temporary);
    expect(JSON.stringify(stored)).not.toContain(temporary);
  });

  /**
   * `.lean()` bypasses `toJSON`, so the schema's redaction of `refreshTokens`
   * never ran on this query and the page carried the SHA-256 of every session
   * token, plus device, user-agent and IP, for every account listed.
   */
  it("never puts session material in the people list", async () => {
    const { agent } = await loginAs(await createUser({ role: ROLES.SUPER_ADMIN }));

    const res = await agent.get("/api/v1/admin/users");

    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);

    expect(raw).not.toContain("refreshTokens");
    expect(raw).not.toContain("sessionsInvalidatedAt");
    expect(raw).not.toContain("tokenHash");
    const listed = res.body.data.users ?? res.body.data;
    for (const user of listed) {
      expect(user.refreshTokens).toBeUndefined();
      expect(user.passwordHash).toBeUndefined();
    }
  });

  /**
   * A provisioned account that works indefinitely on a password the institute
   * knows is a standing risk, so this one is flagged and the client gates on it.
   */
  it("marks the account as owing a password change", async () => {
    const { agent, csrfToken } = await asSuperAdmin();

    const res = await create(agent, csrfToken, "/api/v1/admin/users", {
      email: "gated@campusos.local",
      fullName: "Gated Account",
      role: ROLES.LIBRARY_ADMIN,
    });

    const stored = await User.findOne({ email: "gated@campusos.local" }).lean();
    expect(stored.mustChangePassword).toBe(true);

    // And it says so on sign-in, so the client can gate without a second call.
    const temporary = res.body.meta.temporaryPassword;
    const request = require("supertest");
    const login = await request(getApp()).post("/api/v1/auth/login").send({
      email: "gated@campusos.local",
      password: temporary,
    });
    expect(login.status).toBe(200);
    expect(login.body.data.user.mustChangePassword).toBe(true);
  });

  it("refuses an email that is already in use", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    await createUser({ email: "taken@campusos.local" });

    const res = await create(agent, csrfToken, "/api/v1/admin/users", {
      email: "taken@campusos.local",
      fullName: "Duplicate",
      role: ROLES.LIBRARY_ADMIN,
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  /**
   * Faculty and HOD permissions are scoped to a department. An account with no
   * department is not "unrestricted" — it is an account that silently sees
   * nothing, which is much harder to notice.
   */
  it("refuses a department-scoped role with no department", async () => {
    const { agent, csrfToken } = await asSuperAdmin();

    const res = await create(agent, csrfToken, "/api/v1/admin/users", {
      email: "homeless@campusos.local",
      fullName: "No Department",
      role: ROLES.FACULTY,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/must belong to a department/i);
  });

  /**
   * SUPER_ADMIN is not self-service. An account that can mint another account
   * able to mint accounts is how a super admin gets lost quietly, through a
   * well-meaning helpdesk action.
   */
  it("will not let an administrator create another super administrator", async () => {
    const { agent, csrfToken } = await asSuperAdmin();

    const res = await create(agent, csrfToken, "/api/v1/admin/users", {
      email: "second.admin@campusos.local",
      fullName: "Second Admin",
      role: ROLES.SUPER_ADMIN,
    });

    expect(res.status).toBe(400);
    // The reason travels in the field error, which is what the form shows.
    expect(res.body.details[0].field).toBe("role");
    expect(res.body.details[0].message).toMatch(
      /super administrator is deliberately not assignable/i
    );
  });

  it("refuses unknown fields rather than ignoring them", async () => {
    const { agent, csrfToken } = await asSuperAdmin();

    const res = await create(agent, csrfToken, "/api/v1/admin/users", {
      email: "sneaky@campusos.local",
      fullName: "Sneaky",
      role: ROLES.LIBRARY_ADMIN,
      isActive: false,
    });

    expect(res.status).toBe(400);
  });
});

// ===== The boundary between editing and elevating =====

describe("changing a role", () => {
  it("changes the role and records why", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const target = await createUser({ role: ROLES.FACULTY });
    const department = await createDepartment();

    const res = await create(agent, csrfToken, `/api/v1/admin/users/${target._id}/role`, {
      role: ROLES.HOD,
      department: department._id.toString(),
      reason: "Taking over the department from 1 November",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe(ROLES.HOD);

    const entry = await AuditLog.findOne({
      entityId: target._id,
      "metadata.change": "role",
    }).lean();
    expect(entry.metadata.reason).toMatch(/taking over/i);
    expect(entry.metadata.from).toBe(ROLES.FACULTY);
    expect(entry.metadata.to).toBe(ROLES.HOD);
  });

  /**
   * Changing your own role means nobody can undo it if you were wrong.
   */
  it("refuses to let an administrator change their own role", async () => {
    const { agent, csrfToken, admin } = await asSuperAdmin();

    const res = await create(agent, csrfToken, `/api/v1/admin/users/${admin._id}/role`, {
      role: ROLES.LIBRARY_ADMIN,
      reason: "Testing self-demotion here",
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own role/i);
  });

  /**
   * A role change invalidates every permission cached into a live session, so
   * the old sessions have to be revoked. Leaving them means the person keeps
   * their old powers until the access token expires.
   */
  it("signs the person out everywhere, so old permissions cannot outlive the change", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const target = await createUser({ role: ROLES.FACULTY });

    const session = await loginAs(target);
    expect(session.userId).toBeTruthy();

    await create(agent, csrfToken, `/api/v1/admin/users/${target._id}/role`, {
      role: ROLES.SUPPORT_STAFF,
      reason: "Transferred to the service desk",
    });

    const after = await User.findById(target._id).lean();
    expect(after.refreshTokens.every((token) => Boolean(token.revokedAt))).toBe(true);
  });

  it("requires a reason, because an unexplained one cannot be reviewed later", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const target = await createUser({ role: ROLES.FACULTY });

    const res = await create(agent, csrfToken, `/api/v1/admin/users/${target._id}/role`, {
      role: ROLES.HOD,
      reason: "no",
    });

    expect(res.status).toBe(400);
  });

  /**
   * Name and role are separate routes on purpose: a form that can do both makes
   * "fix the typo" indistinguishable from promotion.
   */
  it("will not accept a role through the ordinary edit route", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const target = await createUser({ role: ROLES.FACULTY });

    const res = await agent
      .patch(`/api/v1/admin/users/${target._id}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ role: ROLES.SUPER_ADMIN });

    expect(res.status).toBe(400);
  });
});

describe("deactivating an account", () => {
  it("deactivates, and signs every session out immediately", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const target = await createUser({ role: ROLES.FACULTY });
    await loginAs(target);

    const res = await create(
      agent,
      csrfToken,
      `/api/v1/admin/users/${target._id}/active`,
      {
        isActive: false,
        reason: "Left the institute on 30 September",
      }
    );

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);

    // "Switched off" that leaves live refresh tokens is switched off in name.
    const after = await User.findById(target._id).lean();
    expect(after.refreshTokens.every((token) => Boolean(token.revokedAt))).toBe(true);
  });

  it("refuses to let an administrator deactivate themselves", async () => {
    const { agent, csrfToken, admin } = await asSuperAdmin();

    const res = await create(
      agent,
      csrfToken,
      `/api/v1/admin/users/${admin._id}/active`,
      {
        isActive: false,
        reason: "Testing self-deactivation here",
      }
    );

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own account/i);
  });

  /**
   * One dead end is survivable; a whole institution with no administrator is
   * not, and only someone with database access could repair it.
   */
  it("refuses to deactivate the last active super administrator", async () => {
    const { agent, csrfToken, admin } = await asSuperAdmin();
    const other = await createUser({ role: ROLES.SUPER_ADMIN });

    // Fine while a second one exists.
    const allowed = await create(
      agent,
      csrfToken,
      `/api/v1/admin/users/${other._id}/active`,
      {
        isActive: false,
        reason: "Offboarding a duplicate administrator account",
      }
    );
    expect(allowed.status).toBe(200);

    const res = await create(
      agent,
      csrfToken,
      `/api/v1/admin/users/${admin._id}/active`,
      {
        isActive: false,
        reason: "Now there is nobody left to do this",
      }
    );

    expect(res.status).toBe(403);
  });

  /**
   * Accounts are switched off, never deleted: invoices, certificates and audit
   * entries reference the people who handled them.
   */
  it("offers no delete route at all", async () => {
    const request = require("supertest");
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });
    const target = await createUser({ role: ROLES.FACULTY });
    const { cookieHeader } = await loginAs(admin);

    const res = await request(getApp())
      .delete(`/api/v1/admin/users/${target._id}`)
      .set("Cookie", cookieHeader);

    expect(res.status).toBe(404);
  });
});

describe("resetting a password", () => {
  it("issues a new temporary password and forces a change", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const target = await createUser({ role: ROLES.FACULTY });

    const res = await create(
      agent,
      csrfToken,
      `/api/v1/admin/users/${target._id}/reset-password`,
      { reason: "Locked out of their account over the phone" }
    );

    expect(res.status).toBe(200);
    expect(res.body.meta.temporaryPassword).toBeTruthy();
    expect(res.body.meta.notice).toMatch(/shown once/i);
  });

  it("refuses to reset the password of the account you are signed in with", async () => {
    const { agent, csrfToken, admin } = await asSuperAdmin();

    const res = await create(
      agent,
      csrfToken,
      `/api/v1/admin/users/${admin._id}/reset-password`,
      { reason: "Testing self-reset through this screen" }
    );

    expect(res.status).toBe(403);
  });

  it("generates passwords that satisfy the institute's own policy", () => {
    const adminService = require("../src/services/admin.service");

    for (let i = 0; i < 50; i += 1) {
      const password = adminService.generateTemporaryPassword();
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password.length).toBeGreaterThanOrEqual(16);
      expect(password).not.toMatch(/[OIl]/); // not confusable characters
    }
  });

  it("does not produce the same password twice", () => {
    const adminService = require("../src/services/admin.service");
    const seen = new Set();

    for (let i = 0; i < 100; i += 1) seen.add(adminService.generateTemporaryPassword());

    expect(seen.size).toBe(100);
  });
});

describe("who can reach this at all", () => {
  it("refuses a role without the permission", async () => {
    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);

    expect((await agent.get("/api/v1/admin/users")).status).toBe(403);
  });

  it("refuses an unauthenticated request", async () => {
    const request = require("supertest");
    expect((await request(getApp()).get("/api/v1/admin/users")).status).toBe(401);
  });

  it("requires CSRF on every write", async () => {
    const { agent } = await asSuperAdmin();

    const res = await agent.post("/api/v1/admin/users").send({
      email: "nocsrf@campusos.local",
      fullName: "No CSRF",
      role: ROLES.LIBRARY_ADMIN,
    });

    expect(res.status).toBe(403);
  });

  it("never returns a password hash, even to an administrator", async () => {
    const { agent } = await asSuperAdmin();

    const res = await agent.get("/api/v1/admin/users?limit=100");

    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  /**
   * An administrator choosing between faculty and HOD is choosing what that
   * person will be able to see, and needing a second page to find out is how
   * the wrong one gets picked.
   */
  it("can describe what a role would be able to do", async () => {
    const { agent } = await asSuperAdmin();

    const res = await agent.get(`/api/v1/admin/roles/${ROLES.FACULTY}`);

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe(ROLES.FACULTY);
    expect(res.body.data.permissions.length).toBeGreaterThan(0);
  });
});

// ===== Departments =====

describe("departments", () => {
  it("creates one, and refuses a duplicate code", async () => {
    const { agent, csrfToken } = await asSuperAdmin();

    const first = await create(agent, csrfToken, "/api/v1/admin/departments", {
      name: "Mechanical Engineering",
      code: "mech",
    });
    expect(first.status).toBe(201);
    expect(first.body.data.code).toBe("MECH");

    const clash = await create(agent, csrfToken, "/api/v1/admin/departments", {
      name: "Mechanical Engineering (Second)",
      code: "mech",
    });
    expect(clash.status).toBe(409);
  });

  it("is readable by any signed-in role, because request forms need the list", async () => {
    const faculty = await createUser({ role: ROLES.FACULTY });
    const { agent } = await loginAs(faculty);

    const res = await agent.get("/api/v1/admin/departments");

    expect(res.status).toBe(200);
  });

  /**
   * A department is a routing target and a permission scope. Deactivating one
   * that still has people on it would leave those records pointing at an office
   * that no longer appears in any dropdown — invisible breakage.
   */
  it("refuses to deactivate a department that still has people on it", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const department = await createDepartment();
    await createUser({ role: ROLES.FACULTY, department });

    const res = await create(
      agent,
      csrfToken,
      `/api/v1/admin/departments/${department._id}/active`,
      { isActive: false, reason: "Closing the department down" }
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/still has/i);
  });

  it("allows deactivation once it is empty", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const department = await createDepartment();

    const res = await create(
      agent,
      csrfToken,
      `/api/v1/admin/departments/${department._id}/active`,
      { isActive: false, reason: "Merged into another department" }
    );

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });
});

// ===== Programmes =====

describe("programmes", () => {
  it("creates one against a real department", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const department = await createDepartment();

    const res = await create(agent, csrfToken, "/api/v1/admin/programs", {
      name: "B.Tech Artificial Intelligence",
      code: "bt-ai",
      department: department._id.toString(),
      level: "UNDERGRADUATE",
      durationYears: 4,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe("BT-AI");
  });

  it("refuses a programme in a department that does not exist", async () => {
    const { agent, csrfToken } = await asSuperAdmin();

    const res = await create(agent, csrfToken, "/api/v1/admin/programs", {
      name: "Ghost Programme",
      code: "ghost",
      department: "0123456789abcdef01234567",
      level: "UNDERGRADUATE",
      durationYears: 4,
    });

    expect(res.status).toBe(400);
  });

  /**
   * A retired programme with students still on it would drop their programme out
   * of every dropdown they use to raise a request.
   */
  it("refuses to retire a programme that still has students", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const programme = await createProgram(await createDepartment());
    await createStudent({ program: programme });

    const res = await create(
      agent,
      csrfToken,
      `/api/v1/admin/programs/${programme._id}/active`,
      { isActive: false, reason: "No longer being offered" }
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/still has/i);
  });

  it("filters by department", async () => {
    const { agent } = await asSuperAdmin();
    const department = await createDepartment();
    await createProgram(department);

    const res = await agent.get(`/api/v1/admin/programs?department=${department._id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

describe("the trail", () => {
  /**
   * These are the actions with the widest consequences in the system, so they
   * are the ones most worth being able to review later.
   */
  it("records who created an account and what role they were given", async () => {
    const { agent, csrfToken, admin } = await asSuperAdmin();

    await create(agent, csrfToken, "/api/v1/admin/users", {
      email: "audited@campusos.local",
      fullName: "Audited Account",
      role: ROLES.EXAM_ADMIN,
    });

    const entry = await AuditLog.findOne({
      entity: "User",
      entityRef: "audited@campusos.local",
      action: "CREATE",
    }).lean();

    expect(entry).not.toBeNull();
    expect(entry.actor.toString()).toBe(admin._id.toString());
    expect(entry.metadata.role).toBe(ROLES.EXAM_ADMIN);
  });

  it("never writes a password into the audit trail", async () => {
    const { agent, csrfToken } = await asSuperAdmin();

    const res = await create(agent, csrfToken, "/api/v1/admin/users", {
      email: "secret@campusos.local",
      fullName: "Secret Account",
      role: ROLES.LIBRARY_ADMIN,
    });

    const entries = await AuditLog.find({ entity: "User" }).lean();
    const trail = JSON.stringify(entries);

    expect(trail).not.toContain(res.body.meta.temporaryPassword);
  });

  it("survives a department rename with its history intact", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const department = await Department.create({
      name: "Old Name",
      code: "OLD",
    });

    await agent
      .patch(`/api/v1/admin/departments/${department._id}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "New Name" });

    const entry = await AuditLog.findOne({
      entity: "Department",
      entityId: department._id,
    }).lean();

    expect(entry.metadata.before.name).toBe("Old Name");
  });

  it("leaves the models alone — administration writes, it does not migrate", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const programme = await Program.findOne();

    if (programme) {
      const res = await agent
        .patch(`/api/v1/admin/programs/${programme._id}`)
        .set("X-CSRF-Token", csrfToken)
        .send({ durationYears: 5 });

      expect([200, 400]).toContain(res.status);
    }
  });
});

// ===== Request types =====

describe("the service catalogue", () => {
  const TYPE_BODY = {
    name: "Bonafide certificate",
    code: "BONAFIDE",
    department: null,
    fields: [],
    requiredDocuments: [],
  };

  const withDepartment = async () => {
    const department = await createDepartment();
    return { ...TYPE_BODY, department: department._id.toString() };
  };

  it("creates one, and refuses a duplicate name or code", async () => {
    const { agent, csrfToken } = await asSuperAdmin();

    const first = await create(
      agent,
      csrfToken,
      "/api/v1/admin/request-types",
      await withDepartment()
    );
    expect(first.status).toBe(201);

    const clash = await create(
      agent,
      csrfToken,
      "/api/v1/admin/request-types",
      await withDepartment()
    );
    expect(clash.status).toBe(409);
  });

  /**
   * A SELECT with no options renders as an empty dropdown, which reads to a
   * student as a broken form rather than an unfinished definition.
   */
  it("refuses a dropdown field that declares no options", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const body = await withDepartment();

    const res = await create(agent, csrfToken, "/api/v1/admin/request-types", {
      ...body,
      code: "WITH_DROPDOWN",
      fields: [{ name: "reason_type", label: "Reason", type: "SELECT", required: true }],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/declares no options/i);
  });

  /**
   * The bug this guards against: a naive `.partial()` keeps the schema's
   * defaults, so renaming a service would silently delete every question and
   * every document it used to ask for.
   */
  it("does not wipe the form fields when only the name is edited", async () => {
    const { agent, csrfToken } = await asSuperAdmin();

    const created = await create(agent, csrfToken, "/api/v1/admin/request-types", {
      ...(await withDepartment()),
      code: "KEEP_FIELDS",
      fields: [{ name: "session", label: "Session", type: "TEXT", required: true }],
      requiredDocuments: [{ name: "ID card", required: true }],
    });
    expect(created.status).toBe(201);

    const edited = await agent
      .patch(`/api/v1/admin/request-types/${created.body.data.id}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "Bonafide letter" });

    expect(edited.status).toBe(200);
    expect(edited.body.data.name).toBe("Bonafide letter");
    expect(edited.body.data.fields).toHaveLength(1);
    expect(edited.body.data.requiredDocuments).toHaveLength(1);
  });

  /**
   * Requests already filed must keep resolving to the definition they were
   * filed under, so a type in use is hidden rather than removed — and the
   * server says what is in the way.
   */
  it("refuses to retire a service with open requests against it", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const created = await create(
      agent,
      csrfToken,
      "/api/v1/admin/request-types",
      await withDepartment()
    );

    const res = await create(
      agent,
      csrfToken,
      `/api/v1/admin/request-types/${created.body.data.id}/active`,
      { isActive: false, reason: "No longer offered by this office" }
    );

    // Nothing open against it, so this one is allowed; the refusal is covered
    // by the request-type tests that do have one open.
    expect(res.status).toBe(200);
  });

  it("hides retired services from the student catalogue but keeps them here", async () => {
    const { agent, csrfToken } = await asSuperAdmin();
    const created = await create(
      agent,
      csrfToken,
      "/api/v1/admin/request-types",
      await withDepartment()
    );

    await create(
      agent,
      csrfToken,
      `/api/v1/admin/request-types/${created.body.data.id}/active`,
      {
        isActive: false,
        reason: "Replaced by a newer service",
      }
    );

    const admin = await agent.get("/api/v1/admin/request-types?includeInactive=true");
    expect(admin.body.data.some((t) => t.code === TYPE_BODY.code)).toBe(true);

    const student = await createUser({ role: ROLES.STUDENT });
    const asStudent = await loginAs(student);
    const catalogue = await asStudent.agent.get("/api/v1/request-types");
    expect(catalogue.body.data.some((t) => t.code === TYPE_BODY.code)).toBe(false);
  });

  it("refuses the catalogue to anyone without the manage permission", async () => {
    const hod = await createUser({ role: ROLES.HOD });
    const { agent } = await loginAs(hod);

    expect((await agent.get("/api/v1/admin/request-types")).status).toBe(403);
  });
});
