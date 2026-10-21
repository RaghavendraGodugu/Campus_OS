/**
 * Canonical enumerations shared across models, services and validators.
 *
 * These are the single source of truth for every closed set of values in the
 * system. Anything a Mongoose enum, a Zod validator or a permission check
 * agrees on must be declared here exactly once, so a value can never be
 * accepted in one layer and rejected in another.
 */

/** Institutional roles. Ordered least- to most-privileged for display. */
const ROLES = {
  STUDENT: "STUDENT",
  SUPPORT_STAFF: "SUPPORT_STAFF",
  FACULTY: "FACULTY",
  HOD: "HOD",
  EXAM_ADMIN: "EXAM_ADMIN",
  ACCOUNTS_ADMIN: "ACCOUNTS_ADMIN",
  HOSTEL_ADMIN: "HOSTEL_ADMIN",
  LIBRARY_ADMIN: "LIBRARY_ADMIN",
  PLACEMENT_ADMIN: "PLACEMENT_ADMIN",
  DEAN: "DEAN",
  PRINCIPAL: "PRINCIPAL",
  SUPER_ADMIN: "SUPER_ADMIN",
};

const ROLE_VALUES = Object.freeze(Object.values(ROLES));

/** Roles that represent college staff rather than students. */
const STAFF_ROLES = Object.freeze(ROLE_VALUES.filter((role) => role !== ROLES.STUDENT));

/**
 * Universal request workflow states (spec §9).
 *
 * Transitions are NOT free-form. The legal edges are declared once, in
 * `utils/workflow.js`, and every state change is validated against that table
 * before it reaches the database.
 */
/**
 * Academic terms.
 *
 * PLANNED exists so a term can be entered before it opens. A term that cannot be
 * described until the day it starts is a term nobody has time to set up.
 */
const ACADEMIC_TERM_STATUS = Object.freeze({
  PLANNED: "PLANNED",
  OPEN: "OPEN",
  CLOSED: "CLOSED",
});

const ACADEMIC_TERM_KINDS = Object.freeze({
  SEMESTER: "SEMESTER",
  TRIMESTER: "TRIMESTER",
  ACADEMIC_YEAR: "ACADEMIC_YEAR",
});

/**
 * The kind of teaching a subject is.
 *
 * Theory and lab are separate timetable objects even when they share a paper
 * code: a lab needs a lab room and its own weekly block, and most colleges
 * count the two differently in a student's load. Folding them into one record
 * is what forces a timetable to lie about where the class actually meets.
 */
const SUBJECT_KINDS = Object.freeze({
  THEORY: "THEORY",
  LAB: "LAB",
  PROJECT: "PROJECT",
  SEMINAR: "SEMINAR",
});
const SUBJECT_KIND_VALUES = Object.freeze(Object.values(SUBJECT_KINDS));

/** Physical space kinds. A lab double-booked into a classroom is a real clash. */
const ROOM_KINDS = Object.freeze({
  CLASSROOM: "CLASSROOM",
  LAB: "LAB",
  SEMINAR: "SEMINAR",
  AUDITORIUM: "AUDITORIUM",
});
const ROOM_KIND_VALUES = Object.freeze(Object.values(ROOM_KINDS));

/**
 * How a student was recorded for one class meeting.
 *
 * `LATE` counts as attended in the derived percentage — the student was in the
 * room. `EXCUSED` does not: an approved absence is still an absence for the
 * 75% rule, and pretending otherwise would let a student clear the threshold on
 * approved leaves alone. The policy lives here so the arithmetic and the label
 * cannot drift.
 */
const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
  LATE: "LATE",
  EXCUSED: "EXCUSED",
});
const ATTENDANCE_STATUS_VALUES = Object.freeze(Object.values(ATTENDANCE_STATUS));

/** Statuses that count toward "attended". */
const ATTENDED_STATUSES = Object.freeze([
  ATTENDANCE_STATUS.PRESENT,
  ATTENDANCE_STATUS.LATE,
]);

/**
 * The institutional threshold, as policy rather than a magic number.
 *
 * It is used to flag students in a roll-up; it is not enforced as a hard block
 * anywhere, because eligibility for an exam is a decision the college makes,
 * not a rule this code should silently apply.
 */
const ATTENDANCE_THRESHOLD_PERCENT = 75;

