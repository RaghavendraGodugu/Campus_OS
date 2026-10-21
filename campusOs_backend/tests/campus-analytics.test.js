/**
 * Campus analytics.
 *
 * The interesting behaviour is the shape of the answer: figures are aggregated
 * from the operational collections, and a section the caller cannot read is
 * absent rather than zero.
 */
const mongoose = require("mongoose");
const {
  resetDatabase,
  createUser,
  createDepartment,
  createProgram,
  createStudent,
  loginAs,
} = require("./helpers/factory");

const Hostel = require("../src/models/Hostel");
const HostelRoom = require("../src/models/HostelRoom");
const HostelAllocation = require("../src/models/HostelAllocation");
const HostelLeave = require("../src/models/HostelLeave");
const Book = require("../src/models/Book");
const BookIssue = require("../src/models/BookIssue");
const Company = require("../src/models/Company");
const PlacementDrive = require("../src/models/PlacementDrive");
const PlacementApplication = require("../src/models/PlacementApplication");
const AcademicTerm = require("../src/models/AcademicTerm");
const Subject = require("../src/models/Subject");
const AttendanceSession = require("../src/models/AttendanceSession");
const Assessment = require("../src/models/Assessment");
const AssessmentMark = require("../src/models/AssessmentMark");
const ResultRelease = require("../src/models/ResultRelease");

const analytics = require("../src/services/campusAnalytics.service");
const {
  ROLES,
  ACADEMIC_TERM_STATUS,
  PLACEMENT_APPLICATION_STATUS,
} = require("../src/config/constants");

const DAY = 86400000;

async function seed() {
  const department = await createDepartment();
  const program = await createProgram(department);
  const dean = await createUser({ role: ROLES.DEAN });
  const wardens = await createUser({ role: ROLES.HOSTEL_ADMIN });
  const librarian = await createUser({ role: ROLES.LIBRARY_ADMIN });
  const placement = await createUser({ role: ROLES.PLACEMENT_ADMIN });
  const student = await createStudent({ department, program });
  const student2 = await createStudent({ department, program });

  // ===== Hostel: 2 blocks? one block, two rooms, 5 beds, 2 occupied =====
  const hostel = await Hostel.create({ name: "Ganga Block", code: "GB", kind: "COED" });
  const roomA = await HostelRoom.create({
    hostel: hostel._id,
    number: "101",
    capacity: 2,
  });
  await HostelRoom.create({ hostel: hostel._id, number: "102", capacity: 3 });

  await HostelAllocation.create({
    student: student.student._id,
    hostel: hostel._id,
    room: roomA._id,
    academicYear: "2026-27",
    allocatedBy: wardens._id,
  });
  await HostelAllocation.create({
    student: student2.student._id,
    hostel: hostel._id,
    room: roomA._id,
    academicYear: "2026-27",
    allocatedBy: wardens._id,
  });
  await HostelLeave.create({
    student: student.student._id,
    allocation: new mongoose.Types.ObjectId(),
    fromDate: new Date(),
    toDate: new Date(Date.now() + DAY),
    reason: "Family function",
  });

  // ===== Library: 5 copies, 2 on loan, 1 overdue =====
  const book = await Book.create({
    title: "Clean Code",
    author: "Robert Martin",
    copiesTotal: 5,
    copiesIssued: 2,
  });
  await BookIssue.create({
    book: book._id,
    student: student.student._id,
    issuedBy: librarian._id,
    dueAt: new Date(Date.now() - 2 * DAY),
  });
  await BookIssue.create({
    book: book._id,
    student: student2.student._id,
    issuedBy: librarian._id,
    dueAt: new Date(Date.now() + 5 * DAY),
  });

  // ===== Placements: 1 open, 1 draft, 1 closed; 3 applications, 1 selected =====
  const company = await Company.create({ name: "Acme Software", sector: "Software" });
  const drive = await PlacementDrive.create({
    company: company._id,
    title: "Graduate Engineer",
    role: "SDE",
    applicationDeadline: new Date(Date.now() + 5 * DAY),
    driveDate: new Date(Date.now() + 10 * DAY),
    status: "OPEN",
    createdBy: placement._id,
  });
  await PlacementDrive.create({
    company: company._id,
    title: "Draft Drive",
    role: "Intern",
    applicationDeadline: new Date(Date.now() + 5 * DAY),
    driveDate: new Date(Date.now() + 10 * DAY),
    status: "DRAFT",
    createdBy: placement._id,
  });
  await PlacementDrive.create({
    company: company._id,
    title: "Old Drive",
    role: "Analyst",
    applicationDeadline: new Date(Date.now() - 5 * DAY),
    driveDate: new Date(Date.now() - DAY),
    status: "CLOSED",
    createdBy: placement._id,
  });

  for (const [person, status] of [
    [student, PLACEMENT_APPLICATION_STATUS.APPLIED],
    [student2, PLACEMENT_APPLICATION_STATUS.SELECTED],
  ]) {
    await PlacementApplication.create({
      drive: drive._id,
      student: person.student._id,
      status,
    });
  }
  await PlacementApplication.create({
    drive: drive._id,
    student: new mongoose.Types.ObjectId(),
    status: PLACEMENT_APPLICATION_STATUS.REJECTED,
  });

  // ===== Academics: one session, 2 marks, 1 attended; one release =====
  const term = await AcademicTerm.create({
    name: "Autumn 2026",
    code: "A26",
    kind: "SEMESTER",
    academicYear: "2026-27",
    startsOn: new Date("2026-08-01T00:00:00.000Z"),
    endsOn: new Date("2026-12-20T00:00:00.000Z"),
    status: ACADEMIC_TERM_STATUS.OPEN,
    isCurrent: true,
  });
  const subject = await Subject.create({
    code: "CS301",
    name: "Database Systems",
    department: department._id,
    program: program._id,
    semester: 5,
  });

  await AttendanceSession.create({
    entry: new mongoose.Types.ObjectId(),
    term: term._id,
    subject: subject._id,
    faculty: wardens._id,
    date: new Date("2026-10-05T00:00:00.000Z"),
    records: [
      { student: student.student._id, status: "PRESENT" },
      { student: student2.student._id, status: "ABSENT" },
    ],
    markedBy: wardens._id,
  });

  const assessment = await Assessment.create({
    term: term._id,
    subject: subject._id,
    name: "Internal 1",
    maxMarks: 20,
  });
  await AssessmentMark.create({
    assessment: assessment._id,
    subject: subject._id,
    term: term._id,
    student: student.student._id,
    marksObtained: 18,
  });
  await ResultRelease.create({
    term: term._id,
    program: program._id,
    publishedBy: dean._id,
  });

  return { department, program, dean, wardens, librarian, placement, student, term };
}

