/**
 * Academic structure and timetable.
 *
 * The behaviour worth testing is not CRUD. It is:
 *
 *  - a clash is an interval overlap, not an identical start minute;
 *  - a student sees their programme, a faculty member sees their own classes,
 *    a HOD sees their department and no further;
 *  - authorisation is re-checked against the record's department, so holding
 *    "manage" for one department cannot schedule into another;
 *  - a retired subject and a closed term cannot receive new classes;
 *  - every scheduling write leaves an audit entry.
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

const { ROLES, ACADEMIC_TERM_STATUS, AUDIT_ACTION } = require("../src/config/constants");

const TERM = {
  name: "Autumn 2026",
  code: "A26",
  kind: "SEMESTER",
  academicYear: "2026-27",
  startsOn: new Date("2026-08-01T00:00:00.000Z"),
  endsOn: new Date("2026-12-20T00:00:00.000Z"),
};

async function makeTerm(overrides = {}) {
  return AcademicTerm.create({
    ...TERM,
    status: ACADEMIC_TERM_STATUS.OPEN,
    isCurrent: true,
    ...overrides,
  });
}

/**
 * A complete, valid world: one department, one programme, one term, an
 * administrator, two teachers, a room and two subjects in semester 5.
 */
async function seed() {
  const department = await createDepartment();
  const program = await createProgram(department);

  const term = await makeTerm();

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

  const subjectTwo = await subjectService.create({
    user: admin,
    payload: {
      code: "CS302",
      name: "Operating Systems",
      department: department._id,
      program: program._id,
      semester: 5,
      credits: 4,
    },
  });

  return {
    department,
    program,
    term,
    admin,
    faculty,
    otherFaculty,
    room,
    subject,
    subjectTwo,
  };
}

function entryPayload(world, overrides = {}) {
  return {
    term: world.term._id,
    subject: world.subject.id,
    faculty: world.faculty._id,
    room: world.room.id,
    dayOfWeek: 1,
    startMinute: 540, // 09:00
    endMinute: 600, // 10:00
    ...overrides,
  };
}

