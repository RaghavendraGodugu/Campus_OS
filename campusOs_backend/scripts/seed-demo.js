#!/usr/bin/env node
/**
 * Seed demo data.
 *
 *   npm run seed:demo
 *
 * ## Demo data is labelled, not disguised
 *
 * The spec (§13) forbids populating dashboards with invented figures and
 * presenting them as real. Three mechanisms enforce that here:
 *
 *  1. Every account and record created by this script is prefixed `DEMO`, so it
 *     is obvious in any list, export or log.
 *  2. A `Setting` document named `demoData` records that demo content is
 *     present. The frontend reads it and renders a persistent banner, so no
 *     screen can be mistaken for production data while it is active.
 *  3. Running the script against a database that already holds real users is
 *     refused unless `--force` is passed, so demo rows cannot quietly land in a
 *     production database.
 *
 * Re-running is safe: everything is upserted by a stable natural key, so the
 * script converges instead of duplicating.
 */

const mongoose = require("mongoose");

const { connectDB, disconnectDB } = require("../src/config/db");
const { getEnv } = require("../src/config/env");
const { ROLES } = require("../src/config/constants");
const { nextReference } = require("../src/services/finance.service");
const {
  Student,
  Department,
  Program,
  User,
  RequestType,
  Request,
  Complaint,
  Certificate,
  Invoice,
  Payment,
  Refund,
  Notification,
  AuditLog,
} = require("../src/models");

/** Prefix applied to every demo record so it is never mistaken for real. */
const DEMO_PREFIX = "DEMO";

/**
 * A reference in the *production* format: PREFIX-YYYY-NNNNNN.
 *
 * The seeder used to invent its own shape (`DEMO-REQ-0001`). That reads fine in
 * the list and then fails the moment anyone opens the record: every identifier
 * schema requires `[A-Z]+-\d{4}-\d{4,}`, so seeded requests and complaints were
 * unopenable — a 400 on the detail view for every one of them, with no clue
 * why. Two reference formats in one system is the underlying problem.
 *
 * So demo data goes through the same `nextReference` the application uses.
 *
 * The prefix carries a `DM` marker rather than being identical to production.
 * Sharing the prefix would mean two independent counters emitting the same
 * series — the demo counter reaching REQ-2026-000002 and colliding with a real
 * request created through the API, which is a duplicate-key error on a unique
 * index. `DMREQ-2026-000001` satisfies the pattern, cannot collide, and still
 * reads as demo data in a log.
 */
const demoReference = (prefix) =>
  nextReference(`demo-${prefix.toLowerCase()}`, `DM${prefix}`);

/** Shared password for all demo accounts. Documented, never used in production. */
const DEMO_PASSWORD = "Demo@Campus123";

/**
 * Remove records created by a previous run of this script.
 *
 * Scoped to `isDemo`, which only this script ever sets, and to the models it
 * owns. A real request, complaint or certificate is never a candidate however
 * old it is, and nothing runs unless --force was given.
 *
 * Without this the seeder accumulates: a record written by an older version
 * keeps its original reference forever. Three complaints created as
 * DEMO-CMP-0001 survived a re-seed alongside newer canonical ones, and every
 * one of them 400s when opened because the identifier schema requires the
 * canonical format.
 */
async function purgeDemoRecords() {
  const removed = { total: 0 };

  const targets = [
    ["requests", Request],
    ["complaints", Complaint],
    ["certificates", Certificate],
    ["invoices", Invoice],
    ["payments", Payment],
    ["refunds", Refund],
    ["notifications", Notification],
    ["auditlogs", AuditLog],
  ];

  for (const [label, Model] of targets) {
    if (!Model) continue;
    // Sequential on purpose: a failure then names the collection it stopped on,
    // rather than leaving several half-cleared with nothing to say which.
    const result = await Model.deleteMany({ isDemo: true });
    if (result.deletedCount > 0) {
      removed[label] = result.deletedCount;
      removed.total += result.deletedCount;
    }
  }

  return removed;
}

