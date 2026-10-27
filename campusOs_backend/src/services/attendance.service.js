/**
 * Attendance — marking, correcting, and every derived figure.
 *
 * ## The one rule
 *
 * **Percentage is derived, never stored.** There is no percentage field on a
 * session, a student or a subject. Every number this module returns is computed
 * from `AttendanceSession.records` at read time. A stored total is a second
 * source of truth that goes wrong the first time somebody corrects a register,
 * and the correction is exactly when the number matters.
 *
 * ## Marking versus correcting
 *
 * Marking records what happened; correcting changes it afterwards. They are
 * separate operations with separate permissions, and a correction always
 * carries a reason. The reason lives on the session (the academic record the
 * faculty and HOD read), while the audit entry records that a correction
 * happened, by whom and at which revision. Audit metadata deliberately does not
 * copy the free text — the audit trail is readable by a wider audience than the
 * register.
 *
 * ## Scope
 *
 * A student reads their own attendance. Faculty mark and read the classes they
 * teach. A HOD reads the department and may correct it, with a reason. The
 * examination office reads the institution and may correct it. A system
 * administrator reads but never writes: platform access is not academic
 * authority.
 */

const AcademicTerm = require("../models/AcademicTerm");
const Subject = require("../models/Subject");
const Student = require("../models/Student");
const TimetableEntry = require("../models/TimetableEntry");
const AttendanceSession = require("../models/AttendanceSession");

const {
  AUDIT_ACTION,
  ACADEMIC_TERM_STATUS,
  ATTENDED_STATUSES,
  ATTENDANCE_STATUS,
  ATTENDANCE_THRESHOLD_PERCENT,
} = require("../config/constants");
const { ApiError } = require("../utils/ApiError");
const { P, userHasPermission } = require("../utils/permissions");
const auditService = require("./audit.service");

const ENTRY_POPULATE = [
  { path: "subject", select: "code name semester credits kind program department" },
  { path: "faculty", select: "fullName email role" },
  { path: "room", select: "block name kind capacity" },
];

