/**
 * Bulk student import.
 *
 * The import is the one place where a single mistake affects hundreds of people
 * at once, so most of these tests are about what it refuses.
 *
 * The two properties that matter most:
 *
 *  - **Nothing is written until everything is valid.** A partial import leaves
 *    some students able to sign in and some not, and afterwards nobody can tell
 *    which is which.
 *  - **No password is ever stored in the clear.** `insertMany` does not run
 *    document middleware, so a password placed straight into the object would
 *    be written as plaintext — this is checked against the stored hash, not
 *    against the response.
 */

const {
  getApp,
  resetDatabase,
  createUser,
  createDepartment,
  createProgram,
  loginAs,
} = require("./helpers/factory");

const { ROLES } = require("../src/config/constants");
const User = require("../src/models/User");
const Student = require("../src/models/Student");
const Program = require("../src/models/Program");
const AuditLog = require("../src/models/AuditLog");
const studentImportService = require("../src/services/studentImport.service");

const request = require("supertest");

beforeEach(resetDatabase);

/** A department, a programme inside it, and a CSV that references both. */
const makeFixture = async () => {
  const department = await createDepartment({ name: "Computer Science", code: "CSE" });
  const program = await createProgram(department, {
    name: "B.Tech Computer Science",
    code: "BTCS",
  });

  return { department, program };
};

const csvFor = (rows) =>
  [
    "rollNumber,fullName,email,programCode,departmentCode,semester,year,section,batchYear,enrolmentDate",
    ...rows.map((r) =>
      [
        r.rollNumber,
        r.fullName,
        r.email,
        r.programCode ?? "BTCS",
        r.departmentCode ?? "CSE",
        r.semester ?? 1,
        r.year ?? 1,
        r.section ?? "A",
        r.batchYear ?? 2026,
        r.enrolmentDate ?? "2026-08-01",
      ].join(",")
    ),
  ].join("\n");

const goodRow = {
  rollNumber: "26CS001",
  fullName: "Ananya Sharma",
  email: "ananya@campusos.local",
};

const asAdmin = async () => {
  const admin = await createUser({ role: ROLES.SUPER_ADMIN });
  const session = await loginAs(admin);
  return { admin, ...session };
};

const validate = (agent, csrf, csv) =>
  agent
    .post("/api/v1/admin/students/import/validate")
    .set("X-CSRF-Token", csrf)
    .send({ csv });

const commit = (agent, csrf, csv) =>
  agent
    .post("/api/v1/admin/students/import/commit")
    .set("X-CSRF-Token", csrf)
    .send({ csv });

describe("a dry run writes nothing", () => {
  it("reports what would happen and leaves the database alone", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const before = await User.countDocuments();
    const res = await validate(agent, csrfToken, csvFor([goodRow]));

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.totals).toMatchObject({ rows: 1, toCreate: 1, problems: 0 });

    expect(await User.countDocuments()).toBe(before);
    expect(await Student.countDocuments({ rollNumber: "26CS001" })).toBe(0);
  });

  it("returns every bad row, not just the first", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const res = await validate(
      agent,
      csrfToken,
      csvFor([
        goodRow,
        { ...goodRow, rollNumber: "26CS002", email: "not-an-email" },
        { ...goodRow, rollNumber: "26CS003", semester: 99 },
      ])
    );

    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.totals.problems).toBe(2);
    // Somebody fixing a file should see the whole list in one pass, not
    // discover the next problem on the next upload.
    expect(res.body.data.problems).toHaveLength(2);
    expect(res.body.data.problems[0].line).toBe(3);
  });

  it("names the column that is missing", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const res = await validate(agent, csrfToken, "rollNumber,fullName\n26CS001,Ananya");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/missing the column/i);
  });

  it("explains an empty file rather than importing nothing silently", async () => {
    const { agent, csrfToken } = await asAdmin();

    // A complete header row with nothing under it: the columns are right, so
    // this has to be reported as an empty file rather than as missing columns.
    const res = await validate(agent, csrfToken, studentImportService.COLUMNS.join(","));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no students in it/i);
  });
});

describe("catching problems before they are written", () => {
  it("refuses a roll number that already exists", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();
    await commit(agent, csrfToken, csvFor([goodRow]));

    const res = await validate(
      agent,
      csrfToken,
      csvFor([{ ...goodRow, email: "different@campusos.local" }])
    );

    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.problems[0].issues[0]).toMatch(/already exists/i);
  });

  /**
   * A duplicate inside one file is invisible to any database query — the rows
   * do not exist yet — so it has to be caught while reading.
   */
  it("refuses the same roll number twice in one file", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const res = await validate(
      agent,
      csrfToken,
      csvFor([goodRow, { ...goodRow, email: "other@campusos.local" }])
    );

    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.problems[0].issues.join(" ")).toMatch(/appears twice/i);
  });

  it("refuses a programme code that does not exist", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const res = await validate(
      agent,
      csrfToken,
      csvFor([{ ...goodRow, programCode: "NOPE" }])
    );

    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.problems[0].issues.join(" ")).toMatch(/no programme with code/i);
  });

  it("refuses a retired programme", async () => {
    const { program } = await makeFixture();
    await Program.updateOne({ _id: program._id }, { $set: { isActive: false } });
    const { agent, csrfToken } = await asAdmin();

    const res = await validate(agent, csrfToken, csvFor([goodRow]));

    expect(res.body.data.problems[0].issues.join(" ")).toMatch(/retired/i);
  });

  it("refuses a semester that is not a whole number", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const res = await validate(
      agent,
      csrfToken,
      csvFor([{ ...goodRow, semester: "3.5" }])
    );

    expect(res.body.data.problems[0].issues.join(" ")).toMatch(
      /whole number between 1 and 12/i
    );
  });

  it("reads a quoted value containing a comma", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const csv = [
      "rollNumber,fullName,email,programCode,departmentCode,semester,year,section,batchYear,enrolmentDate",
      '26CS004,"Sharma, Ananya",ananya2@campusos.local,BTCS,CSE,1,1,A,2026,2026-08-01',
    ].join("\n");

    const res = await validate(agent, csrfToken, csv);

    expect(res.body.data.valid).toBe(true);
  });
});

