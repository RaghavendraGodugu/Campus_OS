/**
 * The staff directory.
 *
 * ## Why this exists
 *
 * Assignment needs a list of people to assign to. Without one, a client has two
 * bad options: a hand-typed ObjectId, which no member of staff can produce, or
 * a hardcoded list, which drifts. Both make the assignment workflow unusable
 * while appearing to work.
 *
 * ## Gated on the permission that permits assigning
 *
 * Reading the directory is gated on `request:assign:department` or
 * `request:assign:institution` — exactly the permissions that permit an
 * assignment in the first place. The directory reveals nothing a user who could
 * not already act on could not have inferred, and it is deliberately not open to
 * students: it enumerates the staff of the institution.
 *
 * ## Narrow on purpose
 *
 * Returns id, name, role and department, and nothing else. No email addresses,
 * no phone numbers, no timestamps — a staff list is not a staff dossier, and
 * the assignment dropdown needs four fields.
 */
const User = require("../models/User");
const { ROLES } = require("../config/constants");
const { ApiError } = require("../utils/ApiError");
const { userHasPermission, P } = require("../utils/permissions");
const { logger } = require("../config/logger");

/** Roles that can be given work, as opposed to a student account. */
const STAFF_ROLES = Object.values(ROLES).filter((role) => role !== ROLES.STUDENT);

/**
 * Staff who can be assigned work.
 *
 * @param {object} params
 * @param {object} params.user The caller.
 * @param {string} [params.departmentId Restrict to one department.
 * @returns {Promise<Array<object>>}
 */
async function listAssignableStaff({ user, departmentId } = {}) {
  const mayAssign =
    userHasPermission(user, P.REQUEST_ASSIGN_INSTITUTION) ||
    userHasPermission(user, P.REQUEST_ASSIGN_DEPARTMENT);

  if (!mayAssign) {
    throw ApiError.forbidden("You do not have permission to view the staff directory");
  }

  // Only an institution-wide assigner may choose across departments. A
  // departmental assigner is pinned to their own, so the directory cannot be
  // used to learn who works elsewhere.
  const scopedToOwnDepartment = !userHasPermission(user, P.REQUEST_ASSIGN_INSTITUTION);

  const filter = {
    role: { $in: STAFF_ROLES },
    isActive: true,
  };

  if (scopedToOwnDepartment) {
    if (!user.department) {
      // Nothing to offer, and saying so beats offering the whole college.
      logger.warn({ userId: user._id }, "Departmental assigner has no department set");
      return [];
    }
    filter.department = user.department;
  } else if (departmentId) {
    filter.department = departmentId;
  }

  return User.find(filter)
    .select("fullName role department email")
    .sort({ fullName: 1 })
    .limit(200)
    .lean()
    .then((docs) =>
      docs.map((doc) => ({
        id: doc._id.toString(),
        fullName: doc.fullName,
        role: doc.role,
        department: doc.department ? doc.department.toString() : null,
        // Shown to help a dispatcher recognise someone, and only to callers who
        // can already assign them work.
        email: doc.email,
      }))
    );
}

module.exports = { listAssignableStaff, STAFF_ROLES };
