/**
 * Authentication routes.
 *
 * ## CSRF per route
 *
 * CampusOS sets `SameSite=None` in production because the frontend (Vercel) and
 * API (Render) are different sites. Cookies are therefore sent on cross-site
 * requests, so CSRF protection is mandatory rather than optional.
 *
 *  - `login`      — no CSRF check. It authenticates rather than relying on an
 *                   ambient credential, so a forced login only signs the user
 *                   into an account the attacker does not control. The blast
 *                   radius is a nuisance (a login-CSRF), which is why login is
 *                   additionally rate-limited per IP and per account.
 *  - `refresh`    — requires a matching CSRF cookie/header pair, checked in the
 *                   controller. It rotates the refresh token, so without this a
 *                   cross-site POST would silently invalidate the victim's
 *                   session (logout-CSRF).
 *  - protected    — `authenticate` then `csrfProtection`, which binds the token
 *                   to the caller's identity and session.
 */

const express = require("express");

const authController = require("../controllers/auth.controller");
const { validate } = require("../middleware/validate");
const { authenticate, attachPermissionHelpers } = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const {
  loginLimiter,
  loginPerAccountLimiter,
  refreshLimiter,
} = require("../middleware/rateLimit");
const {
  loginSchema,
  refreshSchema,
  logoutSchema,
  logoutAllSchema,
  changePasswordSchema,
} = require("../validators/auth.validator");

const router = express.Router();

// ===== Public =====

/** POST /api/v1/auth/login — exchange credentials for session cookies. */
router.post(
  "/login",
  loginLimiter,
  loginPerAccountLimiter,
  validate({ body: loginSchema }),
  authController.login
);

/** POST /api/v1/auth/refresh — rotate the refresh token, reissue access token. */
router.post(
  "/refresh",
  refreshLimiter,
  validate({ body: refreshSchema }),
  authController.refresh
);

// ===== Authenticated =====

/** GET /api/v1/auth/me — current identity, student profile and permissions. */
router.get("/me", authenticate, attachPermissionHelpers, authController.me);

/**
 * POST /api/v1/auth/logout — revoke this device's session.
 * Left unguarded by `authenticate` so signing out always succeeds and always
 * clears cookies, even when the access token has already expired.
 */
router.post("/logout", validate({ body: logoutSchema }), authController.logout);

/** POST /api/v1/auth/logout-all — revoke every session on every device. */
router.post(
  "/logout-all",
  authenticate,
  csrfProtection,
  validate({ body: logoutAllSchema }),
  authController.logoutAll
);

/** POST /api/v1/auth/change-password — rotates all sessions on success. */
router.post(
  "/change-password",
  authenticate,
  csrfProtection,
  validate({ body: changePasswordSchema }),
  authController.changePassword
);

module.exports = router;
