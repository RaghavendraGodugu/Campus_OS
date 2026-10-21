#!/usr/bin/env node
/**
 * Seed a small, real campus-operations demo:
 *
 *  - the three operational accounts the original demo data never had;
 *  - one hostel block and room, an allocation for the demo student, and a
 *    pending leave request;
 *  - one book, issued to that student;
 *  - one company and an open drive, with the student's application.
 *
 * Idempotent: every record is found before it is created. Run it from the
 * backend directory so `.env` is loaded:
 *
 *     node scripts/seed-campus-demo.js
 */
const { connectDB, disconnectDB } = require("../src/config/db");
const { logger } = require("../src/config/logger");

const User = require("../src/models/User");
const Student = require("../src/models/Student");
const Hostel = require("../src/models/Hostel");
const HostelRoom = require("../src/models/HostelRoom");
const HostelAllocation = require("../src/models/HostelAllocation");
const HostelLeave = require("../src/models/HostelLeave");
const Book = require("../src/models/Book");
const BookIssue = require("../src/models/BookIssue");
const Company = require("../src/models/Company");
const PlacementDrive = require("../src/models/PlacementDrive");
const PlacementApplication = require("../src/models/PlacementApplication");

const PASSWORD = "Demo@Campus123";
const STUDENT_EMAIL = "demo.student.democs001@campusos.local";

async function ensureUser(email, fullName, role) {
  let user = await User.findOne({ email });
  if (!user) {
    user = new User({ email, fullName, role });
    await user.setPassword(PASSWORD);
    await user.save();
    logger.info({ email, role }, "campus demo user created");
  }
  return user;
}

async function main() {
  await connectDB();

  await ensureUser("demo.hostel@campusos.local", "Demo Hostel Warden", "HOSTEL_ADMIN");
  await ensureUser("demo.library@campusos.local", "Demo Librarian", "LIBRARY_ADMIN");
  await ensureUser(
    "demo.placement@campusos.local",
    "Demo Placement Officer",
    "PLACEMENT_ADMIN"
  );

  const studentUser = await User.findOne({ email: STUDENT_EMAIL });
  if (!studentUser)
    throw new Error(`Demo student ${STUDENT_EMAIL} not found — run seed:demo first`);
  const student = await Student.findOne({ user: studentUser._id });
  if (!student) throw new Error("Demo student has no Student record");

  // ===== Hostel =====
  let hostel = await Hostel.findOne({ code: "GB" });
  if (!hostel) {
    hostel = await Hostel.create({ name: "Ganga Block", code: "GB", kind: "COED" });
    logger.info("hostel created");
  }

  let room = await HostelRoom.findOne({ hostel: hostel._id, number: "101" });
  if (!room) {
    room = await HostelRoom.create({ hostel: hostel._id, number: "101", capacity: 2 });
    logger.info("hostel room created");
  }

  let allocation = await HostelAllocation.findOne({
    student: student._id,
    status: "ACTIVE",
  });
  if (!allocation) {
    allocation = await HostelAllocation.create({
      student: student._id,
      hostel: hostel._id,
      room: room._id,
      academicYear: "2026-27",
      allocatedBy: (
        await ensureUser(
          "demo.hostel@campusos.local",
          "Demo Hostel Warden",
          "HOSTEL_ADMIN"
        )
      )._id,
    });
    logger.info("hostel allocation created");
  }

  const leaveExists = await HostelLeave.findOne({
    student: student._id,
    status: "PENDING",
  });
  if (!leaveExists) {
    const from = new Date();
    from.setDate(from.getDate() + 3);
    const to = new Date(from);
    to.setDate(to.getDate() + 2);
    await HostelLeave.create({
      student: student._id,
      allocation: allocation._id,
      fromDate: from,
      toDate: to,
      reason: "Going home for a family function.",
    });
    logger.info("hostel leave created");
  }

  // ===== Library =====
  let book = await Book.findOne({ title: "Clean Code" });
  if (!book) {
    book = await Book.create({
      title: "Clean Code",
      author: "Robert C. Martin",
      category: "Computer Science",
      copiesTotal: 3,
    });
    logger.info("book created");
  }

  const activeIssue = await BookIssue.findOne({
    book: book._id,
    student: student._id,
    status: "ISSUED",
  });
  if (!activeIssue) {
    const due = new Date();
    due.setDate(due.getDate() + 14);
    await BookIssue.create({
      book: book._id,
      student: student._id,
      issuedBy: (
        await ensureUser("demo.library@campusos.local", "Demo Librarian", "LIBRARY_ADMIN")
      )._id,
      dueAt: due,
    });
    await Book.updateOne({ _id: book._id }, { $inc: { copiesIssued: 1 } });
    logger.info("book issued");
  }

  // ===== Placements =====
  let company = await Company.findOne({ name: "Acme Software" });
  if (!company) {
    company = await Company.create({ name: "Acme Software", sector: "Software" });
    logger.info("company created");
  }

  let drive = await PlacementDrive.findOne({
    company: company._id,
    title: "Graduate Engineer 2027",
  });
  if (!drive) {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 20);
    const driveDate = new Date();
    driveDate.setDate(driveDate.getDate() + 30);
    drive = await PlacementDrive.create({
      company: company._id,
      title: "Graduate Engineer 2027",
      role: "Software Engineer",
      location: "Bengaluru",
      ctcPaise: 1200000 * 100,
      applicationDeadline: deadline,
      driveDate,
      status: "OPEN",
      eligibleSemesters: [5, 6],
      createdBy: (
        await ensureUser(
          "demo.placement@campusos.local",
          "Demo Placement Officer",
          "PLACEMENT_ADMIN"
        )
      )._id,
    });
    logger.info("drive created");
  }

  const applied = await PlacementApplication.findOne({
    drive: drive._id,
    student: student._id,
  });
  if (!applied) {
    await PlacementApplication.create({ drive: drive._id, student: student._id });
    logger.info("application created");
  }

  logger.info("campus demo seed complete");
  await disconnectDB();
}

main().catch(async (error) => {
  logger.error({ err: error }, "campus demo seed failed");
  await disconnectDB().catch(() => {});
  process.exit(1);
});