/** ISO weekday (1 = Monday … 7 = Sunday) from a UTC-midnight date. */
function isoWeekday(date) {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/** `YYYY-MM-DD` for a stored UTC-midnight date. */
function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/** Percentage to one decimal, or null when nothing has been held. */
function percentage(attended, held) {
  if (!held) return null;
  return Math.round((attended / held) * 1000) / 10;
}

function countsOf(records) {
  const counts = {
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    total: records.length,
  };

  for (const record of records) {
    if (record.status === ATTENDANCE_STATUS.PRESENT) counts.present += 1;
    else if (record.status === ATTENDANCE_STATUS.LATE) counts.late += 1;
    else if (record.status === ATTENDANCE_STATUS.EXCUSED) counts.excused += 1;
    else counts.absent += 1;
  }

  return counts;
}

async function resolveTerm(termId) {
  if (termId) {
    const term = await AcademicTerm.findById(termId).lean();
    if (!term) throw ApiError.notFound("Term not found");
    return term;
  }
  return AcademicTerm.findOne({ isCurrent: true }).lean();
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

function presentEntry(entry) {
  return {
    id: String(entry._id),
    dayOfWeek: entry.dayOfWeek,
    startsOn: entry.startsOn ? dateKey(entry.startsOn) : null,
    repeatsWeekly: entry.repeatsWeekly !== false,
    startMinute: entry.startMinute,
    endMinute: entry.endMinute,
    subject: entry.subject
      ? {
          id: String(entry.subject._id ?? entry.subject.id),
          code: entry.subject.code,
          name: entry.subject.name,
          semester: entry.subject.semester,
          kind: entry.subject.kind,
          program: String(entry.subject.program),
          department: String(entry.subject.department),
        }
      : null,
    faculty: entry.faculty
      ? {
          id: String(entry.faculty._id ?? entry.faculty.id),
          fullName: entry.faculty.fullName,
        }
      : null,
    room: entry.room
      ? {
          id: String(entry.room._id ?? entry.room.id),
          name: entry.room.name,
          block: entry.room.block,
        }
      : null,
  };
}

function occursOn(entry, date) {
  if (entry.repeatsWeekly === false) {
    return Boolean(entry.startsOn) && dateKey(entry.startsOn) === dateKey(date);
  }

  if (isoWeekday(date) !== entry.dayOfWeek) return false;
  return !entry.startsOn || date >= new Date(entry.startsOn);
}

function presentSession(session) {
  const json = session.toJSON();
  return {
    id: json.id,
    entry: String(json.entry),
    date: dateKey(json.date),
    revision: json.revision,
    markedAt: json.markedAt,
    corrections: (json.corrections ?? []).map((correction) => ({
      at: correction.at,
      by: String(correction.by),
      reason: correction.reason,
    })),
    records: (json.records ?? []).map((record) => ({
      student: String(record.student),
      status: record.status,
    })),
    counts: countsOf(json.records ?? []),
  };
}

/**
 * The roster for a subject: every active student in its programme and semester.
 *
 * Derived from the current student record rather than from previous attendance,
 * so a student who joins the class is expected at the next marking. A student
 * whose account has been deactivated is not asked to be marked present.
 */
async function rosterForSubject(subject) {
  const students = await Student.find({
    program: subject.program,
    semester: subject.semester,
  })
    .select("rollNumber section user program semester")
    .populate("user", "fullName isActive")
    .sort({ rollNumber: 1 })
    .lean();

  return students
    .filter((student) => student.user?.isActive !== false)
    .map((student) => ({
      studentId: String(student._id),
      rollNumber: student.rollNumber,
      name: student.user?.fullName ?? "Unknown student",
      section: student.section ?? null,
    }));
}

async function loadEntry(entryId) {
  const entry = await TimetableEntry.findById(entryId).populate(ENTRY_POPULATE);
  if (!entry) {
    throw ApiError.notFound("Class not found");
  }
  return entry;
}

/** May this caller read the register for this class? */
function canReadEntry(entry, user) {
  if (userHasPermission(user, P.ATTENDANCE_READ_INSTITUTION)) return true;

  if (
    userHasPermission(user, P.ATTENDANCE_READ_DEPARTMENT) &&
    user.department &&
    String(entry.subject.department) === String(user.department)
  ) {
    return true;
  }

  return String(entry.faculty._id ?? entry.faculty) === String(user._id);
}

/** May this caller submit the first marking for this class? */
function canMarkEntry(entry, user) {
  if (String(entry.faculty._id ?? entry.faculty) === String(user._id)) {
    return userHasPermission(user, P.ATTENDANCE_MARK_OWN);
  }

  // Cover teaching and departmental administration: a HOD may mark a class in
  // their department, and the examination office may mark institution-wide.
  if (
    userHasPermission(user, P.ATTENDANCE_CORRECT_DEPARTMENT) &&
    user.department &&
    String(entry.subject.department) === String(user.department)
  ) {
    return true;
  }

  return userHasPermission(user, P.ATTENDANCE_CORRECT_INSTITUTION);
}

/** May this caller change an existing register? */
function canCorrectSession(entry, user) {
  if (String(entry.faculty._id ?? entry.faculty) === String(user._id)) {
    return userHasPermission(user, P.ATTENDANCE_MARK_OWN);
  }

  if (
    userHasPermission(user, P.ATTENDANCE_CORRECT_DEPARTMENT) &&
    user.department &&
    String(entry.subject.department) === String(user.department)
  ) {
    return true;
  }

  return userHasPermission(user, P.ATTENDANCE_CORRECT_INSTITUTION);
}

/**
 * Every active student must be marked exactly once.
 *
 * Partial registers are refused rather than filled with "absent": defaulting a
 * forgotten student to absent punishes them for the teacher's omission, and
 * defaulting to present would be worse. The error names how many are missing.
 */
function assertCompleteRoster(roster, records) {
  const expected = new Set(roster.map((student) => student.studentId));
  const provided = new Set(records.map((record) => String(record.student)));

  const missing = [...expected].filter((id) => !provided.has(id));
  const extra = [...provided].filter((id) => !expected.has(id));

  if (extra.length > 0) {
    throw ApiError.badRequest(
      "One or more students are not in this class. Reload the roster and try again."
    );
  }

  if (missing.length > 0) {
    throw ApiError.badRequest(
      `Mark every student before saving. ${missing.length} of ${expected.size} still have no status.`
    );
  }
}

/** The totals for one saved register, returned alongside the session. */
function summaryOf(session) {
  const counts = countsOf(session.records ?? []);
  const attended = counts.present + counts.late;

  return {
    ...counts,
    attended,
    percentage: percentage(attended, counts.total),
  };
}

async function mark({ user, payload, req }) {
  const entry = await loadEntry(payload.entry);

  if (!canMarkEntry(entry, user)) {
    throw ApiError.forbidden("You do not teach this class");
  }

  const term = await AcademicTerm.findById(entry.term);
  if (!term) {
    throw ApiError.notFound("Term not found");
  }
  if (term.status === ACADEMIC_TERM_STATUS.CLOSED) {
    throw ApiError.badRequest(
      "That term is closed; attendance cannot be marked against it"
    );
  }

  if (!occursOn(entry, payload.date)) {
    throw ApiError.badRequest(
      "That class does not meet on this date. Check the class date and the date selected."
    );
  }

  const existing = await AttendanceSession.findOne({
    entry: entry._id,
    date: payload.date,
  }).select("_id");

  if (existing) {
    throw ApiError.conflict(
      "Attendance for this class on this date is already marked. Correct it instead of marking it again.",
      [
        {
          field: "date",
          message: "A register already exists",
          sessionId: String(existing._id),
        },
      ]
    );
  }

  const roster = await rosterForSubject(entry.subject);
  assertCompleteRoster(roster, payload.records);

  let session;
  try {
    session = await AttendanceSession.create({
      entry: entry._id,
      term: entry.term,
      subject: entry.subject._id,
      faculty: entry.faculty._id,
      date: payload.date,
      records: payload.records.map((record) => ({
        student: record.student,
        status: record.status,
      })),
      markedBy: user._id,
      markedAt: new Date(),
    });
  } catch (error) {
    // The unique index is the real guard against a double submission; the
    // check above only makes the common case produce a better message.
    if (error?.code === 11000) {
      throw ApiError.conflict(
        "Attendance for this class on this date is already marked."
      );
    }
    throw error;
  }

  const summary = summaryOf(session);

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ATTENDANCE_MARKED,
    entity: "AttendanceSession",
    entityId: session._id,
    entityRef: `${entry.subject.code} ${dateKey(session.date)}`,
    metadata: {
      entry: String(entry._id),
      subject: String(entry.subject._id),
      term: String(entry.term),
      date: dateKey(session.date),
      counts: summary,
    },
    req,
  });

  return { session: presentSession(session), summary, entry: presentEntry(entry) };
}

