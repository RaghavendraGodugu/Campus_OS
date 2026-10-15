/**
 * Role-based access control matrix.
 *
 * ## Why this file is the authority
 *
 * The frontend hides actions a role cannot perform, but that is presentation
 * only. Every decision here is re-made on the server for each request:
 *
 *   1. `authenticate()` loads the user from MongoDB on every request.
 *   2. Permissions are derived from the **stored role**, never from a token
 *      claim.
 *   3. `requirePermission()` gates the route.
 *   4. The service layer additionally applies an ownership/department/confidentiality
 *      filter to the query itself.
 *
 * Step 4 is not optional. Route middleware says "this ROLE may approve a
 * request"; only the service layer can answer "may THIS HOD approve THIS
 * request". Skipping it is what produces IDOR vulnerabilities.
 *
 * ## Least privilege
 *
 * A role is not a rank. `SUPER_ADMIN` can manage users; that does not make it
 * the correct role for reading a student's fee history, and nothing here is
 * inferred from seniority. Absence from the matrix means denial.
 *
 * ## Adding a role or permission
 *
 *  1. Add the role to `ROLES` in config/constants.js.
 *  2. Grant the minimum capability set below.
 *  3. Add a test in tests/rbac.test.js proving the denial, not just the grant.
 */

const { ROLES } = require("../config/constants");

/**
 * Scopes. A permission is only meaningful together with how far it reaches.
 *
 *  - OWN         only the caller's own records
 *  - ASSIGNED    only records assigned to the caller
 *  - DEPARTMENT  records belonging to the caller's department
 *  - INSTITUTION every record in the college
 */
const SCOPE = {
  OWN: "own",
  ASSIGNED: "assigned",
  DEPARTMENT: "department",
  INSTITUTION: "institution",
};

/**
 * Permission strings are `domain:action:scope`.
 *
 * Keeping the scope inside the string means a capability cannot be granted
 * "everywhere" by accident — widening a permission is a visible edit to one
 * entry, and the tests assert the denial case explicitly.
 */
