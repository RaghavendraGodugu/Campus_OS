/**
 * Marks and results.
 *
 * The behaviour that matters:
 *
 *  - components are per subject and term, with their own maximum;
 *  - a mark cannot exceed that maximum, and only the class's teacher may enter it;
 *  - a student sees nothing until the programme's results are released;
 *  - release refuses while any mark is missing;
 *  - the percentage and grade are derived, so correcting a mark changes them;
 *  - a HOD can release their own department's programmes and no others.
 */

const {
  resetDatabase,
  createUser,
  createDepartment,
  createProgram,
  createStudent,
  loginAs,
} = require("./helpers/factory");

const AcademicTerm = require("../src/models/AcademicTerm");
const ResultRelease = require("../src/models/ResultRelease");
const AuditLog = require("../src/models/AuditLog");

const subjectService = require("../src/services/subject.service");
const roomService = require("../src/services/room.service");
const timetableService = require("../src/services/timetable.service");
const resultService = require("../src/services/result.service");

const { ROLES, ACADEMIC_TERM_STATUS, AUDIT_ACTION } = require("../src/config/constants");

async function seed() {
  const department = await createDepartment();
  const program = await createProgram(department);
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

  const admin = await createUser({ role: ROLES.SUPER_ADMIN });
  const exam = await createUser({ role: ROLES.EXAM_ADMIN, department });
  const faculty = await createUser({ role: ROLES.FACULTY, department });
  const otherFaculty = await createUser({ role: ROLES.FACULTY, department });

  const room = await roomService.create({
    user: admin,
    payload: { block: "Academic Block A", name: "LH-204", capacity: 60 },
  });

  const subject = await subjectService.create({
    user: admin,
    payload: {
      code: "CS301",
      name: "Database Systems",
      department: department._id,
      program: program._id,
      semester: 5,
      credits: 4,
    },
  });

  await timetableService.create({
    user: admin,
    payload: {
      term: term._id,
      subject: subject.id,
      faculty: faculty._id,
      room: room.id,
      dayOfWeek: 1,
      startMinute: 540,
      endMinute: 600,
    },
  });

  const first = await createStudent({ department, program });
  const second = await createStudent({ department, program });

  const internal = await resultService.createAssessment({
    user: faculty,
    payload: {
      term: term._id,
      subject: subject.id,
      name: "Internal 1",
      kind: "INTERNAL",
      maxMarks: 20,
    },
  });

  const final = await resultService.createAssessment({
    user: faculty,
    payload: {
      term: term._id,
      subject: subject.id,
      name: "End Semester",
      kind: "EXTERNAL",
      maxMarks: 80,
    },
  });

  return {
    department,
    program,
    term,
    admin,
    exam,
    faculty,
    otherFaculty,
    subject,
    first,
    second,
    internal,
    final,
  };
}

function marks(world, { first = [15, 60], second = [5, 20] } = {}) {
  return [
    {
      assessment: world.internal.id,
      marks: [
        { student: String(world.first.student._id), marksObtained: first[0] },
        { student: String(world.second.student._id), marksObtained: second[0] },
      ],
    },
    {
      assessment: world.final.id,
      marks: [
        { student: String(world.first.student._id), marksObtained: first[1] },
        { student: String(world.second.student._id), marksObtained: second[1] },
      ],
    },
  ];
}

async function enterAll(world, values) {
  for (const entry of marks(world, values)) {
    await resultService.saveMarks({
      user: world.faculty,
      payload: entry,
    });
  }
}

async function publish(world, user = world.exam) {
  return resultService.publish({
    user,
    payload: { term: world.term._id, program: world.program._id },
  });
}

