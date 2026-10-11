/**
 * Auth controller.
 *
 * Thin HTTP layer: read validated input, call the service, shape the response.
 * No business rules and no authorization decisions live here — those belong to
 * `services/auth.service.js` and `utils/permissions.js`.
 */

const authService = require("../services/auth.service");
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

  const { user, accessToken, refreshToken, csrfToken, expiresAt } =
    await authService.login({ email, password, req });

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

  if (req.user && refreshToken) {
    await authService.logout(req.user._id.toString(), refreshToken);
  }

  clearAuthCookies(res);

  await auditService.record({
    action: AUDIT_ACTION.LOGOUT,
    entity: "User",
    entityId: req.user?._id ?? null,
    actor: req.user ?? null,
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

module.exports = { login, refresh, me, logout, logoutAll, changePassword };