async function correct({ user, id, payload, req }) {
  const session = await AttendanceSession.findById(id);
  if (!session) {
    throw ApiError.notFound("Attendance record not found");
  }

  const entry = await loadEntry(session.entry);
  if (!canCorrectSession(entry, user)) {
    throw ApiError.forbidden("You cannot correct this register");
  }

  const roster = await rosterForSubject(entry.subject);
  assertCompleteRoster(roster, payload.records);

  const before = summaryOf(session);

  session.records = payload.records.map((record) => ({
    student: record.student,
    status: record.status,
  }));
  session.revision += 1;
  session.corrections.push({
    at: new Date(),
    by: user._id,
    reason: payload.reason,
  });

  await session.save();

  const after = summaryOf(session);

  // The reason is intentionally not copied here: audit metadata is redacted for
  // free text, and the sentence belongs to the register, not to the trail.
  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ATTENDANCE_CORRECTED,
    entity: "AttendanceSession",
    entityId: session._id,
    entityRef: `${entry.subject.code} ${dateKey(session.date)}`,
    metadata: {
      entry: String(entry._id),
      subject: String(entry.subject._id),
      term: String(entry.term),
      date: dateKey(session.date),
      revision: session.revision,
      before,
      after,
    },
    req,
  });

  return { session: presentSession(session), summary: after, entry: presentEntry(entry) };
}

/**
 * The context a marking screen needs: the class, the date, the roster, and the
 * register if one already exists.
 */
