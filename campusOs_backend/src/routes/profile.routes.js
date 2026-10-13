/**
 * Profile routes.
 *
 * Mounted under /profile rather than /auth so the distinction is obvious:
 * /auth is about proving who you are, /profile is about what the institution
 * knows about you.
 *
 * Every route requires a session and derives the subject from it. No route takes
 * a user id, so there is no parameter through which one person's profile could
 * be read or changed in place of another's.
 */

const express = require("express");

const profileController = require("../controllers/profile.controller");
const authController = require("../controllers/auth.controller");
const { validate } = require("../middleware/validate");
const { authenticate } = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const {
  updateProfileSchema,
  changePasswordSchema,
} = require("../validators/profile.validator");

const router = express.Router();

/** GET /api/v1/profile */
router.get("/profile", authenticate, profileController.getProfile);

/** PATCH /api/v1/profile — fullName and phone only; anything else is refused. */
router.patch(
  "/profile",
  authenticate,
  csrfProtection,
  validate({ body: updateProfileSchema }),
  profileController.updateProfile
);

/**
 * POST /api/v1/profile/change-password
 *
 * Routed here rather than only under /auth so the profile page is the one place
 * a person goes to look after their password.
 */
router.post(
  "/profile/change-password",
  authenticate,
  csrfProtection,
  validate({ body: changePasswordSchema }),
  authController.changePassword
);

/** POST /api/v1/profile/sign-out-everywhere */
router.post(
  "/profile/sign-out-everywhere",
  authenticate,
  csrfProtection,
  profileController.signOutEverywhere
);

module.exports = router;
