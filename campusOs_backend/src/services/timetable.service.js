/**
 * Timetable — the weekly schedule, and the only writer of class meetings.
 *
 * ## Two jobs, deliberately in one service
 *
 * Reading a timetable is a scoping problem: a student sees their programme, a
 * faculty member sees what they teach, a HOD sees the department, the
 * examination office sees everything. Writing is a clash problem: a room, a
 * teacher and a cohort can each only be in one place at a time. Both need the
 * same populated view of an entry, so they live together.
 *
 * ## Clash detection is interval arithmetic
 *
 * Two classes clash when `start < other.end && end > other.start`. Comparing
 * start times alone misses the 09:30 lecture that runs into a 09:00 lab — which
 * is exactly the clash a paper timetable hides until a student complains.
 *
 * The check and the insert are not one atomic operation. Two simultaneous
 * schedulers could both pass the check; the compound indexes make the window
 * small, and a duplicate is immediately visible on the grid. Making it fully
 * atomic would need a transaction or a lock collection, which is not warranted
 * for a term-setup flow operated by one office. This limitation is recorded
 * rather than papered over.
 */

const AcademicTerm = require("../models/AcademicTerm");
const Subject = require("../models/Subject");
const Room = require("../models/Room");
const User = require("../models/User");
const Student = require("../models/Student");
const TimetableEntry = require("../models/TimetableEntry");
const { AUDIT_ACTION, ACADEMIC_TERM_STATUS, ROLES } = require("../config/constants");
const { ApiError } = require("../utils/ApiError");
const { P, userHasPermission } = require("../utils/permissions");
const { assertCanManageDepartment } = require("../utils/academicScope");
const auditService = require("./audit.service");

const MANAGE = {
  institution: P.TIMETABLE_MANAGE,
  department: P.TIMETABLE_MANAGE_DEPARTMENT,
  message: "You cannot schedule classes for that department",
};

/** Roles that may be assigned to teach. A room booking is not a teaching post. */
const TEACHING_ROLES = Object.freeze([ROLES.FACULTY, ROLES.HOD]);

const ENTRY_POPULATE = [
  {
    path: "subject",
    select: "code name semester credits kind program department",
  },
  { path: "faculty", select: "fullName email role department" },
  { path: "room", select: "block name kind capacity" },
  { path: "term", select: "name code academicYear status isCurrent" },
];

/** 540 → "09:00". Used only for error messages and audit metadata. */
function formatMinutes(value) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

async function currentTerm() {
  return AcademicTerm.findOne({ isCurrent: true }).lean();
}

async function resolveTerm(termId) {
  if (termId) {
    const term = await AcademicTerm.findById(termId).lean();
    if (!term) {
      throw ApiError.notFound("Term not found");
    }
    return term;
  }
  return currentTerm();
}

/**
 * Work out what this caller is allowed to see.
 *
 * Permission first, then identity. A student holding `timetable:read:own` is
 * narrowed to their programme and semester; a faculty member holding the same
 * permission is narrowed to the classes where they are the teacher. The two
 * share a permission name because both are "my timetable", but they are not the
 * same query.
 */
async function resolveScope(user) {
  if (userHasPermission(user, P.TIMETABLE_READ_INSTITUTION)) {
    return { mode: "institution" };
  }

  if (userHasPermission(user, P.TIMETABLE_READ_DEPARTMENT)) {
    if (!user.department) {
      return { mode: "department", departmentId: null };
    }
    return { mode: "department", departmentId: user.department };
  }

  if (!userHasPermission(user, P.TIMETABLE_READ_OWN)) {
    throw ApiError.forbidden("You do not have access to a timetable");
  }

  if (user.role === ROLES.STUDENT) {
    const student = await Student.findOne({ user: user._id })
      .select("program semester")
      .lean();
    if (!student) {
      return { mode: "student", program: null, semester: null };
    }
    return { mode: "student", program: student.program, semester: student.semester };
  }

  return { mode: "faculty", facultyId: user._id };
}

/**
 * The subject-id filter implied by a scope.
 *
 * Timetable entries do not duplicate programme or department; they hold a
 * subject reference and the subject owns those facts. Resolving them to ids
 * first keeps the entry query single-collection and index-backed, instead of an
 * aggregation that scans every entry in the term.
 */