async function entryContext({ user, entryId, date }) {
  const entry = await loadEntry(entryId);

  if (!canReadEntry(entry, user) && !canMarkEntry(entry, user)) {
    throw ApiError.forbidden("You cannot open this class register");
  }

  if (!occursOn(entry, date)) {
    throw ApiError.badRequest("That class does not meet on this date");
  }

  const roster = await rosterForSubject(entry.subject);
  const session = await AttendanceSession.findOne({ entry: entry._id, date });

  const statuses = new Map(
    (session?.records ?? []).map((record) => [String(record.student), record.status])
  );

  return {
    entry: presentEntry(entry),
    date: dateKey(date),
    marked: Boolean(session),
    session: session
      ? {
          id: String(session._id),
          revision: session.revision,
          markedAt: session.markedAt,
          corrections: session.corrections.map((correction) => ({
            at: correction.at,
            reason: correction.reason,
          })),
        }
      : null,
    roster: roster.map((student) => ({
      ...student,
      status: statuses.get(student.studentId) ?? null,
    })),
    canMark: canMarkEntry(entry, user),
    canCorrect: canCorrectSession(entry, user),
  };
}

/**
 * The classes this faculty member teaches on a given date, with whether the
 * register is already marked. This is the "today" screen.
 */
async function day({ user, date }) {
  const weekday = isoWeekday(date);

  const entries = await TimetableEntry.find({
    faculty: user._id,
    isActive: true,
    $or: [
      {
        repeatsWeekly: { $ne: false },
        dayOfWeek: weekday,
        $or: [
          { startsOn: null },
          { startsOn: { $exists: false } },
          { startsOn: { $lte: date } },
        ],
      },
      { repeatsWeekly: false, startsOn: date },
    ],
  })
    .populate(ENTRY_POPULATE)
    .sort({ startMinute: 1 });

  const sessions = await AttendanceSession.find({
    entry: { $in: entries.map((entry) => entry._id) },
    date,
  });

  const byEntry = new Map(sessions.map((session) => [String(session.entry), session]));

  return {
    date: dateKey(date),
    weekday,
    classes: entries.map((entry) => {
      const session = byEntry.get(String(entry._id));
      return {
        entry: presentEntry(entry),
        marked: Boolean(session),
        sessionId: session ? String(session._id) : null,
        counts: session ? countsOf(session.records) : null,
        revision: session?.revision ?? 0,
      };
    }),
  };
}

/**
 * A student's own attendance for a term: per subject, plus the overall figure.
 *
 * Aggregation rather than a stored counter. `held` counts the sessions in which
 * this student appears in the roster; `attended` counts PRESENT and LATE.
 */