const P = {
  // ===== Profile =====
  STUDENT_PROFILE_READ_OWN: "student:read:own",
  STUDENT_PROFILE_UPDATE_OWN: "student:update:own",
  STUDENT_READ_DEPARTMENT: "student:read:department",
  STUDENT_READ_INSTITUTION: "student:read:institution",

  // ===== Institutional structure =====
  DEPARTMENT_READ: "department:read:institution",
  DEPARTMENT_MANAGE: "department:manage:institution",
  ACADEMIC_TERM_MANAGE: "academic-term:manage:institution",
  ACADEMIC_TERM_READ: "academic-term:read",
  PROGRAM_READ: "program:read:institution",
  PROGRAM_MANAGE: "program:manage:institution",

  // ===== Requests =====
  REQUEST_CREATE: "request:create:own",
  REQUEST_READ_OWN: "request:read:own",
  REQUEST_READ_ASSIGNED: "request:read:assigned",
  REQUEST_READ_DEPARTMENT: "request:read:department",
  REQUEST_READ_INSTITUTION: "request:read:institution",
  REQUEST_UPDATE_ASSIGNED: "request:update:assigned",
  REQUEST_ASSIGN_DEPARTMENT: "request:assign:department",
  REQUEST_ASSIGN_INSTITUTION: "request:assign:institution",
  REQUEST_APPROVE_DEPARTMENT: "request:approve:department",
  REQUEST_APPROVE_INSTITUTION: "request:approve:institution",
  REQUEST_ESCALATE: "request:escalate:institution",
  REQUEST_CANCEL_OWN: "request:cancel:own",
  /** Move a request into review; distinct from approving it. */
  REQUEST_REVIEW_ASSIGNED: "request:review:assigned",
  /** Progress an approved request into processing. */
  REQUEST_PROCESS_ASSIGNED: "request:process:assigned",
  /** Mark processing finished and resolve. */
  REQUEST_COMPLETE_ASSIGNED: "request:complete:assigned",
  /** Respond to a request for more information. */
  REQUEST_RESPOND_OWN: "request:respond:own",
  /** View internal staff notes (never student-visible). */
  REQUEST_INTERNAL_NOTE: "request:internal-note:institution",
  /** Manage the catalogue of request types. */
  REQUEST_TYPE_MANAGE: "request-type:manage:institution",

  // ===== Complaints =====
  COMPLAINT_CREATE: "complaint:create:own",
  COMPLAINT_READ_OWN: "complaint:read:own",
  COMPLAINT_READ_ASSIGNED: "complaint:read:assigned",
  /**
   * See the unassigned, non-restricted queue so it can be triaged.
   *
   * Distinct from handling: picking up a complaint is how it becomes assigned,
   * and `complaint:read:assigned` alone would make assignment impossible.
   * Never grants access to confidential complaints.
   */
  COMPLAINT_TRIAGE: "complaint:triage:institution",
  COMPLAINT_READ_DEPARTMENT: "complaint:read:department",
  COMPLAINT_READ_INSTITUTION: "complaint:read:institution",
  /** Restricted category: sexual harassment, safety, financial misconduct. */
  COMPLAINT_READ_CONFIDENTIAL: "complaint:read:confidential",
  COMPLAINT_UPDATE_ASSIGNED: "complaint:update:assigned",
  COMPLAINT_ESCALATE: "complaint:escalate:institution",
  /** Move an open complaint to ACKNOWLEDGED. */
  COMPLAINT_ACKNOWLEDGE: "complaint:acknowledge:assigned",
  /** Begin investigation after acknowledgement. */
  COMPLAINT_INVESTIGATE: "complaint:investigate:assigned",
  /** Record a resolution. Terminal unless the student reopens. */
  COMPLAINT_RESOLVE: "complaint:resolve:assigned",
  /** Student reopens a resolved complaint within the allowed window. */
  COMPLAINT_REOPEN_OWN: "complaint:reopen:own",
  /** Student submits feedback on a resolution. */
  COMPLAINT_FEEDBACK_OWN: "complaint:feedback:own",
  /** See the escalation log for a complaint. */
  COMPLAINT_READ_ESCALATIONS: "complaint:read-escalations:department",
  /** Configure SLA policy and the holiday calendar. */
  SLA_MANAGE: "sla:manage:institution",

  // ===== Certificates =====
  CERTIFICATE_APPLY: "certificate:apply:own",
  CERTIFICATE_READ_OWN: "certificate:read:own",
  CERTIFICATE_READ_ASSIGNED: "certificate:read:assigned",
  CERTIFICATE_READ_DEPARTMENT: "certificate:read:department",
  CERTIFICATE_READ_INSTITUTION: "certificate:read:institution",
  CERTIFICATE_VERIFY: "certificate:verify:department",
  /** Render and store the PDF; the only path that writes an issue record. */
  CERTIFICATE_ISSUE: "certificate:issue:department",
  CERTIFICATE_APPROVE: "certificate:approve:department",
  CERTIFICATE_APPROVE_INSTITUTION: "certificate:approve:institution",
  CERTIFICATE_REVOKE: "certificate:revoke:institution",

  // ===== Finance =====
  INVOICE_READ_OWN: "invoice:read:own",
  INVOICE_READ_INSTITUTION: "invoice:read:institution",
  INVOICE_MANAGE: "invoice:manage:institution",
  PAYMENT_CREATE_OWN: "payment:create:own",
  PAYMENT_READ_OWN: "payment:read:own",
  PAYMENT_READ_INSTITUTION: "payment:read:institution",
  PAYMENT_MANAGE: "payment:manage:institution",
  REFUND_REQUEST: "refund:request:own",
  REFUND_APPROVE: "refund:approve:institution",
  REFUND_PROCESS: "refund:process:institution",

  // ===== Notifications and announcements =====
  NOTIFICATION_READ_OWN: "notification:read:own",
  ANNOUNCEMENT_READ: "announcement:read:institution",
  ANNOUNCEMENT_MANAGE: "announcement:manage:institution",

  // ===== Documents =====
  //
  // Attaching a file is a separate permission from reading the request it hangs
  // off, because a document is the part most likely to contain something
  // sensitive — an identity scan, a bank statement — and the person who raised a
  // request is not always the only one who should see what was attached.
  DOCUMENT_UPLOAD_OWN: "document:upload:own",
  DOCUMENT_READ_OWN: "document:read:own",
  DOCUMENT_READ_ASSIGNED: "document:read:assigned",
  DOCUMENT_READ_DEPARTMENT: "document:read:department",
  DOCUMENT_READ_INSTITUTION: "document:read:institution",

  // ===== Reports and audit =====
  REPORT_READ_DEPARTMENT: "report:read:department",
  REPORT_READ_INSTITUTION: "report:read:institution",
  REPORT_FINANCE: "report:read:finance",
  AUDIT_READ_DEPARTMENT: "audit:read:department",
  AUDIT_READ_INSTITUTION: "audit:read:institution",

  // ===== Administration =====
  USER_READ: "user:read:institution",
  USER_MANAGE: "user:manage:institution",
  ROLE_CHANGE: "role:change:institution",
  SETTINGS_MANAGE: "settings:manage:institution",
};