async function subjectFilterForScope(scope) {
  if (scope.mode === "institution" || scope.mode === "faculty") {
    return null;
  }

  if (scope.mode === "student") {
    const ids = await Subject.find({
      program: scope.program,
      semester: scope.semester,
    }).distinct("_id");
    return { $in: ids };
  }

  if (scope.mode === "department") {
    if (!scope.departmentId) return { $in: [] };
    const ids = await Subject.find({ department: scope.departmentId }).distinct("_id");
    return { $in: ids };
  }

  return { $in: [] };
}

/**
 * List the timetable for whoever is asking.
 *
 * Returns `{ term, entries }`: the term is part of the answer, because "no
 * classes" and "no term open" are different states and the UI has to tell them
 * apart.
 */
/**
 * Serialise one entry with an `id` at every level.
 *
 * Mongoose applies a schema transform to the top-level document only; a
 * populated `faculty` or `room` keeps `_id`. That inconsistency leaks straight
 * into the client, which then has to know which level it is reading. One
 * explicit shape here removes the question.
 */
function presentRef(value, fields) {
  if (!value) return null;
  return {
    id: String(value._id ?? value.id),
    ...Object.fromEntries(fields.map((field) => [field, value[field]])),
  };
}

function presentEntry(entry) {
  const json = entry.toJSON();

  return {
    id: json.id ?? String(json._id),
    dayOfWeek: json.dayOfWeek,
    startMinute: json.startMinute,
    endMinute: json.endMinute,
    isActive: json.isActive,
    subject: json.subject
      ? {
          ...presentRef(json.subject, ["code", "name", "semester", "credits", "kind"]),
          program: json.subject.program ? String(json.subject.program) : null,
          department: json.subject.department ? String(json.subject.department) : null,
        }
      : null,
    faculty: presentRef(json.faculty, ["fullName", "email", "role"]),
    room: presentRef(json.room, ["block", "name", "kind", "capacity"]),
    term: presentRef(json.term, ["name", "code"]),
  };
}

function presentTerm(term) {
  if (!term) return null;
  return {
    id: String(term._id),
    name: term.name,
    code: term.code,
    academicYear: term.academicYear,
    status: term.status,
    isCurrent: Boolean(term.isCurrent),
  };
}

async function list({ user, query = {} }) {
  const scope = await resolveScope(user);
  const term = await resolveTerm(query.term);

  if (!term) {
    return { term: null, entries: [] };
  }

  const filter = { term: term._id, isActive: true };

  if (scope.mode === "faculty") {
    filter.faculty = scope.facultyId;
  } else {
    const subjectFilter = await subjectFilterForScope(scope);
    if (subjectFilter) filter.subject = subjectFilter;
  }

  if (query.dayOfWeek) filter.dayOfWeek = query.dayOfWeek;
  if (query.room) filter.room = query.room;

  // Programme/semester filters only make sense for institution-wide readers;
  // applying them for a student could otherwise widen nothing but confuse the
  // contract, so they are ignored for scoped callers on purpose.
  if (scope.mode === "institution" || scope.mode === "department") {
    if (query.program || query.semester) {
      const subjectFilter = {};
      if (query.program) subjectFilter.program = query.program;
      if (query.semester) subjectFilter.semester = query.semester;
      const ids = await Subject.find(subjectFilter).distinct("_id");
      filter.subject = filter.subject
        ? {
            $in: (filter.subject.$in ?? []).filter((id) =>
              ids.some((x) => String(x) === String(id))
            ),
          }
        : { $in: ids };
    }
    if (query.faculty) filter.faculty = query.faculty;
  }

  const entries = await TimetableEntry.find(filter)
    .populate(ENTRY_POPULATE)
    .sort({ dayOfWeek: 1, startMinute: 1 });

  // `toJSON` applies the entry transform (id, no __v) and the populated
  // documents' transforms recurse, so the list uses the same contract as a
  // single GET. A raw `.lean()` here would return `_id` and force the client to
  // know which endpoint it is talking to.
  return { term: presentTerm(term), entries: entries.map(presentEntry) };
}

/**
 * Reject a booking that double-books a room, a teacher or a cohort.
 *
 * `excludeId` lets an update re-check its own slot without clashing with itself.
 */
