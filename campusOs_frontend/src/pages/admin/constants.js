/**
 * Values the administration screens need to know, kept in one place.
 *
 * `ASSIGNABLE_ROLES` and `PROGRAM_LEVELS` mirror the server's lists. The server
 * is the authority — it refuses anything not in its own registry — but a
 * dropdown offering a role the server will reject is a trap for the person
 * using it, so the two are kept deliberately in step.
 */

/**
 * Super administrator is absent on purpose.
 *
 * The server excludes it, and excluding it here too means the screen never
 * offers something that is guaranteed to fail. Appointing super administrators
 * is a reviewed decision made outside this application.
 */
export const ASSIGNABLE_ROLES = Object.freeze([
  "STUDENT",
  "SUPPORT_STAFF",
  "FACULTY",
  "HOD",
  "EXAM_ADMIN",
  "ACCOUNTS_ADMIN",
  "HOSTEL_ADMIN",
  "LIBRARY_ADMIN",
  "PLACEMENT_ADMIN",
  "DEAN",
  "PRINCIPAL",
]);

/**
 * Roles whose permissions are scoped to a department. An account in one of
 * these with no department is not unrestricted — it sees nothing, which is much
 * harder to notice than an obvious error.
 */
export const DEPARTMENT_REQUIRED_ROLES = Object.freeze(["FACULTY", "HOD"]);

/** Taken verbatim from the Program model, which prints these on documents. */
export const PROGRAM_LEVELS = Object.freeze([
  "UNDERGRADUATE",
  "POSTGRADUATE",
  "DIPLOMA",
  "CERTIFICATE",
  "DOCTORAL",
]);

/**
 * GST rate slabs, mirrored from the server.
 *
 * Declared here so the invoice form can offer them as options rather than a
 * free-text box. The server validates independently and refuses anything else,
 * so a stale copy here costs a confusing rejection, not a wrong invoice.
 */
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];

/** "0.25%" not "0.25" — a rate without its sign is easy to misread. */
export function formatRate(rate) {
  return `${rate}%`;
}