/**
 * Capabilities granted to every authenticated account, regardless of role.
 *
 * Deliberately minimal — a user may always read and update their own basic
 * profile and their own notifications. Everything else is role-specific.
 *
 * Note on scope: these carry `:institution` even though every role holds them,
 * because the resources are **non-sensitive institutional reference data** —
 * the list of departments and programmes (needed to populate dropdowns) and
 * broadcast announcements. `institution` scope here means "any college user may
 * read the directory", NOT "this role can read all institutional records".
 *
 * Per-student data (profiles, requests, complaints, invoices, certificates)
 * never appears in this list and is always scope-checked.
 */
const BASE_PERMISSIONS = [
  P.NOTIFICATION_READ_OWN,
  P.DEPARTMENT_READ,
  P.PROGRAM_READ,
  P.ACADEMIC_TERM_READ,
];

/**
 * Role → permission map.
 *
 * Read each entry as "what can this role actually do?", not "what is their
 * seniority?".
 */
const ROLE_PERMISSIONS = {
  [ROLES.STUDENT]: [
    ...BASE_PERMISSIONS,
    P.STUDENT_PROFILE_READ_OWN,
    P.STUDENT_PROFILE_UPDATE_OWN,
    P.REQUEST_CREATE,
    P.REQUEST_READ_OWN,
    P.REQUEST_CANCEL_OWN,
    P.REQUEST_RESPOND_OWN,
    P.COMPLAINT_CREATE,
    P.COMPLAINT_READ_OWN,
    P.COMPLAINT_REOPEN_OWN,
    P.COMPLAINT_FEEDBACK_OWN,
    P.CERTIFICATE_APPLY,
    P.CERTIFICATE_READ_OWN,
    P.INVOICE_READ_OWN,
    P.DOCUMENT_UPLOAD_OWN,
    P.DOCUMENT_READ_OWN,
    P.PAYMENT_CREATE_OWN,
    P.PAYMENT_READ_OWN,
    P.REFUND_REQUEST,
    P.ANNOUNCEMENT_READ,
  ],

  [ROLES.SUPPORT_STAFF]: [
    ...BASE_PERMISSIONS,
    P.STUDENT_PROFILE_READ_OWN,
    P.REQUEST_READ_ASSIGNED,
    P.REQUEST_UPDATE_ASSIGNED,
    P.REQUEST_REVIEW_ASSIGNED,
    P.REQUEST_PROCESS_ASSIGNED,
    P.REQUEST_COMPLETE_ASSIGNED,
    P.REQUEST_INTERNAL_NOTE,
    P.COMPLAINT_READ_ASSIGNED,
    P.COMPLAINT_UPDATE_ASSIGNED,
    P.COMPLAINT_TRIAGE,
    P.COMPLAINT_ACKNOWLEDGE,
    P.COMPLAINT_INVESTIGATE,
    P.COMPLAINT_RESOLVE,
    P.CERTIFICATE_READ_ASSIGNED,
    P.DOCUMENT_READ_ASSIGNED,
    P.ANNOUNCEMENT_READ,
  ],

  [ROLES.FACULTY]: [
    ...BASE_PERMISSIONS,
    P.STUDENT_PROFILE_READ_OWN,
    P.STUDENT_READ_DEPARTMENT,
    P.REQUEST_READ_DEPARTMENT,
    P.REQUEST_READ_ASSIGNED,
    P.REQUEST_UPDATE_ASSIGNED,
    P.REQUEST_REVIEW_ASSIGNED,
    P.REQUEST_PROCESS_ASSIGNED,
    P.REQUEST_COMPLETE_ASSIGNED,
    P.REQUEST_INTERNAL_NOTE,
    P.CERTIFICATE_READ_DEPARTMENT,
    P.DOCUMENT_READ_DEPARTMENT,
    P.ANNOUNCEMENT_READ,
    P.REPORT_READ_DEPARTMENT,
  ],

  [ROLES.HOD]: [
    ...BASE_PERMISSIONS,
    P.STUDENT_PROFILE_READ_OWN,
    P.STUDENT_READ_DEPARTMENT,
    P.REQUEST_READ_DEPARTMENT,
    P.REQUEST_READ_ASSIGNED,
    P.REQUEST_UPDATE_ASSIGNED,
    P.REQUEST_REVIEW_ASSIGNED,
    P.REQUEST_PROCESS_ASSIGNED,
    P.REQUEST_COMPLETE_ASSIGNED,
    P.REQUEST_APPROVE_DEPARTMENT,
    P.REQUEST_ASSIGN_DEPARTMENT,
    P.REQUEST_INTERNAL_NOTE,
    P.COMPLAINT_READ_DEPARTMENT,
    P.COMPLAINT_UPDATE_ASSIGNED,
    P.COMPLAINT_TRIAGE,
    P.COMPLAINT_ACKNOWLEDGE,
    P.COMPLAINT_INVESTIGATE,
    P.COMPLAINT_RESOLVE,
    P.CERTIFICATE_READ_DEPARTMENT,
    P.DOCUMENT_READ_DEPARTMENT,
    P.CERTIFICATE_VERIFY,
    P.CERTIFICATE_APPROVE,
    // An HOD who can approve but not issue would strand every approved
    // certificate in the department with nobody able to render it.
    P.CERTIFICATE_ISSUE,
    P.ANNOUNCEMENT_READ,
    P.REPORT_READ_DEPARTMENT,
    P.AUDIT_READ_DEPARTMENT,
  ],

  [ROLES.EXAM_ADMIN]: [
    ...BASE_PERMISSIONS,
    P.STUDENT_PROFILE_READ_OWN,
    P.STUDENT_READ_INSTITUTION,
    P.REQUEST_READ_INSTITUTION,
    P.REQUEST_READ_ASSIGNED,
    P.REQUEST_UPDATE_ASSIGNED,
    P.REQUEST_REVIEW_ASSIGNED,
    P.REQUEST_PROCESS_ASSIGNED,
    P.REQUEST_COMPLETE_ASSIGNED,
    P.REQUEST_INTERNAL_NOTE,
    P.CERTIFICATE_READ_INSTITUTION,
    P.DOCUMENT_READ_INSTITUTION,
    P.ANNOUNCEMENT_READ,
    P.REPORT_READ_DEPARTMENT,
  ],

  [ROLES.ACCOUNTS_ADMIN]: [
    ...BASE_PERMISSIONS,
    P.STUDENT_PROFILE_READ_OWN,
    P.STUDENT_READ_INSTITUTION,
    P.REQUEST_READ_INSTITUTION,
    P.INVOICE_READ_INSTITUTION,
    P.INVOICE_MANAGE,
    P.PAYMENT_READ_INSTITUTION,
    P.PAYMENT_MANAGE,
    P.REFUND_APPROVE,
    P.REFUND_PROCESS,
    P.ANNOUNCEMENT_READ,
    P.REPORT_FINANCE,
    P.REPORT_READ_INSTITUTION,
    P.AUDIT_READ_INSTITUTION,
  ],

  [ROLES.HOSTEL_ADMIN]: [
    ...BASE_PERMISSIONS,
    P.STUDENT_PROFILE_READ_OWN,
    P.STUDENT_READ_INSTITUTION,
    P.REQUEST_READ_INSTITUTION,
    P.REQUEST_READ_ASSIGNED,
    P.REQUEST_UPDATE_ASSIGNED,
    P.COMPLAINT_READ_DEPARTMENT,
    P.COMPLAINT_READ_ASSIGNED,
    P.COMPLAINT_UPDATE_ASSIGNED,
    P.COMPLAINT_TRIAGE,
    P.COMPLAINT_ACKNOWLEDGE,
    P.COMPLAINT_INVESTIGATE,
    P.COMPLAINT_RESOLVE,
    P.ANNOUNCEMENT_READ,
    P.REPORT_READ_DEPARTMENT,
  ],

  [ROLES.LIBRARY_ADMIN]: [
    ...BASE_PERMISSIONS,
    P.STUDENT_PROFILE_READ_OWN,
    P.STUDENT_READ_INSTITUTION,
    P.REQUEST_READ_INSTITUTION,
    P.REQUEST_READ_ASSIGNED,
    P.REQUEST_UPDATE_ASSIGNED,
    P.COMPLAINT_READ_DEPARTMENT,
    P.COMPLAINT_READ_ASSIGNED,
    P.COMPLAINT_UPDATE_ASSIGNED,
    P.COMPLAINT_TRIAGE,
    P.COMPLAINT_ACKNOWLEDGE,
    P.COMPLAINT_INVESTIGATE,
    P.COMPLAINT_RESOLVE,
    P.ANNOUNCEMENT_READ,
    P.REPORT_READ_DEPARTMENT,
  ],

  [ROLES.PLACEMENT_ADMIN]: [
    ...BASE_PERMISSIONS,
    P.STUDENT_PROFILE_READ_OWN,
    P.STUDENT_READ_INSTITUTION,
    P.REQUEST_READ_INSTITUTION,
    P.REQUEST_READ_ASSIGNED,
    P.REQUEST_UPDATE_ASSIGNED,
    P.COMPLAINT_READ_DEPARTMENT,
    P.COMPLAINT_READ_ASSIGNED,
    P.COMPLAINT_UPDATE_ASSIGNED,
    P.COMPLAINT_TRIAGE,
    P.COMPLAINT_ACKNOWLEDGE,
    P.COMPLAINT_INVESTIGATE,
    P.COMPLAINT_RESOLVE,
    P.CERTIFICATE_READ_INSTITUTION,
    P.DOCUMENT_READ_INSTITUTION,
    P.ANNOUNCEMENT_READ,
    P.REPORT_READ_DEPARTMENT,
  ],

  /**
   * Dean: institution-wide academic oversight plus the confidential grievance
   * channel. Confidentiality is a deliberate grant to a small number of roles,
   * not a consequence of being senior.
   */
  [ROLES.DEAN]: [
    ...BASE_PERMISSIONS,
    P.STUDENT_PROFILE_READ_OWN,
    P.STUDENT_READ_INSTITUTION,
    P.REQUEST_READ_INSTITUTION,
    P.REQUEST_READ_ASSIGNED,
    P.REQUEST_UPDATE_ASSIGNED,
    P.REQUEST_APPROVE_INSTITUTION,
    P.REQUEST_ASSIGN_INSTITUTION,
    P.REQUEST_ESCALATE,
    P.COMPLAINT_READ_INSTITUTION,
    P.COMPLAINT_READ_ASSIGNED,
    P.COMPLAINT_READ_CONFIDENTIAL,
    P.COMPLAINT_UPDATE_ASSIGNED,
    P.COMPLAINT_TRIAGE,
    P.COMPLAINT_ACKNOWLEDGE,
    P.COMPLAINT_INVESTIGATE,
    P.COMPLAINT_RESOLVE,
    P.COMPLAINT_READ_ESCALATIONS,
    P.COMPLAINT_ESCALATE,
    P.CERTIFICATE_READ_INSTITUTION,
    P.DOCUMENT_READ_INSTITUTION,
    P.CERTIFICATE_VERIFY,
    P.CERTIFICATE_APPROVE,
    P.CERTIFICATE_ISSUE,
    P.CERTIFICATE_APPROVE_INSTITUTION,
    P.ANNOUNCEMENT_READ,
    P.ANNOUNCEMENT_MANAGE,
    P.REPORT_READ_INSTITUTION,
    P.AUDIT_READ_INSTITUTION,
  ],

  [ROLES.PRINCIPAL]: [
    ...BASE_PERMISSIONS,
    P.STUDENT_PROFILE_READ_OWN,
    P.STUDENT_READ_INSTITUTION,
    P.REQUEST_READ_INSTITUTION,
    P.REQUEST_READ_ASSIGNED,
    P.REQUEST_APPROVE_INSTITUTION,
    P.REQUEST_ASSIGN_INSTITUTION,
    P.REQUEST_ESCALATE,
    P.COMPLAINT_READ_INSTITUTION,
    P.COMPLAINT_READ_ASSIGNED,
    P.COMPLAINT_READ_CONFIDENTIAL,
    P.COMPLAINT_UPDATE_ASSIGNED,
    P.COMPLAINT_TRIAGE,
    P.COMPLAINT_ACKNOWLEDGE,
    P.COMPLAINT_INVESTIGATE,
    P.COMPLAINT_RESOLVE,
    P.COMPLAINT_READ_ESCALATIONS,
    P.COMPLAINT_ESCALATE,
    P.CERTIFICATE_READ_INSTITUTION,
    P.DOCUMENT_READ_INSTITUTION,
    P.CERTIFICATE_VERIFY,
    P.CERTIFICATE_ISSUE,
    P.CERTIFICATE_APPROVE_INSTITUTION,
    P.CERTIFICATE_REVOKE,
    P.ANNOUNCEMENT_READ,
    P.ANNOUNCEMENT_MANAGE,
    P.REPORT_READ_INSTITUTION,
    P.AUDIT_READ_INSTITUTION,
  ],

  /**
   * SUPER_ADMIN administers the *system*, not the academic record. It manages
   * users, roles and configuration. It deliberately does **not** receive
   * COMPLAINT_READ_CONFIDENTIAL: platform administration should not confer
   * access to personal grievances. That separation is deliberate and should
   * only change through an explicit review.
   */
  [ROLES.SUPER_ADMIN]: [
    ...BASE_PERMISSIONS,
    P.STUDENT_PROFILE_READ_OWN,
    P.STUDENT_READ_INSTITUTION,
    P.DEPARTMENT_MANAGE,
    P.ACADEMIC_TERM_MANAGE,
    P.ACADEMIC_TERM_READ,
    P.PROGRAM_MANAGE,
    P.REQUEST_READ_INSTITUTION,
    P.REQUEST_READ_ASSIGNED,
    P.REQUEST_ASSIGN_INSTITUTION,
    P.REQUEST_ESCALATE,
    P.REQUEST_INTERNAL_NOTE,
    P.REQUEST_TYPE_MANAGE,
    P.COMPLAINT_READ_INSTITUTION,
    P.COMPLAINT_READ_ASSIGNED,
    P.COMPLAINT_UPDATE_ASSIGNED,
    P.COMPLAINT_TRIAGE,
    P.COMPLAINT_ACKNOWLEDGE,
    P.COMPLAINT_INVESTIGATE,
    P.COMPLAINT_RESOLVE,
    P.CERTIFICATE_READ_INSTITUTION,
    P.DOCUMENT_READ_INSTITUTION,
    P.CERTIFICATE_ISSUE,
    P.CERTIFICATE_REVOKE,
    P.INVOICE_READ_INSTITUTION,
    P.PAYMENT_READ_INSTITUTION,
    P.USER_READ,
    P.USER_MANAGE,
    P.ROLE_CHANGE,
    P.SETTINGS_MANAGE,
    P.ANNOUNCEMENT_READ,
    P.ANNOUNCEMENT_MANAGE,
    P.REPORT_READ_INSTITUTION,
    P.AUDIT_READ_INSTITUTION,
  ],
};