describe("marks and results", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates components with their own maximum and refuses a duplicate name", async () => {
    const world = await seed();

    const listed = await resultService.listAssessments({
      user: world.faculty,
      subjectId: world.subject.id,
    });

    expect(listed.assessments).toHaveLength(2);
    expect(listed.assessments.map((a) => a.maxMarks).sort((a, b) => a - b)).toEqual([
      20, 80,
    ]);

    await expect(
      resultService.createAssessment({
        user: world.faculty,
        payload: {
          term: world.term._id,
          subject: world.subject.id,
          name: "Internal 1",
          kind: "INTERNAL",
          maxMarks: 10,
        },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses marks above the component maximum", async () => {
    const world = await seed();

    await expect(
      resultService.saveMarks({
        user: world.faculty,
        payload: {
          assessment: world.internal.id,
          marks: [{ student: String(world.first.student._id), marksObtained: 25 }],
        },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses marks from a teacher who does not teach the subject", async () => {
    const world = await seed();

    await expect(
      resultService.saveMarks({
        user: world.otherFaculty,
        payload: {
          assessment: world.internal.id,
          marks: [{ student: String(world.first.student._id), marksObtained: 10 }],
        },
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("shows a student nothing before the programme is released", async () => {
    const world = await seed();
    await enterAll(world);

    const before = await resultService.studentResults({ user: world.first.user });
    expect(before.published).toBe(false);
    expect(before.results).toEqual([]);
  });

  it("refuses to release while a mark is missing", async () => {
    const world = await seed();

    // One student's end-semester mark is missing.
    await resultService.saveMarks({
      user: world.faculty,
      payload: marks(world)[0],
    });
    await resultService.saveMarks({
      user: world.faculty,
      payload: {
        assessment: world.final.id,
        marks: [{ student: String(world.first.student._id), marksObtained: 60 }],
      },
    });

    await expect(publish(world)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("releases results and gives each student their derived grade", async () => {
    const world = await seed();
    await enterAll(world, { first: [15, 60], second: [5, 20] });

    const released = await publish(world);
    expect(released.alreadyPublished).toBe(false);
    await expect(ResultRelease.countDocuments()).resolves.toBe(1);

    const audit = await AuditLog.findOne({
      action: AUDIT_ACTION.RESULTS_PUBLISHED,
    }).lean();
    expect(audit).not.toBeNull();

    const firstView = await resultService.studentResults({ user: world.first.user });
    expect(firstView.published).toBe(true);
    expect(firstView.results).toHaveLength(1);
    expect(firstView.results[0]).toMatchObject({
      obtained: 75,
      maxMarks: 100,
      percentage: 75,
      grade: "A",
      status: "PASS",
    });
    expect(firstView.arrears).toHaveLength(0);

    const secondView = await resultService.studentResults({ user: world.second.user });
    expect(secondView.results[0]).toMatchObject({
      percentage: 25,
      grade: "F",
      status: "FAIL",
    });
    expect(secondView.arrears[0].code).toBe("CS301");
  });

  it("recomputes the grade when a mark is corrected", async () => {
    const world = await seed();
    await enterAll(world);
    await publish(world);

    const before = await resultService.studentResults({ user: world.first.user });
    expect(before.results[0].percentage).toBe(75);

    await resultService.saveMarks({
      user: world.faculty,
      payload: {
        assessment: world.internal.id,
        marks: [{ student: String(world.first.student._id), marksObtained: 20 }],
      },
    });

    const after = await resultService.studentResults({ user: world.first.user });
    expect(after.results[0]).toMatchObject({ percentage: 80, grade: "A+" });
  });

  it("maps percentages to the grade scale at the boundaries", () => {
    expect(resultService.gradeFor(null)).toMatchObject({ grade: null });
    expect(resultService.gradeFor(39.9)).toMatchObject({ grade: "F", passing: false });
    expect(resultService.gradeFor(40)).toMatchObject({ grade: "C", passing: true });
    expect(resultService.gradeFor(60)).toMatchObject({ grade: "B+" });
    expect(resultService.gradeFor(75)).toMatchObject({ grade: "A" });
    expect(resultService.gradeFor(80)).toMatchObject({ grade: "A+" });
    expect(resultService.gradeFor(90)).toMatchObject({ grade: "O", points: 10 });
  });

  it("lets a HOD release their own programme and refuses another department", async () => {
    const world = await seed();
    await enterAll(world);

    const hod = await createUser({ role: ROLES.HOD, department: world.department });
    const released = await publish(world, hod);
    expect(released.release.program.code).toBe(world.program.code);

    const otherDepartment = await createDepartment();
    const otherProgram = await createProgram(otherDepartment);
    const otherHod = await createUser({
      role: ROLES.HOD,
      department: otherDepartment,
    });

    await expect(
      resultService.publish({
        user: otherHod,
        payload: { term: world.term._id, program: world.program._id },
      })
    ).rejects.toMatchObject({ statusCode: 403 });

    // The other programme has no components at all.
    await expect(
      resultService.publish({
        user: otherHod,
        payload: { term: world.term._id, program: otherProgram._id },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("lets the examination office release institution-wide", async () => {
    const world = await seed();
    await enterAll(world);

    const exam = await createUser({
      role: ROLES.EXAM_ADMIN,
      department: world.department,
    });
    const released = await publish(world, exam);
    expect(released.alreadyPublished).toBe(false);
  });

  it("refuses marks from a student over HTTP", async () => {
    const world = await seed();
    const { agent, csrfToken } = await loginAs(world.first.user);

    const res = await agent
      .post("/api/v1/results/marks")
      .set("X-CSRF-Token", csrfToken)
      .send({
        assessment: world.internal.id,
        marks: [{ student: String(world.first.student._id), marksObtained: 10 }],
      });

    expect(res.status).toBe(403);
  });
});