/** The kinds of assessment component a subject can carry. */
const ASSESSMENT_KINDS = Object.freeze({
  INTERNAL: "INTERNAL",
  EXTERNAL: "EXTERNAL",
  PRACTICAL: "PRACTICAL",
  PROJECT: "PROJECT",
  VIVA: "VIVA",
});
const ASSESSMENT_KIND_VALUES = Object.freeze(Object.values(ASSESSMENT_KINDS));

/**
 * The grade scale.
 *
 * Ordered from highest to lowest; the first entry whose `min` the percentage
 * reaches is the grade. `points` is the conventional 10-point value used for a
 * GPA, and `passing` is explicit rather than inferred from the letter, so
 * changing the scale cannot silently turn a pass into an arrears subject.
 */
/** Hostel kinds. A co-ed hostel is a real category, not a missing value. */
const HOSTEL_KINDS = Object.freeze({ BOYS: "BOYS", GIRLS: "GIRLS", COED: "COED" });
const HOSTEL_KIND_VALUES = Object.freeze(Object.values(HOSTEL_KINDS));

const HOSTEL_ALLOCATION_STATUS = Object.freeze({ ACTIVE: "ACTIVE", VACATED: "VACATED" });
const HOSTEL_LEAVE_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

const BOOK_ISSUE_STATUS = Object.freeze({ ISSUED: "ISSUED", RETURNED: "RETURNED" });

const PLACEMENT_DRIVE_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  OPEN: "OPEN",
  CLOSED: "CLOSED",
});

const PLACEMENT_APPLICATION_STATUS = Object.freeze({
  APPLIED: "APPLIED",
  SHORTLISTED: "SHORTLISTED",
  SELECTED: "SELECTED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
});

const GRADE_SCALE = Object.freeze([
  { grade: "O", min: 90, points: 10, passing: true },
  { grade: "A+", min: 80, points: 9, passing: true },
  { grade: "A", min: 70, points: 8, passing: true },
  { grade: "B+", min: 60, points: 7, passing: true },
  { grade: "B", min: 50, points: 6, passing: true },
  { grade: "C", min: 40, points: 5, passing: true },
  { grade: "F", min: 0, points: 0, passing: false },
]);

const REQUEST_STATUS = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  ASSIGNED: "ASSIGNED",
  UNDER_REVIEW: "UNDER_REVIEW",
  ACTION_REQUIRED: "ACTION_REQUIRED",
  APPROVAL_PENDING: "APPROVAL_PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  ESCALATED: "ESCALATED",
};

const REQUEST_STATUS_VALUES = Object.freeze(Object.values(REQUEST_STATUS));

/**
 * States a request can never leave. Used to stop SLA clocks and block
 * further transitions.
 */
const TERMINAL_STATUSES = Object.freeze([
  REQUEST_STATUS.COMPLETED,
  REQUEST_STATUS.REJECTED,
  REQUEST_STATUS.CANCELLED,
]);

/**
 * States in which a student may still supply information or withdraw.
 * A request in one of these is considered "open by the student".
 */
const STUDENT_ACTIONABLE_STATUSES = Object.freeze([
  REQUEST_STATUS.DRAFT,
  REQUEST_STATUS.ACTION_REQUIRED,
  REQUEST_STATUS.SUBMITTED,
]);

/** Complaint lifecycle, modelled separately from requests (spec §10). */
const COMPLAINT_STATUS = {
  OPEN: "OPEN",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  INVESTIGATING: "INVESTIGATING",
  RESOLVED: "RESOLVED",
  REJECTED: "REJECTED",
  REOPENED: "REOPENED",
};

const COMPLAINT_STATUS_VALUES = Object.freeze(Object.values(COMPLAINT_STATUS));

const COMPLAINT_PRIORITY = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
};

const COMPLAINT_PRIORITY_VALUES = Object.freeze(Object.values(COMPLAINT_PRIORITY));

/** Certificate issuance pipeline (spec §11). */
const CERTIFICATE_STATUS = {
  APPLIED: "APPLIED",
  VALIDATING: "VALIDATING",
  VERIFYING: "VERIFYING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  GENERATED: "GENERATED",
  REVOKED: "REVOKED",
};

const CERTIFICATE_STATUS_VALUES = Object.freeze(Object.values(CERTIFICATE_STATUS));

