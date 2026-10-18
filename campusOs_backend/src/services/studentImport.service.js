/**
 * Bulk student import.
 *
 * ## Why this is two calls and not one
 *
 * `validate` then `commit`. The administrator sees exactly what would happen —
 * which rows are new, which clash, which are wrong and on which line — before
 * anything is written. An import of two hundred students should never be the
 * moment somebody discovers row 147 has a typo in it.
 *
 * ## Why it is all-or-nothing
 *
 * A partial import is worse than none: it leaves some students with accounts and
 * others without, and nobody can tell afterwards which is which. So validation
 * runs across the whole file first, and if any row is bad the commit is refused
 * outright rather than skipping it.
 *
 * ## No transaction
 *
 * The two collections have to agree — a User with no Student is an account that
 * can sign in and see nothing — and a transaction would be the clean way to keep
 * them in step. But a transaction needs a replica set, and this project runs
 * against a standalone Mongo in development and in tests. So the writes are
 * ordered to make the window as small as possible, and a failure in the middle
 * rolls back what was created rather than leaving half a cohort behind.
 *
 * ## The passwords
 *
 * Generated, one per student, shown once as a downloadable CSV — never in the
 * audit trail, and never stored in anything but a bcrypt hash. The alternative
 * is letting the college choose 200 passwords, which means 200 passwords held in
 * a spreadsheet by someone who should not have them.
 */

const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Student = require("../models/Student");
const Department = require("../models/Department");
const Program = require("../models/Program");

const { ApiError } = require("../utils/ApiError");
const { ROLES, AUDIT_ACTION } = require("../config/constants");
const { parseCsvObjects } = require("../utils/csv");
const { generateTemporaryPassword } = require("./admin.service");
const auditService = require("./audit.service");

/**
 * The columns this import understands.
 *
 * A fixed contract, checked up front, rather than "whatever headers the file
 * has". An export from a different system would otherwise import half its rows
 * with silently empty fields.
 */
