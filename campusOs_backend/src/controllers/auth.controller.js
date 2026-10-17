/**
 * Auth controller.
 *
 * Thin HTTP layer: read validated input, call the service, shape the response.
 * No business rules and no authorization decisions live here — those belong to
 * `services/auth.service.js` and `utils/permissions.js`.
 */

const authService = require("../services/auth.service");
const twoFactorService = require("../services/twoFactor.service");
const auditService = require("../services/audit.service");
const Student = require("../models/Student");
const User = require("../models/User");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { setAuthCookies, clearAuthCookies, COOKIE_NAMES } = require("../utils/cookies");
const { AUDIT_ACTION } = require("../config/constants");

/**
 * POST /api/v1/auth/login
 *
 * Sets the session cookie set and returns the user. The access and refresh
 * tokens are never included in the response body — they exist only as
 * HttpOnly cookies, so client-side JavaScript cannot read them even if the page
 * suffers an XSS.
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.validated.body;

  const result = await authService.login({ email, password, req });

  /*
   * The password was right and that is not yet a session.
   *
   * No cookies are set and no user is returned — the caller gets a challenge
   * and comes back with a code. Returning the account here would mean the whole
   * second factor was advisory.
   */
  if (result.twoFactorRequired) {
    return sendSuccess(res, {
      message: "Enter the code from your authenticator app",
      data: { twoFactorRequired: true, challenge: result.challenge },
      status: 200,
    });
  }

  const { user, accessToken, refreshToken, csrfToken, expiresAt } = result;

  setAuthCookies(res, { accessToken, refreshToken, csrfToken });

  return sendSuccess(res, {
    message: "Signed in successfully",
    data: {
      user: user.toPublicJSON(),
      // Lets the SPA schedule a refresh just before the access token expires.
      expiresAt: expiresAt.toISOString(),
    },
    status: 200,
  });
});

/**
 * POST /api/v1/auth/refresh
 *
 * Rotates the refresh token and reissues the access token. Safe to call without
 * CSRF validation because it does not rely on an ambient credential: it requires
 * the refresh cookie *and* the matching CSRF cookie, and rotates both.
 */
const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[COOKIE_NAMES.REFRESH_TOKEN];
  const csrfCookie = req.cookies?.[COOKIE_NAMES.CSRF_TOKEN];
  const csrfHeader = req.get("x-csrf-token");

  // Both must be present and agree. This is the CSRF check for this route: a
  // cross-origin attacker can cause the refresh cookie to be sent, but cannot
  // read it to populate the matching header.
  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    throw new ApiError(
      ERROR_CODE.CSRF_INVALID,
      "CSRF token missing or invalid. Refresh the page and try again."
    );
  }

  const {
    user,
    accessToken,
    refreshToken: nextRefresh,
    csrfToken,
  } = await authService.refreshSession({ refreshToken, req });

  // The refresh cookie must be rewritten with the rotated token.
  setAuthCookies(res, { accessToken, refreshToken: nextRefresh, csrfToken });

  return sendSuccess(res, {
    message: "Session refreshed",
    data: { user: user.toPublicJSON() },
  });
});

/**
 * GET /api/v1/auth/me
 *
 * Returns the signed-in identity, linked student profile and effective
 * permissions. Safe methods are exempt from CSRF by design.
 */
const me = asyncHandler(async (req, res) => {
  // A student account has a linked Student profile; fetch it for the dashboard.
  const student = req.user.student
    ? await Student.findById(req.user.student).select(
        "rollNumber semester year section program department feeStatus batchYear"
      )
    : null;

  return sendSuccess(res, {
    message: "Current session retrieved",
    data: authService.buildSessionPayload(req.user, student),
  });
});

/**
 * POST /api/v1/auth/logout
 *
 * Revokes this device's refresh token. Idempotent: signing out when already
 * signed out succeeds and clears the cookies, so a double-click is harmless.
 */