async function mine({ user, termId }) {
  const student = await Student.findOne({ user: user._id })
    .select("program semester rollNumber")
    .lean();

  if (!student) {
    // Return empty state instead of error — the student may not be linked yet
    return {
      term: null,
      threshold: ATTENDANCE_THRESHOLD_PERCENT,
      overall: null,
      subjects: [],
    };
  }

  const term = await resolveTerm(termId);
  if (!term) {
    return {
      term: null,
      threshold: ATTENDANCE_THRESHOLD_PERCENT,
      overall: null,
      subjects: [],
    };
  }

  const rows = await AttendanceSession.aggregate([
    { $match: { term: term._id, "records.student": student._id } },
    { $unwind: "$records" },
    { $match: { "records.student": student._id } },
    {
      $group: {
        _id: "$subject",
        held: { $sum: 1 },
        present: {
          $sum: {
            $cond: [{ $in: ["$records.status", ATTENDED_STATUSES] }, 1, 0],
          },
        },
        late: {
          $sum: {
            $cond: [{ $eq: ["$records.status", ATTENDANCE_STATUS.LATE] }, 1, 0],
          },
        },
        excused: {
          $sum: {
            $cond: [{ $eq: ["$records.status", ATTENDANCE_STATUS.EXCUSED] }, 1, 0],
          },
        },
        absent: {
          $sum: {
            $cond: [{ $eq: ["$records.status", ATTENDANCE_STATUS.ABSENT] }, 1, 0],
          },
        },
      },
    },
  ]);

  const subjectIds = rows.map((row) => row._id);
  const subjects = await Subject.find({ _id: { $in: subjectIds } })
    .select("code name credits semester")
    .lean();

  const subjectById = new Map(subjects.map((subject) => [String(subject._id), subject]));

  const subjectRows = rows
    .map((row) => {
      const subject = subjectById.get(String(row._id));
      return {
        subject: subject
          ? {
              id: String(subject._id),
              code: subject.code,
              name: subject.name,
              credits: subject.credits,
            }
          : { id: String(row._id), code: "—", name: "Unknown subject" },
        held: row.held,
        // `present` already includes late; keep the breakdown explicit for the UI.
        attended: row.present,
        present: row.present - row.late,
        late: row.late,
        excused: row.excused,
        absent: row.absent,
        percentage: percentage(row.present, row.held),
        belowThreshold: percentage(row.present, row.held) < ATTENDANCE_THRESHOLD_PERCENT,
      };
    })
    .sort((a, b) => a.subject.code.localeCompare(b.subject.code));

  const held = subjectRows.reduce((sum, row) => sum + row.held, 0);
  const attended = subjectRows.reduce((sum, row) => sum + row.attended, 0);

  return {
    term: presentTerm(term),
    threshold: ATTENDANCE_THRESHOLD_PERCENT,
    overall:
      held > 0
        ? {
            held,
            attended,
            percentage: percentage(attended, held),
            belowThreshold: percentage(attended, held) < ATTENDANCE_THRESHOLD_PERCENT,
          }
        : null,
    subjects: subjectRows,
  };
}

/**
 * Per-student attendance for one subject.
 *
 * Includes students with no sessions yet (held 0, percentage null) rather than
 * omitting them — a blank is a different fact from "not enrolled", and a HOD
 * chasing a low-attendance list needs to see who has never been marked.
 */
async function subjectSummary({ user, subjectId, termId }) {
  const subject = await Subject.findById(subjectId)
    .populate("program", "name code")
    .populate("department", "name code");

  if (!subject) {
    throw ApiError.notFound("Subject not found");
  }

  const teachesIt =
    subject._id &&
    (await TimetableEntry.exists({ subject: subject._id, faculty: user._id }));

  const allowed =
    userHasPermission(user, P.ATTENDANCE_READ_INSTITUTION) ||
    (userHasPermission(user, P.ATTENDANCE_READ_DEPARTMENT) &&
      user.department &&
      String(subject.department._id) === String(user.department)) ||
    Boolean(teachesIt);

  if (!allowed) {
    throw ApiError.forbidden("You cannot read attendance for this subject");
  }

  const term = await resolveTerm(termId);
  if (!term) {
    return {
      subject: {
        id: String(subject._id),
        code: subject.code,
        name: subject.name,
        semester: subject.semester,
      },
      term: null,
      threshold: ATTENDANCE_THRESHOLD_PERCENT,
      students: [],
    };
  }

  const roster = await rosterForSubject(subject);

  const rows = await AttendanceSession.aggregate([
    { $match: { term: term._id, subject: subject._id } },
    { $unwind: "$records" },
    {
      $group: {
        _id: "$records.student",
        held: { $sum: 1 },
        present: {
          $sum: {
            $cond: [{ $in: ["$records.status", ATTENDED_STATUSES] }, 1, 0],
          },
        },
        absent: {
          $sum: {
            $cond: [{ $eq: ["$records.status", ATTENDANCE_STATUS.ABSENT] }, 1, 0],
          },
        },
        late: {
          $sum: {
            $cond: [{ $eq: ["$records.status", ATTENDANCE_STATUS.LATE] }, 1, 0],
          },
        },
        excused: {
          $sum: {
            $cond: [{ $eq: ["$records.status", ATTENDANCE_STATUS.EXCUSED] }, 1, 0],
          },
        },
      },
    },
  ]);

  const byStudent = new Map(rows.map((row) => [String(row._id), row]));

  const students = roster
    .map((student) => {
      const row = byStudent.get(student.studentId);
      const held = row?.held ?? 0;
      const attended = row?.present ?? 0;
      const pct = percentage(attended, held);

      return {
        ...student,
        held,
        attended,
        present: (row?.present ?? 0) - (row?.late ?? 0),
        late: row?.late ?? 0,
        excused: row?.excused ?? 0,
        absent: row?.absent ?? 0,
        percentage: pct,
        belowThreshold: pct !== null && pct < ATTENDANCE_THRESHOLD_PERCENT,
      };
    })
    .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber));

  return {
    subject: {
      id: String(subject._id),
      code: subject.code,
      name: subject.name,
      semester: subject.semester,
      program: subject.program
        ? { code: subject.program.code, name: subject.program.name }
        : null,
    },
    term: presentTerm(term),
    threshold: ATTENDANCE_THRESHOLD_PERCENT,
    students,
  };
}