describe("campus analytics", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("gives a dean every section with aggregated figures", async () => {
    const world = await seed();

    const { sections } = await analytics.campus({ user: world.dean });

    expect(Object.keys(sections).sort()).toEqual([
      "academics",
      "hostel",
      "library",
      "placements",
    ]);

    expect(sections.hostel).toMatchObject({
      blocks: 1,
      rooms: 2,
      beds: 5,
      occupied: 2,
      occupancyPercentage: 40,
      pendingLeaves: 1,
    });

    expect(sections.library).toMatchObject({
      titles: 1,
      copies: 5,
      onLoan: 2,
      available: 3,
      overdue: 1,
    });

    expect(sections.placements.drives).toMatchObject({
      open: 1,
      draft: 1,
      closed: 1,
      total: 3,
    });
    expect(sections.placements.applications.total).toBe(3);
    expect(sections.placements.selectionPercentage).toBe(33.3);

    expect(sections.academics).toMatchObject({
      sessions: 1,
      marks: 2,
      averageAttendance: 50,
      resultsReleased: 1,
      assessments: 1,
      marksEntered: 1,
    });
  });

  it("gives each operational role only their own section", async () => {
    const world = await seed();

    const warden = await analytics.campus({ user: world.wardens });
    expect(Object.keys(warden.sections)).toEqual(["hostel"]);

    const librarian = await analytics.campus({ user: world.librarian });
    expect(Object.keys(librarian.sections)).toEqual(["library"]);

    const placement = await analytics.campus({ user: world.placement });
    expect(Object.keys(placement.sections)).toEqual(["placements"]);
  });

  it("returns no sections for a student and refuses the endpoint over HTTP", async () => {
    const world = await seed();

    const { sections } = await analytics.campus({ user: world.student.user });
    expect(sections).toEqual({});

    const { agent } = await loginAs(world.student.user);
    const res = await agent.get("/api/v1/analytics/campus");
    expect(res.status).toBe(403);
  });
});
