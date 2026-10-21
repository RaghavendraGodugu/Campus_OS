const { ApiError } = require("./ApiError");
const { userHasPermission } = require("./permissions");

/**
 * Department-scoped write authorisation for academic structure.
 *
 * ## Why this is a helper and not three copies
 *
 * The same question — "may this person change a record owned by this
 * department?" — is asked by subjects, rooms and timetable entries. Three
 * copies of a security check is three chances for one of them to drift, and the
 * drift would be invisible until somebody scheduled a class into another
 * department's timetable.
 *
 * ## Two permissions, one decision
 *
 * `institution` is an unconditional grant. `department` is conditional on the
 * caller's own department matching the record's. A caller holding neither is
 * refused. There is deliberately no "seniority" fallback: a Principal who lacks
 * the institution grant is refused, exactly like everyone else.
 */
function canManageDepartment(user, departmentId, { institution, department }) {
  if (userHasPermission(user, institution)) {
    return true;
  }

  if (!userHasPermission(user, department)) {
    return false;
  }

  if (!departmentId || !user.department) {
    return false;
  }

  return String(user.department) === String(departmentId);
}

function assertCanManageDepartment(
  user,
  departmentId,
  { institution, department, message }
) {
  if (canManageDepartment(user, departmentId, { institution, department })) {
    return;
  }

  throw ApiError.forbidden(message ?? "You do not have permission to change this record");
}

/** Escape a user-supplied string before it is used as a regular expression. */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse the `active` query flag. Defaults to active-only. */
function parseActiveFilter(value, defaultActive = true) {
  if (value === "true") return true;
  if (value === "false") return false;
  return defaultActive;
}

module.exports = {
  canManageDepartment,
  assertCanManageDepartment,
  escapeRegex,
  parseActiveFilter,
};