async function assertNoClash({
  termId,
  dayOfWeek,
  startMinute,
  endMinute,
  roomId,
  facultyId,
  subject,
  excludeId,
}) {
  const base = {
    term: termId,
    dayOfWeek,
    isActive: true,
    startMinute: { $lt: endMinute },
    endMinute: { $gt: startMinute },
  };

  if (excludeId) {
    base._id = { $ne: excludeId };
  }

  const [roomClash, facultyClash] = await Promise.all([
    TimetableEntry.findOne({ ...base, room: roomId }).populate("subject", "code name"),
    TimetableEntry.findOne({ ...base, faculty: facultyId }).populate(
      "subject",
      "code name"
    ),
  ]);

  if (roomClash) {
    throw ApiError.conflict(
      `That room is already booked ${formatMinutes(startMinute)}–${formatMinutes(
        endMinute
      )} for ${roomClash.subject?.code ?? "another class"}`
    );
  }

  if (facultyClash) {
    throw ApiError.conflict(
      `That faculty member already teaches ${facultyClash.subject?.code ?? "a class"} at ${formatMinutes(
        startMinute
      )}–${formatMinutes(endMinute)}`
    );
  }

  // The cohort is every subject in the same programme and semester, because
  // those students take all of them. Two of their classes in one slot is a
  // clash even though the subject ids differ.
  const cohortSubjectIds = await Subject.find({
    program: subject.program,
    semester: subject.semester,
  }).distinct("_id");

  const cohortClash = await TimetableEntry.findOne({
    ...base,
    subject: { $in: cohortSubjectIds },
  }).populate("subject", "code name");

  if (cohortClash) {
    throw ApiError.conflict(
      `That cohort is already in ${cohortClash.subject?.code ?? "a class"} at ${formatMinutes(
        startMinute
      )}–${formatMinutes(endMinute)}`
    );
  }
}

async function loadTeachingContext({ user, payload, existing = null }) {
  const termId = payload.term ?? existing?.term;
  const term = await AcademicTerm.findById(termId);
  if (!term) {
    throw ApiError.notFound("Term not found");
  }
  if (term.status === ACADEMIC_TERM_STATUS.CLOSED) {
    throw ApiError.badRequest("That term is closed and cannot be scheduled");
  }

  const subjectId = payload.subject ?? existing?.subject;
  const subject = await Subject.findById(subjectId);
  if (!subject) {
    throw ApiError.notFound("Subject not found");
  }
  if (!subject.isActive) {
    throw ApiError.badRequest("That subject has been retired");
  }

  const roomId = payload.room ?? existing?.room;
  const room = await Room.findById(roomId);
  if (!room) {
    throw ApiError.notFound("Room not found");
  }
  if (!room.isActive) {
    throw ApiError.badRequest("That room is out of service");
  }

  const facultyId = payload.faculty ?? existing?.faculty;
  const faculty = await User.findById(facultyId).select(
    "fullName role isActive department"
  );
  if (!faculty || !faculty.isActive) {
    throw ApiError.notFound("Faculty member not found");
  }
  if (!TEACHING_ROLES.includes(faculty.role)) {
    throw ApiError.badRequest(
      "Only faculty or a head of department can be assigned to teach"
    );
  }

  assertCanManageDepartment(user, subject.department, MANAGE);

  return { term, subject, room, faculty };
}

async function getById(id) {
  const entry = await TimetableEntry.findById(id).populate(ENTRY_POPULATE);
  if (!entry) {
    throw ApiError.notFound("Class not found");
  }
  return presentEntry(entry);
}

async function create({ user, payload, req }) {
  const { term, subject, room, faculty } = await loadTeachingContext({ user, payload });

  await assertNoClash({
    termId: term._id,
    dayOfWeek: payload.dayOfWeek,
    startMinute: payload.startMinute,
    endMinute: payload.endMinute,
    roomId: room._id,
    facultyId: faculty._id,
    subject,
  });

  const entry = await TimetableEntry.create({
    ...payload,
    createdBy: user._id,
  });

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.TIMETABLE_ENTRY_CREATED,
    entity: "TimetableEntry",
    entityId: entry._id,
    entityRef: subject.code,
    metadata: {
      term: String(term._id),
      subject: String(subject._id),
      faculty: String(faculty._id),
      room: String(room._id),
      dayOfWeek: entry.dayOfWeek,
      startMinute: entry.startMinute,
      endMinute: entry.endMinute,
    },
    req,
  });

  return presentEntry(await TimetableEntry.findById(entry._id).populate(ENTRY_POPULATE));
}