describe("academic timetable", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("schedules a class and returns the populated view", async () => {
    const world = await seed();

    const entry = await timetableService.create({
      user: world.admin,
      payload: entryPayload(world),
    });

    expect(entry.subject.code).toBe("CS301");
    expect(entry.room.name).toBe("LH-204");
    expect(entry.faculty.fullName).toBe(world.faculty.fullName);
    expect(entry.dayOfWeek).toBe(1);
    expect(entry.startMinute).toBe(540);
  });

  it("refuses an overlapping room booking, not just the same start minute", async () => {
    // The clash a paper timetable hides: 09:00–10:00 and 09:30–10:30 do not
    // share a start, but they cannot both happen in LH-204.
    const world = await seed();
    await timetableService.create({ user: world.admin, payload: entryPayload(world) });

    const clash = timetableService.create({
      user: world.admin,
      payload: entryPayload(world, {
        subject: world.subjectTwo.id,
        faculty: world.otherFaculty._id,
        startMinute: 570,
        endMinute: 630,
      }),
    });

    await expect(clash).rejects.toMatchObject({ statusCode: 409 });
    await expect(clash).rejects.toThrow(/room/i);
  });

  it("refuses a faculty double-booking in a different room", async () => {
    const world = await seed();

    const secondRoom = await roomService.create({
      user: world.admin,
      payload: { block: "Academic Block A", name: "LH-205" },
    });

    await timetableService.create({ user: world.admin, payload: entryPayload(world) });

    const clash = timetableService.create({
      user: world.admin,
      payload: entryPayload(world, {
        subject: world.subjectTwo.id,
        room: secondRoom.id,
        startMinute: 570,
        endMinute: 630,
      }),
    });

    await expect(clash).rejects.toMatchObject({ statusCode: 409 });
    await expect(clash).rejects.toThrow(/faculty/i);
  });

  it("refuses a cohort clash across two different subjects", async () => {
    // The same students take CS301 and CS302. Two of their classes in one slot
    // is a clash even though the room and teacher differ.
    const world = await seed();

    const secondRoom = await roomService.create({
      user: world.admin,
      payload: { block: "Academic Block A", name: "LH-205" },
    });

    await timetableService.create({ user: world.admin, payload: entryPayload(world) });

    const clash = timetableService.create({
      user: world.admin,
      payload: entryPayload(world, {
        subject: world.subjectTwo.id,
        faculty: world.otherFaculty._id,
        room: secondRoom.id,
        startMinute: 570,
        endMinute: 630,
      }),
    });

    await expect(clash).rejects.toMatchObject({ statusCode: 409 });
    await expect(clash).rejects.toThrow(/cohort/i);
  });

  it("allows back-to-back classes in the same room and with the same teacher", async () => {
    // 09:00–10:00 then 10:00–11:00 touches but does not overlap. Rejecting it
    // would make a normal timetable impossible to enter.
    const world = await seed();
    await timetableService.create({ user: world.admin, payload: entryPayload(world) });

    const next = await timetableService.create({
      user: world.admin,
      payload: entryPayload(world, {
        subject: world.subjectTwo.id,
        startMinute: 600,
        endMinute: 660,
      }),
    });

    expect(next.startMinute).toBe(600);
  });

  it("gives a student only their programme and semester", async () => {
    const world = await seed();

    const otherDepartment = await createDepartment();
    const otherProgram = await createProgram(otherDepartment);
    const otherSubject = await subjectService.create({
      user: world.admin,
      payload: {
        code: "CS301",
        name: "Database Systems",
        department: otherDepartment._id,
        program: otherProgram._id,
        semester: 5,
      },
    });

    await timetableService.create({ user: world.admin, payload: entryPayload(world) });
    await timetableService.create({
      user: world.admin,
      payload: entryPayload(world, {
        subject: otherSubject.id,
        dayOfWeek: 2,
      }),
    });

    const { user: studentUser } = await createStudent({
      department: world.department,
      program: world.program,
    });

    const { entries } = await timetableService.list({ user: studentUser });

    expect(entries).toHaveLength(1);
    expect(entries[0].subject.code).toBe("CS301");
    expect(String(entries[0].subject.program)).toBe(String(world.program._id));
  });

  it("gives faculty only the classes they teach", async () => {
    const world = await seed();

    await timetableService.create({ user: world.admin, payload: entryPayload(world) });
    await timetableService.create({
      user: world.admin,
      payload: entryPayload(world, {
        subject: world.subjectTwo.id,
        faculty: world.otherFaculty._id,
        dayOfWeek: 2,
      }),
    });

    const { entries } = await timetableService.list({ user: world.faculty });

    expect(entries).toHaveLength(1);
    expect(String(entries[0].faculty.id)).toBe(String(world.faculty._id));
  });

  it("lets a HOD schedule for their department and refuses another department", async () => {
    const world = await seed();
    const hod = await createUser({ role: ROLES.HOD, department: world.department });

    const allowed = await timetableService.create({
      user: hod,
      payload: entryPayload(world),
    });
    expect(allowed.subject.code).toBe("CS301");

    const otherDepartment = await createDepartment();
    const otherProgram = await createProgram(otherDepartment);
    const otherSubject = await subjectService.create({
      user: world.admin,
      payload: {
        code: "ME201",
        name: "Thermodynamics",
        department: otherDepartment._id,
        program: otherProgram._id,
        semester: 5,
      },
    });

    await expect(
      timetableService.create({
        user: hod,
        payload: entryPayload(world, {
          subject: otherSubject.id,
          dayOfWeek: 3,
        }),
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("shows a HOD the department timetable and no further", async () => {
    const world = await seed();
    const otherDepartment = await createDepartment();
    const otherProgram = await createProgram(otherDepartment);
    const otherSubject = await subjectService.create({
      user: world.admin,
      payload: {
        code: "ME201",
        name: "Thermodynamics",
        department: otherDepartment._id,
        program: otherProgram._id,
        semester: 5,
      },
    });

    await timetableService.create({ user: world.admin, payload: entryPayload(world) });
    await timetableService.create({
      user: world.admin,
      payload: entryPayload(world, {
        subject: otherSubject.id,
        dayOfWeek: 2,
      }),
    });

    const hod = await createUser({ role: ROLES.HOD, department: world.department });
    const { entries } = await timetableService.list({ user: hod });

    expect(entries).toHaveLength(1);
    expect(entries[0].subject.code).toBe("CS301");
  });

  it("refuses to schedule a retired subject", async () => {
    const world = await seed();
    await subjectService.retire({ user: world.admin, id: world.subject.id });

    await expect(
      timetableService.create({ user: world.admin, payload: entryPayload(world) })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses to schedule into a closed term", async () => {
    const world = await seed();
    const closed = await makeTerm({
      name: "Spring 2026",
      code: "S26",
      isCurrent: false,
      status: ACADEMIC_TERM_STATUS.CLOSED,
    });

    await expect(
      timetableService.create({
        user: world.admin,
        payload: entryPayload(world, { term: closed._id }),
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("reports active classes when a room is retired", async () => {
    const world = await seed();
    await timetableService.create({ user: world.admin, payload: entryPayload(world) });

    const retired = await roomService.retire({ user: world.admin, id: world.room.id });

    expect(retired.isActive).toBe(false);
    expect(retired.activeEntries).toBe(1);
  });

  it("writes an audit entry for a scheduling change", async () => {
    const world = await seed();
    await timetableService.create({ user: world.admin, payload: entryPayload(world) });

    const audit = await AuditLog.findOne({
      action: AUDIT_ACTION.TIMETABLE_ENTRY_CREATED,
    }).lean();

    expect(audit).not.toBeNull();
    expect(audit.entity).toBe("TIMETABLEENTRY");
    expect(audit.entityRef).toBe("CS301");
  });

  it("refuses a subject whose programme belongs to another department", async () => {
    const world = await seed();
    const otherDepartment = await createDepartment();

    await expect(
      subjectService.create({
        user: world.admin,
        payload: {
          code: "PH101",
          name: "Physics",
          department: otherDepartment._id,
          program: world.program._id,
          semester: 1,
        },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns 403 when a student attempts to schedule a class over HTTP", async () => {
    const world = await seed();
    const { user: studentUser } = await createStudent({
      department: world.department,
      program: world.program,
    });

    const { agent, csrfToken } = await loginAs(studentUser);
    const res = await agent
      .post("/api/v1/timetable")
      .set("X-CSRF-Token", csrfToken)
      .send(entryPayload(world));

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});
