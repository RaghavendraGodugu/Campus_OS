/**
 * Attendance.
 *
 * What matters here is not the CRUD. It is:
 *
 *  - a register covers exactly the roster, and a partial register is refused;
 *  - a class can only be marked on a date it actually meets;
 *  - a second marking for the same class and date is a conflict, not a duplicate;
 *  - percentage is derived from records, and a correction changes it;
 *  - a correction carries a reason, bumps the revision and writes an audit entry;
 *  - a student sees their own figures and nobody else's;
 *  - a HOD roll-up covers the department and stops there.
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
const AuditLog = require("../src/models/AuditLog");

const subjectService = require("../src/services/subject.service");
const roomService = require("../src/services/room.service");
const timetableService = require("../src/services/timetable.service");
const attendanceService = require("../src/services/attendance.service");

const {
  ROLES,
  ACADEMIC_TERM_STATUS,
  ATTENDANCE_STATUS,
  AUDIT_ACTION,
} = require("../src/config/constants");

/** 2026-10-05 is a Monday. */
const MONDAY = new Date("2026-10-05T00:00:00.000Z");
const NEXT_MONDAY = new Date("2026-10-12T00:00:00.000Z");
const TUESDAY = new Date("2026-10-06T00:00:00.000Z");
const NEXT_TUESDAY = new Date("2026-10-13T00:00:00.000Z");

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

  const entry = await timetableService.create({
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

  return {
    department,
    program,
    term,
    admin,
    faculty,
    otherFaculty,
    room,
    subject,
    entry,
    first,
    second,
  };
}

function recordsFor(world, overrides = {}) {
  return [
    {
      student: String(world.first.student._id),
      status: overrides.first ?? ATTENDANCE_STATUS.PRESENT,
    },
    {
      student: String(world.second.student._id),
      status: overrides.second ?? ATTENDANCE_STATUS.PRESENT,
    },
  ];
}

async function markMonday(world, overrides = {}) {
  return attendanceService.mark({
    user: world.faculty,
    payload: {
      entry: world.entry.id,
      date: MONDAY,
      records: recordsFor(world, overrides),
    },
  });
}

describe("attendance", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("marks a register and derives its counts", async () => {
    const world = await seed();

    const result = await markMonday(world, {
      second: ATTENDANCE_STATUS.ABSENT,
    });

    expect(result.session.id).toBeTruthy();
    expect(result.session.date).toBe("2026-10-05");
    expect(result.summary).toMatchObject({
      total: 2,
      present: 1,
      absent: 1,
      attended: 1,
      percentage: 50,
    });
  });

  it("refuses a partial register rather than defaulting anyone to absent", async () => {
    const world = await seed();

    await expect(
      attendanceService.mark({
        user: world.faculty,
        payload: {
          entry: world.entry.id,
          date: MONDAY,
          records: [{ student: String(world.first.student._id), status: "PRESENT" }],
        },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a student who is not in the class", async () => {
    const world = await seed();

    await expect(
      attendanceService.mark({
        user: world.faculty,
        payload: {
          entry: world.entry.id,
          date: MONDAY,
          records: [
            ...recordsFor(world),
            { student: String(world.admin._id), status: "PRESENT" },
          ],
        },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a date the class does not meet on", async () => {
    const world = await seed();

    await expect(
      attendanceService.mark({
        user: world.faculty,
        payload: {
          entry: world.entry.id,
          date: TUESDAY,
          records: recordsFor(world),
        },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("marks a one-off class only on its scheduled date", async () => {
    const world = await seed();
    const oneOff = await timetableService.create({
      user: world.admin,
      payload: {
        term: world.term._id,
        subject: world.subject.id,
        faculty: world.faculty._id,
        room: world.room.id,
        startsOn: TUESDAY,
        repeatsWeekly: false,
        startMinute: 540,
        endMinute: 600,
      },
    });

    const result = await attendanceService.mark({
      user: world.faculty,
      payload: {
        entry: oneOff.id,
        date: TUESDAY,
        records: recordsFor(world),
      },
    });
    expect(result.session.date).toBe("2026-10-06");

    const day = await attendanceService.day({
      user: world.faculty,
      date: TUESDAY,
    });
    expect(day.classes.map((item) => item.entry.id)).toContain(oneOff.id);

    await expect(
      attendanceService.mark({
        user: world.faculty,
        payload: {
          entry: oneOff.id,
          date: NEXT_TUESDAY,
          records: recordsFor(world),
        },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a second marking for the same class and date", async () => {
    const world = await seed();
    await markMonday(world);

    await expect(markMonday(world)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses a teacher who does not teach the class", async () => {
    const world = await seed();

    await expect(
      attendanceService.mark({
        user: world.otherFaculty,
        payload: {
          entry: world.entry.id,
          date: MONDAY,
          records: recordsFor(world),
        },
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("refuses a closed term", async () => {
    const world = await seed();
    await AcademicTerm.updateOne(
      { _id: world.term._id },
      { $set: { status: ACADEMIC_TERM_STATUS.CLOSED } }
    );

    await expect(markMonday(world)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("gives a student their own percentage and nobody else's", async () => {
    const world = await seed();

    // First student absent, second present.
    await markMonday(world, { first: ATTENDANCE_STATUS.ABSENT });

    const firstView = await attendanceService.mine({ user: world.first.user });
    const secondView = await attendanceService.mine({ user: world.second.user });

    expect(firstView.overall).toMatchObject({ held: 1, attended: 0, percentage: 0 });
    expect(secondView.overall).toMatchObject({ held: 1, attended: 1, percentage: 100 });
    expect(firstView.subjects).toHaveLength(1);
    expect(firstView.subjects[0].subject.code).toBe("CS301");
  });

  it("corrects a register, bumps the revision and writes an audit entry", async () => {
    const world = await seed();
    const marked = await markMonday(world, { first: ATTENDANCE_STATUS.ABSENT });

    const corrected = await attendanceService.correct({
      user: world.faculty,
      id: marked.session.id,
      payload: {
        records: recordsFor(world, { first: ATTENDANCE_STATUS.PRESENT }),
        reason: "The student was present; the row was misread during marking.",
      },
    });

    expect(corrected.session.revision).toBe(1);
    expect(corrected.summary.percentage).toBe(100);
    expect(corrected.session.corrections).toHaveLength(1);

    const audit = await AuditLog.findOne({
      action: AUDIT_ACTION.ATTENDANCE_CORRECTED,
    }).lean();
    expect(audit).not.toBeNull();
    expect(audit.metadata.revision).toBe(1);

    const view = await attendanceService.mine({ user: world.first.user });
    expect(view.overall.percentage).toBe(100);
  });

  it("refuses a correction from a teacher who does not teach the class", async () => {
    const world = await seed();
    const marked = await markMonday(world);

    await expect(
      attendanceService.correct({
        user: world.otherFaculty,
        id: marked.session.id,
        payload: {
          records: recordsFor(world),
          reason: "Attempting a correction I should not be allowed to make.",
        },
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("gives faculty their classes for the day with marking state", async () => {
    const world = await seed();
    await markMonday(world);

    const day = await attendanceService.day({
      user: world.faculty,
      date: MONDAY,
    });

    expect(day.classes).toHaveLength(1);
    expect(day.classes[0].marked).toBe(true);
    expect(day.classes[0].entry.subject.code).toBe("CS301");

    const empty = await attendanceService.day({
      user: world.faculty,
      date: NEXT_MONDAY,
    });
    expect(empty.classes[0].marked).toBe(false);
  });

  it("builds an HOD roll-up for the department only", async () => {
    const world = await seed();
    await markMonday(world, { second: ATTENDANCE_STATUS.ABSENT });

    const hod = await createUser({ role: ROLES.HOD, department: world.department });
    const rollUp = await attendanceService.overview({ user: hod });

    expect(rollUp.subjects).toHaveLength(1);
    expect(rollUp.subjects[0].subject.code).toBe("CS301");
    expect(rollUp.subjects[0].sessions).toBe(1);
    expect(rollUp.subjects[0].students).toBe(2);
    expect(rollUp.subjects[0].belowThreshold).toBe(1);

    // A HOD in another department sees nothing here.
    const otherDepartment = await createDepartment();
    const outsider = await createUser({
      role: ROLES.HOD,
      department: otherDepartment,
    });
    const otherRollUp = await attendanceService.overview({ user: outsider });
    expect(otherRollUp.subjects).toHaveLength(0);
  });

  it("refuses a student roll-up to a teacher of another subject", async () => {
    const world = await seed();
    await markMonday(world);

    await expect(
      attendanceService.subjectSummary({
        user: world.otherFaculty,
        subjectId: world.subject.id,
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("validates the API: a student cannot mark, and a correction needs a reason", async () => {
    const world = await seed();
    const marked = await markMonday(world);

    const studentLogin = await loginAs(world.first.user);
    const denied = await studentLogin.agent
      .post("/api/v1/attendance/sessions")
      .set("X-CSRF-Token", studentLogin.csrfToken)
      .send({
        entry: world.entry.id,
        date: "2026-10-05",
        records: recordsFor(world),
      });
    expect(denied.status).toBe(403);

    const facultyLogin = await loginAs(world.faculty);
    const missingReason = await facultyLogin.agent
      .patch(`/api/v1/attendance/sessions/${marked.session.id}`)
      .set("X-CSRF-Token", facultyLogin.csrfToken)
      .send({ records: recordsFor(world) });
    expect(missingReason.status).toBe(400);
  });
});