/** Roles permitted to read confidential complaints. Kept explicit for tests. */
const CONFIDENTIAL_COMPLAINT_ROLES = Object.freeze([ROLES.DEAN, ROLES.PRINCIPAL]);

/**
 * Flattened lookup: role → Set of permission strings.
 * Built once at module load; membership tests are then O(1).
 */
const PERMISSION_SETS = Object.fromEntries(
  Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, new Set(perms)])
);

/**
 * Permissions held by a role.
 * @param {string} role
 * @returns {ReadonlySet<string>}
 */
function permissionsFor(role) {
  return PERMISSION_SETS[role] ?? new Set();
}

/**
 * Does this role hold this permission?
 *
 * @param {string} role
 * @param {string} permission A `domain:action:scope` string.
 * @returns {boolean}
 */
function roleHasPermission(role, permission) {
  const set = PERMISSION_SETS[role];
  return set ? set.has(permission) : false;
}

/**
 * Does this user hold this permission?
 *
 * @param {{role: string}} user
 * @param {string} permission
 * @returns {boolean}
 */
function userHasPermission(user, permission) {
  if (!user?.role) return false;
  return roleHasPermission(user.role, permission);
}

/**
 * Does this user hold **every** listed permission?
 * Used where a capability is composed of several rights.
 *
 * @param {{role: string}} user
 * @param {string[]} permissions
 * @returns {boolean}
 */