/** Invoice lifecycle. Amounts are always integer paise (spec §12). */
const INVOICE_STATUS = {
  DRAFT: "DRAFT",
  ISSUED: "ISSUED",
  PAID: "PAID",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  OVERDUE: "OVERDUE",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
};

const INVOICE_STATUS_VALUES = Object.freeze(Object.values(INVOICE_STATUS));

/** Payment terminal states. A payment is only PAID after server verification. */
const PAYMENT_STATUS = {
  CREATED: "CREATED",
  ATTEMPTED: "ATTEMPTED",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
};

const PAYMENT_STATUS_VALUES = Object.freeze(Object.values(PAYMENT_STATUS));

const REFUND_STATUS = {
  REQUESTED: "REQUESTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PROCESSED: "PROCESSED",
  FAILED: "FAILED",
};

const REFUND_STATUS_VALUES = Object.freeze(Object.values(REFUND_STATUS));

/** Who an announcement is addressed to. */
const AUDIENCE_SCOPE = {
  ALL: "ALL",
  ROLES: "ROLES",
  DEPARTMENT: "DEPARTMENT",
  PROGRAM: "PROGRAM",
};

const AUDIENCE_SCOPE_VALUES = Object.freeze(Object.values(AUDIENCE_SCOPE));

/**
 * Announcement urgency.
 *
 * URGENT is for closures and deadlines, not marketing. It is deliberately the
 * top of a short list rather than a separate channel, so a genuine emergency
 * cannot be lost among routine notices.
 */
const ANNOUNCEMENT_PRIORITY = {
  NORMAL: "NORMAL",
  IMPORTANT: "IMPORTANT",
  URGENT: "URGENT",
};

const ANNOUNCEMENT_PRIORITY_VALUES = Object.freeze(Object.values(ANNOUNCEMENT_PRIORITY));

/** Notification kinds the backend can emit in Phase A. */
const NOTIFICATION_TYPE = {
  REQUEST_SUBMITTED: "REQUEST_SUBMITTED",
  REQUEST_ASSIGNED: "REQUEST_ASSIGNED",
  REQUEST_STATUS_CHANGED: "REQUEST_STATUS_CHANGED",
  REQUEST_COMMENT: "REQUEST_COMMENT",
  REQUEST_ACTION_REQUIRED: "REQUEST_ACTION_REQUIRED",
  COMPLAINT_STATUS_CHANGED: "COMPLAINT_STATUS_CHANGED",
  COMPLAINT_ESCALATED: "COMPLAINT_ESCALATED",
  CERTIFICATE_STATUS_CHANGED: "CERTIFICATE_STATUS_CHANGED",
  CERTIFICATE_READY: "CERTIFICATE_READY",
  INVOICE_ISSUED: "INVOICE_ISSUED",
  PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  REFUND_STATUS_CHANGED: "REFUND_STATUS_CHANGED",
  ANNOUNCEMENT: "ANNOUNCEMENT",
};

const ANNOUNCEMENT_AUDIENCE = {
  ALL: "ALL",
  ROLES: "ROLES",
  DEPARTMENTS: "DEPARTMENTS",
  PROGRAMS: "PROGRAMS",
  YEARS: "YEARS",
};

/**
 * The nine certificate types.
 *
 * Named here rather than inline on the model, because a template is validated
 * against exactly the same vocabulary — and two lists that drift apart means a
 * template can exist for a certificate type nothing will ever issue.
 */
const CERTIFICATE_TYPES = Object.freeze([
  "BONAFIDE",
  "STUDY",
  "TRANSFER",
  "MIGRATION",
  "CHARACTER",
  "COURSE_COMPLETION",
  "NO_DUES",
  "INTERNSHIP",
  "TRANSCRIPT",
]);

/**
 * Placeholders a certificate template may use.
 *
 * A closed list. An open one would let a template ask for a field that is not
 * rendered, and the printer would silently produce a blank where a name belongs.
 */
const CERTIFICATE_TEMPLATE_TOKENS = Object.freeze([
  "{{studentName}}",
  "{{rollNumber}}",
  "{{programme}}",
  "{{department}}",
  "{{semester}}",
  "{{academicYear}}",
  "{{certificateType}}",
  "{{issueDate}}",
  "{{reference}}",
  "{{signatoryName}}",
  "{{signatoryTitle}}",
  "{{institutionName}}",
]);