/**
 * HOD / institution roll-up: one row per subject.
 *
 * Two aggregations, because they answer different questions: how much teaching
 * was marked (sessions, marks), and how many students are below the threshold
 * (which needs a per-student total before it can be counted).
 */
async function overview({ user, termId }) {
  const term = await resolveTerm(termId);
  if (!term) {
    return { term: null, threshold: ATTENDANCE_THRESHOLD_PERCENT, subjects: [] };
  }

  let subjectFilter = null;

  if (!userHasPermission(user, P.ATTENDANCE_READ_INSTITUTION)) {
    if (!userHasPermission(user, P.ATTENDANCE_READ_DEPARTMENT) || !user.department) {
      throw ApiError.forbidden("You cannot read an attendance roll-up");
    }
    const ids = await Subject.find({ department: user.department }).distinct("_id");
    subjectFilter = { $in: ids };
  }

  const sessionMatch = { term: term._id };
  if (subjectFilter) sessionMatch.subject = subjectFilter;

  const [sessionRows, studentRows] = await Promise.all([
    AttendanceSession.aggregate([
      { $match: sessionMatch },
      {
        $group: {
          _id: "$subject",
          sessions: { $sum: 1 },
          marks: { $sum: { $size: "$records" } },
        },
      },
    ]),
    AttendanceSession.aggregate([
      { $match: sessionMatch },
      { $unwind: "$records" },
      {
        $group: {
          _id: { subject: "$subject", student: "$records.student" },
          held: { $sum: 1 },
          present: {
            $sum: {
              $cond: [{ $in: ["$records.status", ATTENDED_STATUSES] }, 1, 0],
            },
          },
        },
      },
      {
        $group: {
          _id: "$_id.subject",
          students: { $sum: 1 },
          belowThreshold: {
            $sum: {
              $cond: [
                {
                  $lt: [
                    {
                      $multiply: [{ $divide: ["$present", "$held"] }, 100],
                    },
                    ATTENDANCE_THRESHOLD_PERCENT,
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const sessionBySubject = new Map(sessionRows.map((row) => [String(row._id), row]));
  const studentBySubject = new Map(studentRows.map((row) => [String(row._id), row]));

  const subjectIds = [...new Set([...sessionBySubject.keys()])];
  const subjects = await Subject.find({ _id: { $in: subjectIds } })
    .select("code name semester department")
    .lean();

  const rows = subjects
    .map((subject) => {
      const sessions = sessionBySubject.get(String(subject._id));
      const students = studentBySubject.get(String(subject._id));

      return {
        subject: {
          id: String(subject._id),
          code: subject.code,
          name: subject.name,
          semester: subject.semester,
        },
        sessions: sessions?.sessions ?? 0,
        marks: sessions?.marks ?? 0,
        students: students?.students ?? 0,
        belowThreshold: students?.belowThreshold ?? 0,
      };
    })
    .sort((a, b) => a.subject.code.localeCompare(b.subject.code));

  return {
    term: presentTerm(term),
    threshold: ATTENDANCE_THRESHOLD_PERCENT,
    subjects: rows,
  };
}

module.exports = {
  mark,
  correct,
  entryContext,
  day,
  mine,
  subjectSummary,
  overview,
  // Exported for tests and for the marks module that will reuse the roster.
  rosterForSubject,
  percentage,
  isoWeekday,
  dateKey,
};