describe("committing", () => {
  it("creates a linked user and student for every row", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const res = await commit(
      agent,
      csrfToken,
      csvFor([
        goodRow,
        {
          ...goodRow,
          rollNumber: "26CS002",
          fullName: "Raghav Kumar",
          email: "raghav@campusos.local",
        },
      ])
    );

    expect(res.status).toBe(201);
    expect(res.body.data.imported).toBe(2);
    expect(res.body.meta.credentials).toHaveLength(2);

    const student = await Student.findOne({ rollNumber: "26CS001" });
    expect(student).not.toBeNull();

    // The two halves must agree, or there is an account that can sign in and
    // see nothing.
    const user = await User.findById(student.user);
    expect(user.role).toBe(ROLES.STUDENT);
    expect(user.student.toString()).toBe(student._id.toString());
    expect(student.program).toBeTruthy();
  });

  /**
   * The one that matters most, and the one a test that only checked the
   * response would have missed.
   */
  it("stores passwords hashed, never in the clear", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const res = await commit(agent, csrfToken, csvFor([goodRow]));
    const issued = res.body.meta.credentials[0].temporaryPassword;

    const stored = await User.findOne({ email: goodRow.email })
      .select("+passwordHash")
      .lean();

    expect(stored.passwordHash).toBeTruthy();
    expect(stored.passwordHash).not.toContain(issued);
    // The plaintext must not be anywhere in the document at all.
    expect(JSON.stringify(stored)).not.toContain(issued);
  });

  it("issues a temporary password and holds the account until it is changed", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const res = await commit(agent, csrfToken, csvFor([goodRow]));
    const issued = res.body.meta.credentials[0].temporaryPassword;

    const stored = await User.findOne({ email: goodRow.email }).lean();
    expect(stored.mustChangePassword).toBe(true);

    const login = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: goodRow.email, password: issued });

    expect(login.status).toBe(200);
    expect(login.body.data.user.mustChangePassword).toBe(true);
  });

  /**
   * All-or-nothing. Half a cohort imported is the worst outcome available.
   */
  it("imports nothing at all when any row is bad", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const res = await commit(
      agent,
      csrfToken,
      csvFor([
        goodRow,
        { ...goodRow, rollNumber: "26CS002", email: "bad-email", fullName: "Broken Row" },
      ])
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/never partly applied/i);

    // The good row must not have been written either.
    expect(await Student.countDocuments({ rollNumber: "26CS001" })).toBe(0);
    expect(await User.countDocuments({ email: goodRow.email })).toBe(0);
  });

  it("never writes a password into the audit trail", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const res = await commit(agent, csrfToken, csvFor([goodRow]));
    const issued = res.body.meta.credentials[0].temporaryPassword;

    const entries = await AuditLog.find({ entity: "Student" }).lean();

    expect(JSON.stringify(entries)).not.toContain(issued);
    expect(entries[0].metadata.bulkImport).toBe(true);
    expect(entries[0].metadata.count).toBe(1);
  });

  it("refuses a second import of the same roll numbers", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();
    const csv = csvFor([goodRow]);

    expect((await commit(agent, csrfToken, csv)).status).toBe(201);

    const again = await commit(agent, csrfToken, csv);

    expect(again.status).toBe(400);
    expect(Student.countDocuments({ rollNumber: "26CS001" })).toBeDefined;
    expect(await Student.countDocuments({ rollNumber: "26CS001" })).toBe(1);
  });

  it("refuses an empty body", async () => {
    const { agent, csrfToken } = await asAdmin();

    expect((await commit(agent, csrfToken, "")).status).toBe(400);
  });
});

describe("who may do this", () => {
  it("refuses a role without user management", async () => {
    await makeFixture();
    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);

    const res = await agent
      .post("/api/v1/admin/students/import/validate")
      .send({ csv: csvFor([goodRow]) });

    expect(res.status).toBe(403);
  });

  it("requires a session and a CSRF token", async () => {
    expect(
      (
        await request(getApp())
          .post("/api/v1/admin/students/import/validate")
          .send({ csv: "x" })
      ).status
    ).toBe(401);

    const { agent } = await asAdmin();
    const res = await agent
      .post("/api/v1/admin/students/import/validate")
      .send({ csv: "x" });

    expect(res.status).toBe(403);
  });
});

describe("the contract with the file", () => {
  it("states the columns it expects", () => {
    expect(studentImportService.COLUMNS).toEqual([
      "rollNumber",
      "fullName",
      "email",
      "programCode",
      "departmentCode",
      "semester",
      "year",
      "section",
      "batchYear",
      "enrolmentDate",
    ]);
  });

  it("copes with a name containing a comma, which breaks a naive split", async () => {
    await makeFixture();
    const { agent, csrfToken } = await asAdmin();

    const csv = [
      "rollNumber,fullName,email,programCode,departmentCode,semester,year,section,batchYear,enrolmentDate",
      '26CS009,"Kumar, Raghav",raghav9@campusos.local,BTCS,CSE,1,1,A,2026,2026-08-01',
    ].join("\n");

    const res = await commit(agent, csrfToken, csv);

    expect(res.status).toBe(201);
    const student = await Student.findOne({ rollNumber: "26CS009" });
    const user = await User.findById(student.user).lean();
    expect(user.fullName).toBe("Kumar, Raghav");
  });
});