function userHasAllPermissions(user, permissions) {
  return permissions.every((permission) => userHasPermission(user, permission));
}

/**
 * May this user read confidential grievances?
 *
 * Note the assigned handler is handled separately in the service layer: an
 * assignee must be able to read the complaint they were given, even when the
 * category is confidential. This function answers the "institutional
 * oversight" question only.
 *
 * @param {{role: string}} user
 */
function canReadConfidentialComplaints(user) {
  return roleHasPermission(user?.role, P.COMPLAINT_READ_CONFIDENTIAL);
}

/**
 * Is this role's reach bounded by a department?
 *
 * The service layer uses this to decide whether a department filter must be
 * applied. A role that is not department-scoped and lacks an institution-scope
 * permission must not be given an unfiltered query.
 *
 * @param {string} role
 */
function isDepartmentScoped(role) {
  const perms = PERMISSION_SETS[role];
  if (!perms) return false;
  return (
    perms.has(P.STUDENT_READ_DEPARTMENT) ||
    perms.has(P.REQUEST_READ_DEPARTMENT) ||
    perms.has(P.COMPLAINT_READ_DEPARTMENT) ||
    perms.has(P.CERTIFICATE_READ_DEPARTMENT) ||
    perms.has(P.REQUEST_ASSIGN_DEPARTMENT)
  );
}

/**
 * Describe a role's effective permissions, for the `/auth/me` payload and for
 * the frontend to decide which navigation to render.
 *
 * The frontend uses this for presentation only. Every check is repeated
 * server-side.
 *
 * @param {string} role
 * @returns {{role: string, permissions: string[], scopes: string[]}}
 */
function describePermissions(role) {
  const perms = [...(PERMISSION_SETS[role] ?? [])].sort();
  const scopes = [...new Set(perms.map((p) => p.split(":")[2]))].sort();
  return { role, permissions: perms, scopes };
}

module.exports = {
  SCOPE,
  P,
  BASE_PERMISSIONS,
  ROLE_PERMISSIONS,
  PERMISSION_SETS,
  CONFIDENTIAL_COMPLAINT_ROLES,
  permissionsFor,
  roleHasPermission,
  userHasPermission,
  userHasAllPermissions,
  canReadConfidentialComplaints,
  isDepartmentScoped,
  describePermissions,
};