/** Audit action namespace. Kept coarse; details live in metadata. */
const AUDIT_ACTION = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  LOGIN: "LOGIN",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGOUT: "LOGOUT",
  TOKEN_REFRESH: "TOKEN_REFRESH",
  TOKEN_REUSE_DETECTED: "TOKEN_REUSE_DETECTED",
  PASSWORD_CHANGE: "PASSWORD_CHANGE",
  ROLE_CHANGE: "ROLE_CHANGE",
  STATUS_TRANSITION: "STATUS_TRANSITION",
  ASSIGNMENT: "ASSIGNMENT",
  PAYMENT_INITIATED: "PAYMENT_INITIATED",
  PAYMENT_VERIFIED: "PAYMENT_VERIFIED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  REFUND_REQUESTED: "REFUND_REQUESTED",
  REFUND_PROCESSED: "REFUND_PROCESSED",
  ANNOUNCEMENT_POSTED: "ANNOUNCEMENT_POSTED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_DOWNLOADED: "DOCUMENT_DOWNLOADED",
  CERTIFICATE_GENERATED: "CERTIFICATE_GENERATED",
  ACCESS_DENIED: "ACCESS_DENIED",
  /**
   * Academic terms get their own actions rather than reusing UPDATE.
   *
   * Opening and closing a term is the single most consequential thing an
   * administrator does to the reporting: every figure from then on is labelled
   * by it. Folding that into a generic UPDATE would leave the audit trail
   * unable to answer "who changed the term this invoice belongs to".
   */
  CERTIFICATE_TEMPLATE_CREATED: "CERTIFICATE_TEMPLATE_CREATED",
  CERTIFICATE_TEMPLATE_UPDATED: "CERTIFICATE_TEMPLATE_UPDATED",
  CERTIFICATE_TEMPLATE_DELETED: "CERTIFICATE_TEMPLATE_DELETED",
  CERTIFICATE_BULK_ISSUED: "CERTIFICATE_BULK_ISSUED",
  INVOICE_SCHEDULED: "INVOICE_SCHEDULED",
  INVOICE_POLICY_SET: "INVOICE_POLICY_SET",
  INVOICE_PENALTY_SWEEP: "INVOICE_PENALTY_SWEEP",
  TWO_FACTOR_ENROL_STARTED: "TWO_FACTOR_ENROL_STARTED",
  TWO_FACTOR_ENABLED: "TWO_FACTOR_ENABLED",
  TWO_FACTOR_DISABLED: "TWO_FACTOR_DISABLED",
  TWO_FACTOR_RECOVERY_USED: "TWO_FACTOR_RECOVERY_USED",
  EMAIL_SENT: "EMAIL_SENT",
  EMAIL_VERIFIED: "EMAIL_VERIFIED",
  PASSWORD_RESET: "PASSWORD_RESET",
  AVATAR_UPDATED: "AVATAR_UPDATED",
  AVATAR_REMOVED: "AVATAR_REMOVED",
  HOD_ASSIGNED: "HOD_ASSIGNED",
  HOD_UNASSIGNED: "HOD_UNASSIGNED",
  ACADEMIC_TERM_CREATED: "ACADEMIC_TERM_CREATED",
  ACADEMIC_TERM_UPDATED: "ACADEMIC_TERM_UPDATED",
  ACADEMIC_TERM_OPENED: "ACADEMIC_TERM_OPENED",
  ACADEMIC_TERM_CLOSED: "ACADEMIC_TERM_CLOSED",
  ACADEMIC_TERM_DELETED: "ACADEMIC_TERM_DELETED",

  /*
   * Academic structure and timetable.
   *
   * Separate from a generic UPDATE because a clash and a retirement are both
   * things a person will later need to attribute: "who scheduled this over the
   * lab?" is not answerable from an edit entry that records only a document id.
   */
  SUBJECT_CREATED: "SUBJECT_CREATED",
  SUBJECT_UPDATED: "SUBJECT_UPDATED",
  SUBJECT_RETIRED: "SUBJECT_RETIRED",
  ROOM_CREATED: "ROOM_CREATED",
  ROOM_UPDATED: "ROOM_UPDATED",
  ROOM_RETIRED: "ROOM_RETIRED",
  TIMETABLE_ENTRY_CREATED: "TIMETABLE_ENTRY_CREATED",
  TIMETABLE_ENTRY_UPDATED: "TIMETABLE_ENTRY_UPDATED",
  TIMETABLE_ENTRY_REMOVED: "TIMETABLE_ENTRY_REMOVED",

  /*
   * Attendance.
   *
   * Marking and correcting are separate actions: the first is the teacher
   * recording what happened, the second is somebody changing that record after
   * the fact, and the second must always name a reason.
   */
  ATTENDANCE_MARKED: "ATTENDANCE_MARKED",
  ATTENDANCE_CORRECTED: "ATTENDANCE_CORRECTED",

  /*
   * Marks and results.
   *
   * Publishing is its own action: it is the moment a student can see a result,
   * and "who released this programme's results, and when" has to be answerable
   * on its own.
   */
  ASSESSMENT_CREATED: "ASSESSMENT_CREATED",
  ASSESSMENT_DELETED: "ASSESSMENT_DELETED",
  MARKS_ENTERED: "MARKS_ENTERED",
  RESULTS_PUBLISHED: "RESULTS_PUBLISHED",

  /* Campus services. */
  HOSTEL_ALLOCATED: "HOSTEL_ALLOCATED",
  HOSTEL_VACATED: "HOSTEL_VACATED",
  HOSTEL_LEAVE_REQUESTED: "HOSTEL_LEAVE_REQUESTED",
  HOSTEL_LEAVE_DECIDED: "HOSTEL_LEAVE_DECIDED",
  BOOK_ISSUED: "BOOK_ISSUED",
  BOOK_RETURNED: "BOOK_RETURNED",
  PLACEMENT_DRIVE_CREATED: "PLACEMENT_DRIVE_CREATED",
  PLACEMENT_DRIVE_STATUS: "PLACEMENT_DRIVE_STATUS",
  PLACEMENT_APPLIED: "PLACEMENT_APPLIED",
  PLACEMENT_APPLICATION_STATUS: "PLACEMENT_APPLICATION_STATUS",
};