/**
 * Refuse to pollute a database that already contains real accounts.
 * A database holding only `seed:demo` output is safe to re-seed.
 */
async function assertDatabaseIsSafeToSeed() {
  const totalUsers = await User.countDocuments();
  if (totalUsers === 0) return;

  const demoUsers = await User.countDocuments({
    email: new RegExp(`^${DEMO_PREFIX.toLowerCase()}`),
  });

  if (demoUsers === totalUsers) {
    process.stdout.write(
      `Existing data (${totalUsers} accounts) was created by a previous seed run — continuing.\n`
    );
    return;
  }

  process.stderr.write(
    `\nRefusing to seed: this database holds ${totalUsers - demoUsers} account(s) that were not ` +
      "created by the demo seeder.\n" +
      "Demo data must never be mixed with real college data.\n\n" +
      "If you are certain this is a throwaway database, re-run with:  npm run seed:demo -- --force\n\n"
  );
  process.exit(1);
}

/**
 * Create or update a demo user.
 *
 * Idempotent by design: re-running converges rather than duplicating. The
 * password hash is only written on first creation, so re-seeding never
 * re-hashes (bcrypt at cost 12 is deliberately slow) and never overwrites a
 * password a human has since changed.
 */
async function seedUser({
  email,
  fullName,
  role,
  studentId,
  departmentId,
  designation,
  expertise,
}) {
  const setFields = { fullName, role, isActive: true };
  if (studentId) setFields.student = studentId;
  if (departmentId) setFields.department = departmentId;
  if (designation !== undefined) setFields.designation = designation;
  if (expertise !== undefined) setFields.expertise = expertise;

  const existing = await User.findOne({ email });

  if (existing) {
    await User.updateOne({ _id: existing._id }, { $set: setFields });
    existing.passwordHash = await existing.constructor.db
      .collection("users")
      .findOne({ _id: existing._id }, { projection: { passwordHash: 1 } })
      .then((doc) => doc?.passwordHash);
    return existing;
  }

  const user = new User({ ...setFields, email });
  await user.setPassword(DEMO_PASSWORD);
  await user.save();
  return user;
}