const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[COOKIE_NAMES.REFRESH_TOKEN];

  // Revoke by the refresh token itself, not by `req.user`: this route is
  // deliberately unguarded so that a user with an expired access token can
  // still sign out. Depending on req.user would skip revocation entirely and
  // leave the session usable on the server.
  const { revoked, userId } = await authService.logout(refreshToken);

  clearAuthCookies(res);

  await auditService.record({
    action: AUDIT_ACTION.LOGOUT,
    entity: "User",
    entityId: userId,
    metadata: { revoked },
    req,
  });

  return sendSuccess(res, { message: "Signed out successfully" });
});

/**
 * POST /api/v1/auth/logout-all
 *
 * Revokes every session on every device and invalidates outstanding access
 * tokens. This is the action a user takes after suspecting compromise, and it
 * is the one that must work even though other sessions may be hostile.
 */
const logoutAll = asyncHandler(async (req, res) => {
  await authService.revokeAllSessions(req.user._id.toString(), "logout-all", req);
  clearAuthCookies(res);

  return sendSuccess(res, {
    message: "Signed out from all devices",
  });
});

/**
 * POST /api/v1/auth/change-password
 *
 * Revokes all sessions afterwards, because a password change is usually a
 * response to a suspected compromise — leaving the attacker's session alive
 * would defeat the purpose.
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.validated.body;

  // Requires the hash, which `authenticate` does not select.
  const user = await User.findById(req.user._id).select("+passwordHash");

  if (!user) {
    throw ApiError.notFound("Account not found");
  }

  const matches = await user.verifyPassword(currentPassword);
  if (!matches) {
    throw ApiError.invalidCredentials("Current password is incorrect");
  }

  await user.setPassword(newPassword);
  // The point at which a provisioned account stops being a temporary one.
  // Cleared here and nowhere else: signing in must never clear it, or the
  // gate in the client would be skipped by simply refreshing.
  user.mustChangePassword = false;
  await user.save();

  await authService.revokeAllSessions(user._id.toString(), "password-change", req);
  clearAuthCookies(res);

  await auditService.record({
    action: AUDIT_ACTION.PASSWORD_CHANGE,
    entity: "User",
    entityId: user._id,
    actor: user,
    req,
  });

  return sendSuccess(res, {
    message: "Password changed. Please sign in again.",
  });
});

/** POST /api/v1/auth/2fa/complete — the second step of a two-factor sign-in. */
const completeTwoFactor = asyncHandler(async (req, res) => {
  const result = await authService.completeTwoFactor({
    challenge: req.validated.body.challenge,
    code: req.validated.body.code,
    req,
  });

  setAuthCookies(res, {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    csrfToken: result.csrfToken,
  });

  return sendSuccess(res, {
    message: "Signed in",
    data: {
      user: result.user.toPublicJSON(),
      expiresAt: result.expiresAt.toISOString(),
    },
    status: 200,
  });
});

/** POST /api/v1/auth/2fa/enrol — start, and get a secret to put in an app. */
const beginTwoFactor = asyncHandler(async (req, res) => {
  const enrolment = await twoFactorService.beginEnrolment({ user: req.user });

  return sendSuccess(res, {
    message: "Scan or type this secret into your authenticator app",
    data: enrolment,
  });
});

/** POST /api/v1/auth/2fa/confirm — enable it with a working code. */
const confirmTwoFactor = asyncHandler(async (req, res) => {
  const result = await twoFactorService.confirmEnrolment({
    user: req.user,
    code: req.validated.body.code,
  });

  return sendSuccess(res, {
    message: "Two-factor is on. Save your recovery codes now.",
    data: result,
  });
});

/** POST /api/v1/auth/2fa/disable — needs a working code, not just a session. */
const disableTwoFactor = asyncHandler(async (req, res) => {
  await twoFactorService.disable({ user: req.user, code: req.validated.body.code });

  return sendSuccess(res, { message: "Two-factor is off", data: { enabled: false } });
});

module.exports = {
  login,
  refresh,
  me,
  logout,
  logoutAll,
  changePassword,
  completeTwoFactor,
  beginTwoFactor,
  confirmTwoFactor,
  disableTwoFactor,
};
