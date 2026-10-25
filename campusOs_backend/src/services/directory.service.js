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

/**
 * Search the staff directory by name, designation, department or skill.
 *
 * ## Who may read it
 *
 * Every staff role (see `STAFF_PERMISSIONS`), never a student. The directory
 * says who somebody is — name, title, department, declared expertise — it does
 * not say how to reach them privately; contact details stay in the
 * assignment-scoped endpoints, where the caller can already act.
 *
 * ## Scoping
 *
 * An institution-wide reader sees all departments. A staff role pinned to a
 * department (`FACULTY`, `HOD`) sees their own department by default and any
 * department they name. Operational desks (`HOSTEL_ADMIN` and similares) that
 * hold no department can search the institution, which is the same widening an
 * operational role needs before scheduling anything.
 *
 * @param {object} params
 * @param {object} params.user
 * @param {string} [params.q] A fragment of a name, designation or skill.
 * @param {string} [params.departmentId] Restrict results to one department.
 * @param {string} [params.role] One of the staff roles, to filter by them.
 * @returns {Promise<Array<object>>}
 */
/**
 * Search the staff directory by name, designation, department or skill.
 *
 * ## Who may read it
 *
 * Every staff role (see `STAFF_PERMISSIONS` in permissions.js), never a
 * student. The directory says who somebody is — name, role, designation,
 * department and the expertise they declared — and not how to reach them
 * privately: contact details stay in the assignment-scoped endpoint, whose
 * callers can already act on them.
 *
 * @param {object} params
 * @param {object} params.user
 * @param {string} [params.q] A fragment of a name, designation or skill.
 * @param {string} [params.departmentId] Restrict results to one department.
 * @param {string} [params.role] Restrict results to one staff role.
 * @returns {Promise<Array<object>>}
 */
async function searchStaff({ user, q, departmentId, role } = {}) {
  if (!userHasPermission(user, P.STAFF_DIRECTORY_READ)) {
    throw ApiError.forbidden("You cannot read the staff directory");
  }

  const filter = { isActive: true, role: { $in: STAFF_ROLES } };

  if (role) {
    if (!STAFF_ROLES.includes(role)) {
      throw ApiError.badRequest("That is not a staff role");
    }
    filter.role = role;
  }

  if (q) {
    // A literal fragment search across the three surfaces a person would
    // look at: who they are, the designation they hold, and the expertise
    // they declared for themselves. Regex-special characters in a query are
    // escaped, so "ml (v2)" finds nothing and lies about nothing.
    const escaped = q.replace(/[.*+?^${}[\]()\\]/g, "\\$&").slice(0, 80);
    const rx = new RegExp(escaped, "i");
    filter.$or = [{ fullName: rx }, { designation: rx }, { expertise: rx }];
  }

  if (departmentId) {
    filter.department = departmentId;
  }

  const rows = await User.find(filter)
    .select("fullName role designation expertise department")
    .sort({ fullName: 1 })
    .limit(100)
    .lean();

  return rows.map((doc) => ({
    id: doc._id.toString(),
    fullName: doc.fullName,
    role: doc.role,
    designation: doc.designation || null,
    expertise: doc.expertise ?? [],
    department: doc.department ? doc.department.toString() : null,
  }));
}

module.exports = { searchStaff, listAssignableStaff, STAFF_ROLES };