module.exports = {
  ROLES,
  ROLE_VALUES,
  STAFF_ROLES,
  REQUEST_STATUS,
  REQUEST_STATUS_VALUES,
  TERMINAL_STATUSES,
  ACADEMIC_TERM_STATUS,
  ACADEMIC_TERM_KINDS,
  SUBJECT_KINDS,
  SUBJECT_KIND_VALUES,
  ROOM_KINDS,
  ROOM_KIND_VALUES,
  ATTENDANCE_STATUS,
  ATTENDANCE_STATUS_VALUES,
  ATTENDED_STATUSES,
  ATTENDANCE_THRESHOLD_PERCENT,
  ASSESSMENT_KINDS,
  ASSESSMENT_KIND_VALUES,
  GRADE_SCALE,
  HOSTEL_KINDS,
  HOSTEL_KIND_VALUES,
  HOSTEL_ALLOCATION_STATUS,
  HOSTEL_LEAVE_STATUS,
  BOOK_ISSUE_STATUS,
  PLACEMENT_DRIVE_STATUS,
  PLACEMENT_APPLICATION_STATUS,
  STUDENT_ACTIONABLE_STATUSES,
  COMPLAINT_STATUS,
  COMPLAINT_STATUS_VALUES,
  COMPLAINT_PRIORITY,
  COMPLAINT_PRIORITY_VALUES,
  CERTIFICATE_STATUS,
  CERTIFICATE_STATUS_VALUES,
  INVOICE_STATUS,
  INVOICE_STATUS_VALUES,
  PAYMENT_STATUS,
  PAYMENT_STATUS_VALUES,
  REFUND_STATUS,
  REFUND_STATUS_VALUES,
  AUDIENCE_SCOPE,
  AUDIENCE_SCOPE_VALUES,
  ANNOUNCEMENT_PRIORITY,
  ANNOUNCEMENT_PRIORITY_VALUES,
  NOTIFICATION_TYPE,
  CERTIFICATE_TYPES,
  CERTIFICATE_TEMPLATE_TOKENS,
  ANNOUNCEMENT_AUDIENCE,
  AUDIT_ACTION,
};