const COLUMNS = [
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
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A cap, so one enormous file cannot exhaust memory or take the API down. */
const MAX_ROWS = 2000;
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Read and normalise a CSV into per-row candidates, with every problem found
 * rather than the first one.
 *
 * Collecting all of them is the point: an administrator fixing a file should
 * see all eleven problems in one pass, not discover them one import at a time.
 */
async function readRows(csvText) {
  if (typeof csvText !== "string" || csvText.trim() === "") {
    throw ApiError.badRequest("No file was supplied");
  }

  if (Buffer.byteLength(csvText, "utf8") > MAX_BYTES) {
    throw ApiError.badRequest(
      `That file is larger than ${Math.round(MAX_BYTES / (1024 * 1024))}MB. ` +
        "Split it, or import it in batches."
    );
  }

  // Lookups are per-file, not per-row: 2000 rows must not become 2000 queries.
  const [programs, departments] = await Promise.all([
    Program.find({}).select("code name department isActive").lean(),
    Department.find({}).select("code name isActive").lean(),
  ]);

  const programByCode = new Map(programs.map((p) => [p.code, p]));
  const departmentByCode = new Map(departments.map((d) => [d.code, d]));
  const enabledProgramCodes = new Set(
    programs.filter((p) => p.isActive).map((p) => p.code)
  );

  let rows;
  try {
    ({ rows } = parseCsvObjects(csvText, { columns: COLUMNS }));
  } catch (error) {
    throw ApiError.badRequest(error.message);
  }

  if (rows.length === 0) {
    throw ApiError.badRequest("The file has a header row but no students in it");
  }

  if (rows.length > MAX_ROWS) {
    throw ApiError.badRequest(
      `That file has ${rows.length} rows; the limit is ${MAX_ROWS}. ` +
        "Split it into batches."
    );
  }

  // Existing records, fetched once so duplicate detection is a lookup rather
  // than a query per row.
  const [existingRolls, existingEmails] = await Promise.all([
    Student.find({ rollNumber: { $in: rows.map((r) => r.rollNumber).filter(Boolean) } })
      .select("rollNumber")
      .lean(),
    User.find({ email: { $in: rows.map((r) => r.email.toLowerCase()).filter(Boolean) } })
      .select("email")
      .lean(),
  ]);

  const rollTaken = new Set(existingRolls.map((r) => r.rollNumber));
  const emailTaken = new Set(existingEmails.map((r) => r.email.toLowerCase()));

  // Duplicates *within* the file, which no database query can find.
  const seenRolls = new Set();
  const seenEmails = new Set();

  const candidates = rows.map((row) => {
    const problems = [];
    const line = row.__line;

    const rollNumber = row.rollNumber?.trim();
    const fullName = row.fullName?.trim();
    const email = row.email?.trim().toLowerCase();
    const programCode = row.programCode?.trim().toUpperCase();
    const departmentCode = row.departmentCode?.trim().toUpperCase();

    if (!rollNumber) problems.push("rollNumber is required");
    if (!fullName) problems.push("fullName is required");
    if (!email) problems.push("email is required");
    else if (!EMAIL.test(email)) problems.push(`"${row.email}" is not an email address`);

    if (rollNumber) {
      if (seenRolls.has(rollNumber)) {
        problems.push(`roll number ${rollNumber} appears twice in this file`);
      }
      seenRolls.add(rollNumber);
      if (rollTaken.has(rollNumber)) {
        problems.push(`roll number ${rollNumber} already exists`);
      }
    }

    if (email) {
      if (seenEmails.has(email)) {
        problems.push(`email ${email} appears twice in this file`);
      }
      seenEmails.add(email);
      if (emailTaken.has(email)) {
        problems.push(`email ${email} already has an account`);
      }
    }

    const program = programByCode.get(programCode);
    if (!programCode) problems.push("programCode is required");
    else if (!program) problems.push(`no programme with code ${programCode}`);
    else if (!enabledProgramCodes.has(programCode)) {
      problems.push(`programme ${programCode} is retired`);
    }

    // A department is inferred from the programme when it is left blank, which
    // is right the great majority of the time and avoids making the person
    // maintain a column that is derivable.
    const department = departmentByCode.get(departmentCode);
    const resolvedDepartmentId = department?._id ?? program?.department;

    if (departmentCode && !department) {
      problems.push(`no department with code ${departmentCode}`);
    }
    if (!resolvedDepartmentId) {
      problems.push("departmentCode is required, because the programme has none");
    }

    const semester = Number(row.semester);
    if (!Number.isInteger(semester) || semester < 1 || semester > 12) {
      problems.push("semester must be a whole number between 1 and 12");
    }

    const year = Number(row.year);
    if (!Number.isInteger(year) || year < 1 || year > 6) {
      problems.push("year must be a whole number between 1 and 6");
    }

    if (!row.enrolmentDate) problems.push("enrolmentDate is required");
    else if (!DATE.test(row.enrolmentDate)) {
      problems.push("enrolmentDate must be written as YYYY-MM-DD");
    }

    return {
      line,
      ok: problems.length === 0,
      problems,
      values: {
        rollNumber,
        fullName,
        email,
        programId: program?._id,
        programCode,
        departmentId: resolvedDepartmentId,
        semester,
        year,
        section: row.section?.trim() || undefined,
        batchYear: row.batchYear?.trim() || undefined,
        enrolmentDate: row.enrolmentDate,
      },
    };
  });

  return { candidates, columns: COLUMNS };
}

/**
 * Dry run. Writes nothing, ever.
 *
 * The point is that the commit can trust its input: by the time anything is
 * written, every row has already been through this.
 */
async function validateImport({ csv }) {
  const { candidates, columns } = await readRows(csv);

  const bad = candidates.filter((entry) => !entry.ok);

  return {
    valid: bad.length === 0,
    columns,
    totals: {
      rows: candidates.length,
      toCreate: candidates.filter((entry) => entry.ok).length,
      problems: bad.length,
    },
    // Every bad row, not a sample: somebody fixing a file needs the whole list.
    problems: bad.map((entry) => ({
      line: entry.line,
      rollNumber: entry.values.rollNumber || null,
      issues: entry.problems,
    })),
    // Enough for the preview to be recognisable without echoing it all back.
    preview: candidates.slice(0, 50).map((entry) => ({
      line: entry.line,
      rollNumber: entry.values.rollNumber,
      fullName: entry.values.fullName,
      email: entry.values.email,
      ok: entry.ok,
    })),
    message: bad.length
      ? `Nothing was imported. Fix the ${bad.length} row${bad.length === 1 ? "" : "s"} above and try again.`
      : `${candidates.length} student${candidates.length === 1 ? "" : "s"} ready to import.`,
  };
}

/**
 * Write the import.
 *
 * Refuses if anything at all is wrong, so a file is either fully imported or
 * not imported at all.
 */
/**
 * Hash every temporary password, yielding to the event loop between batches.
 *
 * `bcryptjs` is pure JavaScript and does not release the thread mid-hash, so
 * `Promise.all` gives no parallelism at all — it just queues every hash onto one
 * event loop. At `MAX_ROWS` that starved the loop for minutes, so health checks,
 * the payment webhook and every other request in the process stalled behind one
 * import.
 *
 * The pause is what fixes it: each batch is genuinely sequential work, and
 * between batches the loop is handed back so other requests can run.
 */
async function hashPasswords(prepared) {
  const BATCH = 10;

  for (let offset = 0; offset < prepared.length; offset += BATCH) {
    for (const entry of prepared.slice(offset, offset + BATCH)) {
      entry.passwordHash = await bcrypt.hash(entry.temporaryPassword, 12);
      // The plaintext must not survive into the insert document.
      delete entry.temporaryPassword;
    }

    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
}

async function commitImport({ csv, user: actor, req }) {
  const { candidates } = await readRows(csv);

  const bad = candidates.filter((entry) => !entry.ok);

  if (bad.length > 0) {
    throw ApiError.badRequest(
      `Nothing was imported: ${bad.length} of ${candidates.length} rows have problems. ` +
        "Fix them and upload the file again — an import is never partly applied.",
      {
        details: bad
          .slice(0, 50)
          .flatMap((entry) =>
            entry.problems.map((message) => ({ field: `line ${entry.line}`, message }))
          ),
      }
    );
  }

  const createdUsers = [];
  const credentials = [];

  try {
    /*
     * One insertMany per collection rather than a loop.
     *
     * A loop of saves is two round trips per student; two batched writes is
     * two in total, and it shrinks the window in which the collections could
     * disagree.
     */
    const prepared = candidates.map((entry) => {
      const temporaryPassword = generateTemporaryPassword();
      credentials.push({
        rollNumber: entry.values.rollNumber,
        fullName: entry.values.fullName,
        email: entry.values.email,
        temporaryPassword,
      });

      return {
        email: entry.values.email,
        fullName: entry.values.fullName,
        role: ROLES.STUDENT,
        department: entry.values.departmentId,
        isActive: true,
        mustChangePassword: true,
        temporaryPassword,
      };
    });

    /*
     * Hashed here, in the batch, rather than by a save hook.
     *
     * `insertMany` does not run document middleware, so a `passwordHash` put
     * straight into the object would be stored in plaintext — two hundred
     * readable passwords in one write. Cost 12 matches `User.setPassword`, so
     * a batched account and a singly-created one are equally expensive to
     * crack offline.
     */
    await hashPasswords(prepared);

    /*
     * Recorded before the write, not after.
     *
     * `ordered: true` writes rows one at a time and throws on the first
     * failure, so a duplicate email that raced in after the preview was checked
     * leaves every row before it already inserted. With the list filled in
     * afterwards, the rollback guard saw nothing to undo and those accounts
     * survived: working passwords that were returned to nobody, and no linked
     * Student record, so the person could sign in and find an empty account.
     */
    createdUsers.push(...prepared.map((u) => u.email));

    await User.insertMany(prepared, { ordered: true });

    const usersByEmail = await User.find({ email: { $in: prepared.map((u) => u.email) } })
      .select("email _id")
      .lean();

    const userIdByEmail = new Map(usersByEmail.map((u) => [u.email, u._id]));

    const studentDocs = candidates.map((entry) => ({
      user: userIdByEmail.get(entry.values.email),
      rollNumber: entry.values.rollNumber,
      program: entry.values.programId,
      department: entry.values.departmentId,
      semester: entry.values.semester,
      year: entry.values.year,
      section: entry.values.section,
      batchYear: entry.values.batchYear ? Number(entry.values.batchYear) : undefined,
      enrolmentDate: new Date(`${entry.values.enrolmentDate}T00:00:00.000Z`),
      // From the model's enum. A newly enrolled student has not paid, so DUE —
      // and PENDING, which reads more naturally, is not a value it accepts.
      feeStatus: "DUE",
      isActive: true,
    }));

    /*
     * The returned documents, not the ones passed in.
     *
     * Whether Mongoose mutates the input array is an implementation detail, and
     * relying on it produced a link step that silently did nothing: every
     * account was created, none was attached to its student, and a test that
     * only counted rows would have called it a success. The ids the database
     * hands back are the authoritative ones.
     */
    const inserted = await Student.insertMany(studentDocs, { ordered: true });

    // Link the two halves last, once both exist.
    await Promise.all(
      inserted.map((doc) =>
        User.updateOne({ _id: doc.user }, { $set: { student: doc._id } })
      )
    );

    await auditService.record({
      action: AUDIT_ACTION.CREATE,
      entity: "Student",
      metadata: {
        bulkImport: true,
        count: inserted.length,
        // Never the credentials: the trail is read by people who do not need
        // them, and a password in a log is a password in three backups.
        firstRollNumber: inserted[0]?.rollNumber ?? null,
      },
      actor,
      req,
    });

    return {
      imported: inserted.length,
      // Handed back once, for handover as a file. This is the only time these
      // exist in plaintext anywhere.
      credentials,
      notice:
        "Download these now. They are shown once and stored only as hashes, so " +
        "they cannot be shown or sent again.",
    };
  } catch (error) {
    /*
     * Undo what was written.
     *
     * Half a cohort imported is the worst outcome available: some students can
     * sign in and some cannot, and nobody can tell which. Rolling back leaves
     * the registrar where they started, with a file they can fix.
     */
    if (createdUsers.length > 0) {
      await User.deleteMany({ email: { $in: createdUsers } }).catch(() => {});
    }
    await Student.deleteMany({
      rollNumber: { $in: candidates.map((e) => e.values.rollNumber) },
    }).catch(() => {});

    await auditService.record({
      action: AUDIT_ACTION.UPDATE,
      entity: "Student",
      metadata: { bulkImport: true, outcome: "rolled-back", reason: error.message },
      actor,
      req,
    });

    throw ApiError.badRequest(
      "The import failed and was rolled back — no students were added. " +
        "The file most likely contains a roll number or email that is already " +
        "in use. Check and try again."
    );
  }
}

module.exports = {
  COLUMNS,
  readRows,
  validateImport,
  commitImport,
  MAX_ROWS,
};