async function main() {
  const force = process.argv.includes("--force");
  let env;
  try {
    env = getEnv();
  } catch (error) {
    process.stderr.write(`\n${error.message}\n\n`);
    process.exit(1);
  }

  if (env.NODE_ENV === "production" && !force) {
    process.stderr.write(
      "\nRefusing to seed demo data with NODE_ENV=production.\n" +
        "Re-run with --force if this is genuinely a demonstration deployment.\n\n"
    );
    process.exit(1);
  }

  process.stdout.write("\n=== CampusOS — seed DEMO data ===\n\n");

  await connectDB();

  if (!force) {
    await assertDatabaseIsSafeToSeed();
  }

  // ===== Clear previous demo records =====
  //
  // The seeder upserts by natural key, which is safe but not self-healing: a
  // record created by an older version of this script keeps its original
  // reference forever. That is exactly what happened — three complaints written
  // as DEMO-CMP-0001 survived a re-seed alongside the new canonical ones, and
  // every one of them 400s when opened, because the identifier schema requires
  // the canonical format.
  //
  // Only records flagged `isDemo` are removed, and only under --force, so real
  // data is never touched and a casual run still refuses to destroy anything.
  if (force) {
    const removed = await purgeDemoRecords();
    if (removed.total > 0) {
      process.stdout.write(
        `  cleared ${removed.total} demo record(s) from a previous run: ` +
          Object.entries(removed)
            .filter(([key]) => key !== "total")
            .map(([key, count]) => `${key}=${count}`)
            .join(" ") +
          "\n"
      );
    }
  }

  const students = [];

  // ===== Departments =====
  const departmentSpecs = [
    { name: `${DEMO_PREFIX} Computer Science & Engineering`, code: "DEMO-CSE" },
    { name: `${DEMO_PREFIX} Electronics & Communication`, code: "DEMO-ECE" },
    { name: `${DEMO_PREFIX} Mechanical Engineering`, code: "DEMO-MECH" },
    { name: `${DEMO_PREFIX} Student Affairs`, code: "DEMO-SAFF" },
  ];

  const departments = {};
  for (const spec of departmentSpecs) {
    departments[spec.code] = await Department.findOneAndUpdate(
      { code: spec.code },
      { $set: { name: spec.name, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  process.stdout.write(`  departments      : ${Object.keys(departments).length}\n`);

  // ===== Programmes =====
  const programSpecs = [
    {
      name: `${DEMO_PREFIX} B.Tech Computer Science`,
      code: "DEMO-BTCS",
      department: "DEMO-CSE",
      level: "UNDERGRADUATE",
      durationYears: 4,
    },
    {
      name: `${DEMO_PREFIX} B.Tech Electronics`,
      code: "DEMO-BTEC",
      department: "DEMO-ECE",
      level: "UNDERGRADUATE",
      durationYears: 4,
    },
    {
      name: `${DEMO_PREFIX} B.Tech Mechanical`,
      code: "DEMO-BTME",
      department: "DEMO-MECH",
      level: "UNDERGRADUATE",
      durationYears: 4,
    },
  ];

  const programs = {};
  for (const spec of programSpecs) {
    programs[spec.code] = await Program.findOneAndUpdate(
      { code: spec.code },
      {
        $set: {
          name: spec.name,
          department: departments[spec.department]._id,
          level: spec.level,
          durationYears: spec.durationYears,
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  process.stdout.write(`  programmes       : ${Object.keys(programs).length}\n`);

  // ===== Staff accounts, one per role =====
  // Covers every role so all permission paths can be exercised in the UI.
  const staffSpecs = [
    {
      email: "demo.hod@campusos.local",
      fullName: `${DEMO_PREFIX} HOD`,
      role: ROLES.HOD,
      department: "DEMO-CSE",
      designation: "Head of Department, Computer Science",
    },
    {
      email: "demo.faculty@campusos.local",
      fullName: `${DEMO_PREFIX} Faculty`,
      role: ROLES.FACULTY,
      department: "DEMO-CSE",
      designation: "Associate Professor",
      expertise: ["Machine Learning", "Distributed Systems", "IoT"],
    },
    {
      email: "demo.support@campusos.local",
      fullName: `${DEMO_PREFIX} Support Staff`,
      role: ROLES.SUPPORT_STAFF,
      department: "DEMO-SAFF",
      designation: "Front Desk",
    },
    {
      email: "demo.accounts@campusos.local",
      fullName: `${DEMO_PREFIX} Accounts Admin`,
      role: ROLES.ACCOUNTS_ADMIN,
      department: "DEMO-SAFF",
      designation: "Accounts Officer",
      expertise: ["Fee refunds", "Scholarship disbursement"],
    },
    {
      email: "demo.exam@campusos.local",
      fullName: `${DEMO_PREFIX} Exam Admin`,
      role: ROLES.EXAM_ADMIN,
      department: "DEMO-SAFF",
      designation: "Controller of Examinations",
    },
    {
      email: "demo.dean@campusos.local",
      fullName: `${DEMO_PREFIX} Dean`,
      role: ROLES.DEAN,
      designation: "Dean of Academics",
      expertise: ["Curriculum policy"],
    },
    {
      email: "demo.principal@campusos.local",
      fullName: `${DEMO_PREFIX} Principal`,
      role: ROLES.PRINCIPAL,
      designation: "Principal",
    },
    /*
     * A demo administrator, and only for the demo database.
     *
     * In a real deployment the first super administrator is created by
     * `npm run create-admin` on the server, because an endpoint anyone can
     * reach would let whoever found it first claim the institution. Seeding one
     * is safe precisely because this script only ever runs against demo data —
     * but it is worth being explicit that this role is otherwise unreachable
     * through the API.
     */
    {
      email: "demo.admin@campusos.local",
      fullName: `${DEMO_PREFIX} Administrator`,
      role: ROLES.SUPER_ADMIN,
      designation: "Administrator",
    },
  ];

  const staff = {};
  for (const spec of staffSpecs) {
    staff[spec.role] = await seedUser({
      email: spec.email,
      fullName: spec.fullName,
      role: spec.role,
      departmentId: departments[spec.department]?._id,
      designation: spec.designation,
      expertise: spec.expertise,
    });
  }
  process.stdout.write(`  staff accounts   : ${Object.keys(staff).length}\n`);

  // ===== Students =====
  const studentSpecs = [
    {
      roll: "DEMO-CS-001",
      name: "Ananya Sharma",
      program: "DEMO-BTCS",
      department: "DEMO-CSE",
      semester: 5,
      year: 3,
      section: "A",
      feeStatus: "DUE",
    },
    {
      roll: "DEMO-CS-002",
      name: "Rahul Verma",
      program: "DEMO-BTCS",
      department: "DEMO-CSE",
      semester: 5,
      year: 3,
      section: "A",
      feeStatus: "CLEAR",
    },
    {
      roll: "DEMO-EC-001",
      name: "Meera Iyer",
      program: "DEMO-BTEC",
      department: "DEMO-ECE",
      semester: 3,
      year: 2,
      section: "B",
      feeStatus: "OVERDUE",
    },
    {
      roll: "DEMO-ME-001",
      name: "Kabir Nair",
      program: "DEMO-BTME",
      department: "DEMO-MECH",
      semester: 7,
      year: 4,
      section: "A",
      feeStatus: "PARTIALLY_PAID",
    },
  ];

  for (const spec of studentSpecs) {
    const email = `demo.student.${spec.roll.toLowerCase().replace(/[^a-z0-9]/g, "")}@campusos.local`;
    const user = await seedUser({
      email,
      fullName: spec.name,
      role: ROLES.STUDENT,
      departmentId: departments[spec.department]._id,
    });

    const student = await Student.findOneAndUpdate(
      { rollNumber: spec.roll },
      {
        $set: {
          user: user._id,
          program: programs[spec.program]._id,
          department: departments[spec.department]._id,
          semester: spec.semester,
          year: spec.year,
          section: spec.section,
          enrolmentDate: new Date(`${2024 - spec.year}-08-01T00:00:00Z`),
          batchYear: 2024 - spec.year,
          feeStatus: spec.feeStatus,
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Back-link the profile to the account.
    await User.updateOne({ _id: user._id }, { $set: { student: student._id } });

    // Kept for the sample requests and complaints below, which are attached to
    // specific students rather than picked afresh each time.
    students.push({ user, student });
  }
  process.stdout.write(`  student accounts : ${students.length}\n`);

  // ===== Request types =====
  // Without a catalogue the demo has nothing to apply for, so this is the
  // part that makes the request engine demonstrable at all.
  const requestTypeSpecs = [
    {
      name: `${DEMO_PREFIX} Bonafide Certificate`,
      code: "DEMO_BONAFIDE",
      department: "DEMO-CSE",
      description: "Certificate confirming a student's enrolment and standing.",
      fields: [
        {
          name: "copies",
          label: "Number of copies",
          type: "NUMBER",
          required: true,
          min: 1,
          max: 5,
        },
        {
          name: "purpose",
          label: "Purpose",
          type: "TEXT",
          required: true,
          maxLength: 300,
        },
      ],
      requiredDocuments: [
        {
          name: "ID proof",
          description: "Government or college identity card",
          required: true,
        },
      ],
      slaHours: 72,
    },
    {
      name: `${DEMO_PREFIX} Study Certificate`,
      code: "DEMO_STUDY",
      department: "DEMO-CSE",
      description: "Certificate of current enrolment for a specific academic year.",
      fields: [
        {
          name: "academicYear",
          label: "Academic year",
          type: "SELECT",
          required: true,
          options: ["2024-25", "2025-26"],
        },
      ],
      slaHours: 96,
    },
    {
      name: `${DEMO_PREFIX} No Dues Certificate`,
      code: "DEMO_NODUES",
      department: "DEMO-SAFF",
      description:
        "Confirms the student has no outstanding dues. Requires fee clearance.",
      fields: [
        { name: "note", label: "Additional note", type: "TEXTAREA", required: false },
      ],
      requiresFeeClearance: true,
      requiresPayment: true,
      slaHours: 120,
    },
    {
      name: `${DEMO_PREFIX} Transcript Request`,
      code: "DEMO_TRANSCRIPT",
      department: "DEMO-ECE",
      description: "Full academic transcript including grades.",
      fields: [
        {
          name: "years",
          label: "Number of years",
          type: "NUMBER",
          required: true,
          min: 1,
          max: 4,
        },
      ],
      slaHours: 168,
    },
  ];

  const requestTypes = [];
  for (const spec of requestTypeSpecs) {
    requestTypes.push(
      await RequestType.findOneAndUpdate(
        { code: spec.code },
        {
          $set: {
            name: spec.name,
            description: spec.description,
            department: departments[spec.department]._id,
            fields: spec.fields ?? [],
            requiredDocuments: spec.requiredDocuments ?? [],
            slaHours: spec.slaHours ?? 72,
            requiresPayment: spec.requiresPayment ?? false,
            requiresFeeClearance: spec.requiresFeeClearance ?? false,
            isActive: true,
            isDemo: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    );
  }
  process.stdout.write(`  request types    : ${requestTypes.length}\n`);

  // ===== Sample requests =====
  // A couple of seeded requests give the management dashboard something to
  // show without inventing operational history.
  const sampleRequests = [
    {
      student: students[0],
      type: requestTypes[0],
      status: "SUBMITTED",
      title: "Bonafide certificate for a bank loan",
    },
    {
      student: students[0],
      type: requestTypes[1],
      status: "UNDER_REVIEW",
      title: "Study certificate for passport application",
    },
    {
      student: students[1],
      type: requestTypes[2],
      status: "APPROVED",
      title: "No dues certificate for internship",
    },
  ];

  for (const sample of sampleRequests) {
    const now = new Date();
    await Request.findOneAndUpdate(
      { reference: await demoReference("REQ") },
      {
        $set: {
          reference: await demoReference("REQ"),
          requestType: sample.type._id,
          student: sample.student.student._id,
          department: sample.type.department,
          title: sample.title,
          data: {},
          description: "Seeded demo request.",
          status: sample.status,
          submittedAt: now,
          dueAt: new Date(now.getTime() + (sample.type.slaHours ?? 72) * 3600 * 1000),
          isDemo: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  process.stdout.write(`  sample requests  : ${sampleRequests.length}\n`);

  // ===== Sample complaints =====
  // Includes a confidential one so the restricted queue can be demonstrated.
  const sampleComplaints = [
    {
      student: students[0],
      category: "HOSTEL",
      subject: "DEMO Water supply in Block C",
      description:
        "DEMO: There has been no water supply to the second floor since Monday.",
      confidential: false,
      priority: "MEDIUM",
      status: "INVESTIGATING",
      hoursOverdue: 3,
    },
    {
      student: students[1],
      category: "FEES",
      subject: "DEMO Duplicate fee payment charged",
      description:
        "DEMO: A fee instalment appears to have been deducted twice this term.",
      confidential: false,
      priority: "HIGH",
      status: "OPEN",
      hoursOverdue: 26,
    },
    {
      student: students[2],
      category: "HARASSMENT",
      subject: "DEMO Confidential grievance",
      description:
        "DEMO: A confidential matter. Visible only to the complainant, the assigned handler and oversight roles.",
      confidential: true,
      priority: "CRITICAL",
      status: "ACKNOWLEDGED",
      hoursOverdue: 1,
    },
  ];

  const { addBusinessHours } = require("../src/utils/sla");
  const slaPolicy = require("../src/utils/slaPolicy");
  for (const sample of sampleComplaints) {
    const now = new Date();
    const dueAt = addBusinessHours(
      now,
      slaPolicy.responseHoursFor(sample.category) - sample.hoursOverdue
    );
    await Complaint.findOneAndUpdate(
      { reference: await demoReference("CMP") },
      {
        $set: {
          reference: await demoReference("CMP"),
          student: sample.student.student._id,
          department: sample.student.student.department,
          subject: sample.subject,
          description: sample.description,
          category: sample.category,
          confidential: sample.confidential,
          priority: sample.priority,
          status: sample.status,
          dueAt,
          submittedAt: new Date(now.getTime() - (sample.hoursOverdue + 48) * 3600 * 1000),
          respondedAt: sample.status === "OPEN" ? null : now,
          isDemo: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  process.stdout.write(`  sample complaints: ${sampleComplaints.length}\n`);

  // ===== Sample certificates =====
  // A generated one needs a real PDF, so the certificate service is used
  // rather than inserting a row with a fabricated storage key.
  const certificateService = require("../src/services/certificate.service");

  const certHod = staff[ROLES.HOD];
  let generatedCertificates = 0;

  for (const spec of [
    { type: "BONAFIDE", purpose: "Bank loan application", issue: true },
    { type: "TRANSCRIPT", purpose: "Postgraduate admission", issue: false },
  ]) {
    /**
     * Re-read the student from the database rather than using the in-memory
     * record captured earlier in this run.
     *
     * On a database that already held demo data the cached copy was populated
     * and happened to work. On an empty one the `student` link is unset, so
     * `apply` correctly refused a non-student account and seeding aborted. The
     * certificate service checks `user.student`, so the applicant has to come
     * from a fresh read rather than from whatever the seed loop held.
     */
    const applicant = await Student.findOne({})
      .sort({ rollNumber: 1 })
      .populate("user")
      .exec();

    let certificate = await Certificate.findOne({
      reference: await demoReference("CERT"),
    });

    if (!certificate) {
      certificate = await certificateService.apply({
        user: applicant.user,
        type: spec.type,
        purpose: spec.purpose,
      });
      // Mark the seeded row so the demo banner can identify it.
      await Certificate.updateOne({ _id: certificate._id }, { $set: { isDemo: true } });
    }

    if (!spec.issue || certificate.status === "GENERATED") continue;

    for (const [from, to] of [
      ["APPLIED", "VALIDATING"],
      ["VALIDATING", "VERIFYING"],
      ["VERIFYING", "APPROVED"],
    ]) {
      if (certificate.status !== from) continue;
      certificate = await certificateService.transition({
        certificateId: certificate._id,
        to,
        expectedFrom: from,
        user: certHod,
      });
    }

    try {
      await certificateService.generate({
        certificateId: certificate._id,
        user: certHod,
      });
      generatedCertificates += 1;
    } catch (error) {
      process.stderr.write(`  (certificate issuance skipped: ${error.message})\n`);
    }
  }

  const totalCertificates = await Certificate.countDocuments({});
  process.stdout.write(
    `  certificates     : ${totalCertificates} (${generatedCertificates} issued)\n`
  );

  // ===== Demo flag =====
  // Read by the frontend to render the "DEMO DATA" banner.
  await mongoose.connection.db.collection("settings").updateOne(
    { key: "demoData" },
    {
      $set: {
        key: "demoData",
        value: {
          enabled: true,
          seededAt: new Date(),
          note: "This database contains DEMO data generated by `npm run seed:demo`. Do not treat it as real college data.",
        },
      },
    },
    { upsert: true }
  );
  process.stdout.write("  demo flag        : settings.demoData.enabled = true\n");

  process.stdout.write(
    `\nSeeded. All demo accounts share the password: ${DEMO_PASSWORD}\n` +
      `Sign in as e.g. demo.hod@campusos.local to explore a management view.\n` +
      "The interface displays a persistent DEMO DATA banner while this data is present.\n\n"
  );

  await disconnectDB();
  mongoose.connection.close();
  process.exit(0);
}

main().catch(async (error) => {
  process.stderr.write(`\nSeeding failed: ${error.message}\n\n`);
  try {
    await disconnectDB();
  } catch {
    /* already disconnected */
  }
  process.exit(1);
});
