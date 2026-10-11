/**
 * Authentication and authorisation middleware.
 *
 * ## Why the user is re-read on every request
 *
 * `authenticate` loads the account from MongoDB rather than trusting the role
 * embedded in the access token. That costs one indexed lookup, and buys two
 * things that matter more:
 *
 *  1. A role change or account deactivation takes effect immediately instead of
 *     lingering until the token's 15-minute expiry.
 *  2. A deleted or suspended account cannot keep working with a still-valid
 *     token.
 *
 * Permissions are then derived from the stored role by utils/permissions.js.
 * Nothing in the request — headers, body, query — can influence the decision.
 */

const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { asyncHandler } = require("../utils/asyncHandler");
const { verifyAccessToken } = require("../utils/tokens");
const { COOKIE_NAMES } = require("../utils/cookies");
const {
  userHasPermission,
  userHasAllPermissions,
  describePermissions,
  isDepartmentScoped,
} = require("../utils/permissions");
const { STAFF_ROLES } = require("../config/constants");
const User = require("../models/User");

/**
 * Attach `req.user` when a valid access cookie is present.
 *
 * Rejects with 401 when: no cookie, an invalid/expired/tampered token, a token
 * of the wrong type, or a token whose account no longer exists or is inactive.
 * The message is identical in every case so the response cannot be used to
 * probe which accounts exist.
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAMES.ACCESS_TOKEN];

  if (!token) {
    throw ApiError.unauthenticated("Authentication required");
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    // Expired, malformed, wrong type or wrong signature — indistinguishable
    // to the client on purpose.
    throw ApiError.unauthenticated("Your session is invalid or has expired");
  }

  // Re-read the account. `.select("+passwordHash")` is NOT used: middleware
  // never needs the hash, and omitting it keeps credentials out of memory.
  const user = await User.findById(payload.sub).select("-passwordHash");

  if (!user) {
    throw ApiError.unauthenticated("Your session is invalid or has expired");
  }

  if (!user.isActive) {
    throw ApiError.forbidden("This account has been deactivated");
  }

  // A forced global logout (password change, admin revocation) invalidates
  // every access token, including unexpired ones.
  if (
    user.sessionsInvalidatedAt &&
    new Date(payload.iat * 1000) < user.sessionsInvalidatedAt
  ) {
    throw ApiError.unauthenticated("Your session is invalid or has expired");
  }

  req.user = user;
  // Expose the session id from the verified token so CSRF validation can bind
  // its token to this session without re-verifying or re-querying.
  req.sessionId = payload.sid;
  next();
});

/**
 * Gate a route on the caller holding a permission.
 *
 * This checks *capability* only. Resource-level questions — "is this student
 * yours?", "is this request in your department?", "is this complaint
 * confidential?" — belong in the service layer, where the Mongo query can be
 * filtered. Middleware cannot answer them, and treating it as if it could is
 * how IDOR holes are introduced.
 *
 * @param {...string} permissions At least one is required; ALL are required.
 *
 * @example
 *   router.post("/requests/:id/approve", authenticate, requirePermission(P.REQUEST_APPROVE_DEPARTMENT), approve);
 */
function requirePermission(...permissions) {
  if (permissions.length === 0) {
    throw new Error(
      "requirePermission() needs at least one permission. Omitting it would allow every request."
    );
  }

  return function permissionGate(req, res, next) {
    if (!req.user) {
      return next(ApiError.unauthenticated("Authentication required"));
    }

    const missing = permissions.filter(
      (permission) => !userHasPermission(req.user, permission)
    );

    if (missing.length > 0) {
      // Record the denial so a suspected privilege-escalation attempt leaves a
      // trail. Logged, and written to the audit log by the caller when the
      // resource is known.
      req.permissionDenied = { required: permissions, missing, role: req.user.role };
      return next(
        ApiError.forbidden("You do not have permission to perform this action")
      );
    }

    return next();
  };
}

/**
 * Gate a route on the caller's role.
 *
 * Provided for cases where a capability genuinely maps to one role and the
 * role list reads more clearly than the permission string. Prefer
 * `requirePermission` elsewhere so that granting access later means editing the
 * matrix rather than hunting through route files.
 *
 * @param {...string} roles
 */
function requireRole(...roles) {
  if (roles.length === 0) {
    throw new Error(
      "requireRole() needs at least one role. Omitting it would allow every request."
    );
  }

  return function roleGate(req, res, next) {
    if (!req.user) {
      return next(ApiError.unauthenticated("Authentication required"));
    }
    if (!roles.includes(req.user.role)) {
      req.permissionDenied = { requiredRoles: roles, role: req.user.role };
      return next(
        ApiError.forbidden("You do not have permission to perform this action")
      );
    }
    return next();
  };
}

/**
 * Require all listed permissions (convenience wrapper with clearer intent at
 * call sites than `requirePermission(a, b, c)`).
 */
const requireAllPermissions = (...permissions) => requirePermission(...permissions);

/**
 * Attach an optional authenticated user without rejecting anonymous requests.
 *
 * Used by endpoints whose response varies for signed-in users (a public
 * announcement list showing a "read" marker, for example). It must not be used
 * on anything that grants data by role.
 */
const optionalAuthenticate = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAMES.ACCESS_TOKEN];
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).select("-passwordHash");
    if (user?.isActive) {
      req.user = user;
    }
  } catch {
    // An invalid token on an optional route is simply an anonymous request.
  }
  return next();
});

/**
 * Permission helpers exposed on `req` for controllers.
 *
 * Kept here so controllers never import the permission module directly —
 * one place to change when the model evolves.
 */
function attachPermissionHelpers(req, res, next) {
  req.can = (permission) => userHasPermission(req.user, permission);
  req.canAll = (permissions) => userHasAllPermissions(req.user, permissions);

  /**
   * True when the caller must be filtered to their own department.
   *
   * A service that reaches a list query without checking this risks returning
   * every student's record to a faculty member.
   */
  req.isDepartmentScoped = () => isDepartmentScoped(req.user?.role);

  /** Serialisable description for the `/auth/me` payload. */
  req.describeOwnPermissions = () => describePermissions(req.user.role);

  next();
}

/**
 * Require a Student-linked account on student-only routes.
 *
 * A staff account must not be able to submit a request "as" a student, so this
 * rejects any authenticated user without a linked Student profile.
 */
const requireStudentAccount = asyncHandler(async (req, res, next) => {
  if (!req.user) {
    throw ApiError.unauthenticated("Authentication required");
  }
  if (!req.user.student) {
    throw ApiError.forbidden("This action is only available to student accounts");
  }
  next();
});

/** Require a staff account (any role except STUDENT). */
const requireStaff = asyncHandler(async (req, res, next) => {
  if (!req.user) {
    throw ApiError.unauthenticated("Authentication required");
  }
  if (!STAFF_ROLES.includes(req.user.role)) {
    throw ApiError.forbidden("This action is only available to staff accounts");
  }
  next();
});

module.exports = {
  authenticate,
  optionalAuthenticate,
  requirePermission,
  requireAllPermissions,
  requireRole,
  requireStudentAccount,
  requireStaff,
  attachPermissionHelpers,
  ERROR_CODE,
};