async function update({ user, id, payload, req }) {
  const entry = await TimetableEntry.findById(id);
  if (!entry) {
    throw ApiError.notFound("Class not found");
  }

  const currentSubject = await Subject.findById(entry.subject);
  if (!currentSubject) {
    throw ApiError.notFound("Subject not found");
  }
  assertCanManageDepartment(user, currentSubject.department, MANAGE);

  const { term, subject, room, faculty } = await loadTeachingContext({
    user,
    payload,
    existing: entry,
  });

  const dayOfWeek = payload.dayOfWeek ?? entry.dayOfWeek;
  const startMinute = payload.startMinute ?? entry.startMinute;
  const endMinute = payload.endMinute ?? entry.endMinute;

  if (endMinute <= startMinute) {
    throw ApiError.badRequest("A class must end after it starts");
  }

  await assertNoClash({
    termId: term._id,
    dayOfWeek,
    startMinute,
    endMinute,
    roomId: room._id,
    facultyId: faculty._id,
    subject,
    excludeId: entry._id,
  });

  const before = {
    dayOfWeek: entry.dayOfWeek,
    startMinute: entry.startMinute,
    endMinute: entry.endMinute,
  };

  Object.assign(entry, payload);
  await entry.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.TIMETABLE_ENTRY_UPDATED,
    entity: "TimetableEntry",
    entityId: entry._id,
    entityRef: subject.code,
    metadata: {
      changed: Object.keys(payload),
      before,
      after: {
        dayOfWeek: entry.dayOfWeek,
        startMinute: entry.startMinute,
        endMinute: entry.endMinute,
      },
      room: String(room._id),
      faculty: String(faculty._id),
    },
    req,
  });

  return presentEntry(await TimetableEntry.findById(entry._id).populate(ENTRY_POPULATE));
}

/**
 * Remove a class from the schedule.
 *
 * A soft delete, because attendance sessions (and later, exam sittings) will
 * reference this entry. Erasing the row would leave those records pointing at
 * nothing, which is indistinguishable from data loss.
 */
async function remove({ user, id, req }) {
  const entry = await TimetableEntry.findById(id);
  if (!entry) {
    throw ApiError.notFound("Class not found");
  }

  const subject = await Subject.findById(entry.subject).select("code department");
  if (!subject) {
    throw ApiError.notFound("Subject not found");
  }
  assertCanManageDepartment(user, subject.department, MANAGE);

  if (!entry.isActive) {
    return { removed: true, alreadyRemoved: true };
  }

  entry.isActive = false;
  await entry.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.TIMETABLE_ENTRY_REMOVED,
    entity: "TimetableEntry",
    entityId: entry._id,
    entityRef: subject.code,
    metadata: {
      dayOfWeek: entry.dayOfWeek,
      startMinute: entry.startMinute,
      endMinute: entry.endMinute,
    },
    req,
  });

  return { removed: true };
}

/**
 * Staff who can be assigned to a class.
 *
 * Scoped for the same reason the write is: a HOD building a timetable should
 * see their own department's teachers, not the whole college's payroll. The
 * list exposes a name and an id, never an email or anything else.
 */
async function listTeachingStaff({ user, departmentId }) {
  const canSeeAll = userHasPermission(user, P.TIMETABLE_MANAGE);
  const canSeeDepartment = userHasPermission(user, P.TIMETABLE_MANAGE_DEPARTMENT);

  if (!canSeeAll && !canSeeDepartment) {
    throw ApiError.forbidden("You do not have permission to assign classes");
  }

  const filter = {
    role: { $in: TEACHING_ROLES },
    isActive: true,
  };

  if (!canSeeAll) {
    filter.department = user.department;
  } else if (departmentId) {
    filter.department = departmentId;
  }

  return User.find(filter)
    .select("fullName role department")
    .populate("department", "name code")
    .sort({ fullName: 1 })
    .lean();
}

/** Does this user have any timetable write capability? For the UI bootstrap. */
function canManage(user) {
  return (
    userHasPermission(user, P.TIMETABLE_MANAGE) ||
    userHasPermission(user, P.TIMETABLE_MANAGE_DEPARTMENT)
  );
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  listTeachingStaff,
  canManage,
  // Exported for tests and for the attendance module that will consume it.
  formatMinutes,
};
