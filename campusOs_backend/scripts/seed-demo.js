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
const { Department, Program, Student, User } = require("../src/models");

/** Prefix applied to every demo record so it is never mistaken for real. */
const DEMO_PREFIX = "DEMO";

/** Shared password for all demo accounts. Documented, never used in production. */
const DEMO_PASSWORD = "Demo@Campus123";

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
async function seedUser({ email, fullName, role, studentId, departmentId }) {
  const setFields = { fullName, role, isActive: true };
  if (studentId) setFields.student = studentId;
  if (departmentId) setFields.department = departmentId;

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

  // NOTE: this script never deletes. It only upserts by natural key, so
  // re-running is safe and existing real data is preserved.
  if (!force) {
    await assertDatabaseIsSafeToSeed();
  }

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
    },
    {
      email: "demo.faculty@campusos.local",
      fullName: `${DEMO_PREFIX} Faculty`,
      role: ROLES.FACULTY,
      department: "DEMO-CSE",
    },
    {
      email: "demo.support@campusos.local",
      fullName: `${DEMO_PREFIX} Support Staff`,
      role: ROLES.SUPPORT_STAFF,
      department: "DEMO-SAFF",
    },
    {
      email: "demo.accounts@campusos.local",
      fullName: `${DEMO_PREFIX} Accounts Admin`,
      role: ROLES.ACCOUNTS_ADMIN,
      department: "DEMO-SAFF",
    },
    {
      email: "demo.exam@campusos.local",
      fullName: `${DEMO_PREFIX} Exam Admin`,
      role: ROLES.EXAM_ADMIN,
      department: "DEMO-SAFF",
    },
    {
      email: "demo.dean@campusos.local",
      fullName: `${DEMO_PREFIX} Dean`,
      role: ROLES.DEAN,
    },
    {
      email: "demo.principal@campusos.local",
      fullName: `${DEMO_PREFIX} Principal`,
      role: ROLES.PRINCIPAL,
    },
  ];

  const staff = {};
  for (const spec of staffSpecs) {
    staff[spec.role] = await seedUser({
      email: spec.email,
      fullName: spec.fullName,
      role: spec.role,
      departmentId: departments[spec.department]?._id,
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

  const students = [];
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
    students.push({ user, student });
  }
  process.stdout.write(`  student accounts : ${students.length}\n`);

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
