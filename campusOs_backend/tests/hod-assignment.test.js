/**
 * Head-of-department assignment.
 *
 * The department already had a `hod` field that nothing could set. These cover
 * the three ways it could go wrong if it were simply writable: appointing
 * somebody who cannot hold the post, appointing somebody outside the
 * department, and leaving the previous holder's authority in place.
 */

const {
  resetDatabase,
  createDepartment,
  createUser,
  loginAs,
} = require("./helpers/factory");

const adminService = require("../src/services/admin.service");
const Department = require("../src/models/Department");
const { ROLES, AUDIT_ACTION } = require("../src/config/constants");

describe("head of department", () => {
  let cs;

  beforeEach(async () => {
    await resetDatabase();
    cs = await createDepartment({ name: "Computer Science", code: "CS" });
  });

  it("appoints an HOD who belongs to the department", async () => {
    const hod = await createUser({ role: ROLES.HOD, department: cs._id });

    const department = await adminService.assignHod({
      departmentId: cs._id,
      userId: hod._id,
      user: await createUser({ role: ROLES.SUPER_ADMIN }),
    });

    expect(String(department.hod)).toBe(String(hod._id));
  });

  /**
   * A student appointed as HOD would be handed authority over every request,
   * certificate and fee in the department — and HOD is the only role with that
   * scope, so appointing anyone else grants them nothing and is silently
   * useless.
   */
  it("refuses somebody who does not hold the HOD role", async () => {
    const student = await createUser({ role: ROLES.STUDENT });
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });

    await expect(
      adminService.assignHod({
        departmentId: cs._id,
        userId: student._id,
        user: admin,
      })
    ).rejects.toThrow(/Head of Department role/);
  });

  it("refuses a faculty member, even a senior one", async () => {
    const faculty = await createUser({ role: ROLES.FACULTY, department: cs._id });
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });

    await expect(
      adminService.assignHod({
        departmentId: cs._id,
        userId: faculty._id,
        user: admin,
      })
    ).rejects.toThrow(/Head of Department role/);
  });

  /**
   * Head of Computer Science with an account in Physics means every HOD-scoped
   * page shows them nothing — and nothing inside the app explains why.
   */
  it("refuses somebody from another department", async () => {
    const physics = await createDepartment({ name: "Physics", code: "PH" });
    const outsider = await createUser({ role: ROLES.HOD, department: physics._id });
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });

    await expect(
      adminService.assignHod({
        departmentId: cs._id,
        userId: outsider._id,
        user: admin,
      })
    ).rejects.toThrow(/not a member of this department/);
  });

  it("refuses an account with no department at all", async () => {
    const orphan = await createUser({ role: ROLES.HOD });
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });

    await expect(
      adminService.assignHod({
        departmentId: cs._id,
        userId: orphan._id,
        user: admin,
      })
    ).rejects.toThrow(/not a member of this department/);
  });

  it("refuses a deactivated account", async () => {
    const hod = await createUser({ role: ROLES.HOD, department: cs._id });
    await require("../src/models/User").updateOne(
      { _id: hod._id },
      { $set: { isActive: false } }
    );
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });

    await expect(
      adminService.assignHod({
        departmentId: cs._id,
        userId: hod._id,
        user: admin,
      })
    ).rejects.toThrow(/deactivated/);
  });

  it("refuses to let one person head two departments", async () => {
    const maths = await createDepartment({ name: "Mathematics", code: "MA" });
    const hod = await createUser({ role: ROLES.HOD, department: cs._id });
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });

    await adminService.assignHod({
      departmentId: cs._id,
      userId: hod._id,
      user: admin,
    });

    await require("../src/models/User").updateOne(
      { _id: hod._id },
      { $set: { department: maths._id } }
    );

    await expect(
      adminService.assignHod({ departmentId: maths._id, userId: hod._id, user: admin })
    ).rejects.toThrow(/already heads/);
  });

  it("replaces an existing head rather than refusing", async () => {
    const first = await createUser({ role: ROLES.HOD, department: cs._id });
    const second = await createUser({ role: ROLES.HOD, department: cs._id });
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });

    await adminService.assignHod({
      departmentId: cs._id,
      userId: first._id,
      user: admin,
    });
    const department = await adminService.assignHod({
      departmentId: cs._id,
      userId: second._id,
      user: admin,
    });

    expect(String(department.hod)).toBe(String(second._id));

    const stored = await Department.findById(cs._id);
    expect(String(stored.hod)).toBe(String(second._id));
  });

  it("clears the appointment, because a departed HOD otherwise stays forever", async () => {
    const hod = await createUser({ role: ROLES.HOD, department: cs._id });
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });

    await adminService.assignHod({ departmentId: cs._id, userId: hod._id, user: admin });
    const cleared = await adminService.assignHod({
      departmentId: cs._id,
      userId: null,
      user: admin,
    });

    expect(cleared.hod).toBeNull();
  });

  it("records who was appointed and who was replaced", async () => {
    const first = await createUser({ role: ROLES.HOD, department: cs._id });
    const second = await createUser({ role: ROLES.HOD, department: cs._id });
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });

    await adminService.assignHod({
      departmentId: cs._id,
      userId: first._id,
      user: admin,
    });
    await adminService.assignHod({
      departmentId: cs._id,
      userId: second._id,
      user: admin,
    });

    const AuditLog = require("../src/models/AuditLog");
    // The latest entry, not the first: two appointments happened, and
    // findOne would return the earlier one and pass for the wrong reason.
    const entry = await AuditLog.findOne({ action: AUDIT_ACTION.HOD_ASSIGNED })
      .sort({ createdAt: -1 })
      .lean();

    expect(entry.metadata.appointed).toBe(String(second._id));
    expect(entry.metadata.previousHodId).toBe(String(first._id));
  });

  it("reports a missing department as a 404", async () => {
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });
    await expect(
      adminService.assignHod({ departmentId: "nope", userId: null, user: admin })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("head of department — over HTTP", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("needs its own permission, which a student never has", async () => {
    const student = await createUser({ role: ROLES.STUDENT });
    const { agent } = await loginAs(student);

    const response = await agent
      .post("/api/v1/admin/departments/000000000000000000000001/hod")
      .send({ userId: null });

    // A student cannot appoint anybody, and the route refuses before the
    // department lookup — the permission is the first thing checked.
    expect(response.status).toBe(403);
  });

  it("refuses a deputy who may manage departments but not appoint heads", async () => {
    // Department housekeeping and appointing somebody to run a department are
    // separate permissions, and only the first is bundled into the deputy role.
    const deputy = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(deputy);

    const response = await agent
      .post("/api/v1/admin/departments/000000000000000000000001/hod")
      .send({ userId: null });

    expect(response.status).toBe(403);
  });
});
