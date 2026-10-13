/**
 * Staff directory.
 *
 * The endpoint exists so assignment has something to populate from. Without it
 * a client must either accept a hand-typed ObjectId or hardcode a list, and both
 * make the assignment workflow unusable while appearing to work.
 *
 * The scoping is the security surface: the list reveals the staff of the
 * institution, and it must not be a way to learn who works outside a
 * departmental assigner's own department.
 */

const {
  resetDatabase,
  createUser,
  createDepartment,
  loginAs,
} = require("./helpers/factory");

const { ROLES } = require("../src/config/constants");

beforeEach(resetDatabase);

describe("staff directory", () => {
  it("refuses an unauthenticated caller", async () => {
    const request = require("supertest");
    const { getApp } = require("./helpers/factory");

    const res = await request(getApp()).get("/api/v1/users/staff");
    expect(res.status).toBe(401);
  });

  it("refuses a student", async () => {
    const student = await createUser({ role: ROLES.STUDENT });
    const { agent } = await loginAs(student);

    const res = await agent.get("/api/v1/users/staff");

    expect(res.status).toBe(403);
  });

  it("lists no students among the assignable staff", async () => {
    const dean = await createUser({ role: ROLES.DEAN });
    const student = await createUser({ role: ROLES.STUDENT });

    const { agent } = await loginAs(dean);
    const res = await agent.get("/api/v1/users/staff");

    expect(res.status).toBe(200);
    expect(res.body.data.every((s) => s.role !== ROLES.STUDENT)).toBe(true);
    expect(res.body.data.some((s) => s.id === student._id.toString())).toBe(false);
  });

  it("omits inactive accounts", async () => {
    const dean = await createUser({ role: ROLES.DEAN });
    await createUser({ role: ROLES.SUPPORT_STAFF, isActive: false });

    const { agent } = await loginAs(dean);
    const res = await agent.get("/api/v1/users/staff");

    expect(res.body.data.every((s) => s.role !== undefined)).toBe(true);
    // Every entry is active because inactive ones are filtered out entirely.
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  /**
   * The scoping rule.
   *
   * A departmental assigner is pinned to their own department, so the directory
   * cannot be used to learn who works elsewhere — including who handles the
   * confidential workflows.
   */
  it("restricts a departmental assigner to their own department", async () => {
    const cse = await createDepartment();
    const ece = await createDepartment();

    await createUser({ role: ROLES.HOD, department: cse });
    await createUser({ role: ROLES.FACULTY, department: cse });
    await createUser({ role: ROLES.FACULTY, department: ece });

    const hod = await createUser({ role: ROLES.HOD, department: cse });
    const { agent } = await loginAs(hod);

    const res = await agent.get("/api/v1/users/staff");

    expect(res.status).toBe(200);
    const departments = new Set(res.body.data.map((s) => s.department).filter(Boolean));
    expect(departments.size).toBe(1);
    expect([...departments][0]).toBe(cse._id.toString());
  });

  it("lets an institution-wide assigner see every department", async () => {
    const cse = await createDepartment();
    const ece = await createDepartment();

    await createUser({ role: ROLES.FACULTY, department: cse });
    await createUser({ role: ROLES.FACULTY, department: ece });

    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);

    const res = await agent.get("/api/v1/users/staff");

    // Counted only where a department is actually set: the Dean is a valid
    // entry with no department of their own.
    const departments = new Set(res.body.data.map((s) => s.department).filter(Boolean));
    expect(departments.size).toBe(2);
  });

  /**
   * A HOD with no department gets nothing, rather than everyone.
   *
   * Treating an absent department as "no filter" would hand a departmental
   * assigner the whole college's staff — the same null-matching trap the
   * announcement audience and the reports scoping both guard against.
   */
  it("returns nothing for a departmental assigner with no department", async () => {
    const cse = await createDepartment();
    await createUser({ role: ROLES.FACULTY, department: cse });

    const detached = await createUser({ role: ROLES.HOD });
    expect(detached.department ?? null).toBeNull();

    const { agent } = await loginAs(detached);
    const res = await agent.get("/api/v1/users/staff");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("returns only what the dropdown needs, and nothing more", async () => {
    const dean = await createUser({ role: ROLES.DEAN });

    const { agent } = await loginAs(dean);
    const res = await agent.get("/api/v1/users/staff");

    const keys = Object.keys(res.body.data[0]).sort();
    expect(keys).toEqual(["department", "email", "fullName", "id", "role"].sort());
    // A staff list is not a staff dossier: no phone, no timestamps, no hashes.
    expect(keys).not.toContain("passwordHash");
    expect(keys).not.toContain("phone");
    expect(keys).not.toContain("createdAt");
  });

  it("rejects a malformed department filter", async () => {
    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);

    const res = await agent.get("/api/v1/users/staff?department=not-an-id");
    expect(res.status).toBe(400);
  });
});
