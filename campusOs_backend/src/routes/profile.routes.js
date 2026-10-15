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
const { parseSingleFile, requireFile } = require("../middleware/upload");
const { authenticate } = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const {
  updateProfileSchema,
  changePasswordSchema,
  avatarIdentifier,
  notificationPreferencesSchema,
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
/**
 * PATCH /api/v1/profile/notification-preferences
 *
 * Separate from the profile schema on purpose. That schema takes exactly two
 * fields and its strictness is the feature — a person cannot change their own
 * programme or role. Adding a third, nested, differently-shaped patch to it
 * would weaken the guarantee it exists to provide.
 */
router.patch(
  "/profile/notification-preferences",
  authenticate,
  csrfProtection,
  validate({ body: notificationPreferencesSchema }),
  profileController.updateNotificationPreferences
);

/**
 * Profile picture.
 *
 * Declared before `/:id`-style paths would ever matter, and deliberately
 * separate from the JSON profile endpoint: an <img> cannot send a custom header
 * or a JSON body, so the picture is served as bytes through its own route.
 */
router.post(
  "/profile/avatar",
  authenticate,
  csrfProtection,
  parseSingleFile("avatar"),
  requireFile,
  profileController.uploadAvatar
);

router.delete("/profile/avatar", authenticate, csrfProtection, profileController.removeAvatar);

/** GET /profile/avatar/:userId — the bytes, for an <img> tag. */
router.get(
  "/profile/avatar/:userId",
  authenticate,
  validate({ params: avatarIdentifier }),
  profileController.readAvatar
);

router.post(
  "/profile/change-password",
  authenticate,
  csrfProtection,
  validate({ body: changePasswordSchema }),
  authController.changePassword
);


router.post(
  "/profile/sign-out-everywhere",
  authenticate,
  csrfProtection,
  profileController.signOutEverywhere
);

module.exports = router;
