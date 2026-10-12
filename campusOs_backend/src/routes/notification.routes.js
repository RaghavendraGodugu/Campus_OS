/**
 * Notification routes — the read side.
 *
 * The backend has been writing notifications since the request workflow landed;
 * until now there was no way to read them, so a user's bell could never clear.
 *
 * Scoping is the whole of the security surface here. Every route derives the
 * recipient from the session, never from the request, so there is no id in a
 * URL that could name someone else's inbox. `markRead` matches on both `_id` and
 * `user`, which is what makes "mark someone else's notification read" a no-op
 * rather than a write.
 */

const express = require("express");

const notificationController = require("../controllers/notification.controller");
const { validate } = require("../middleware/validate");
const { authenticate } = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const {
  listNotificationsSchema,
  notificationParamsSchema,
} = require("../validators/notification.validator");

const router = express.Router();

/**
 * GET /api/v1/notifications/unread-count
 *
 * Declared before `/:id` so the literal path is never read as an id. This is
 * the call every dashboard makes on load, so it is a cheap indexed count.
 */
router.get(
  "/notifications/unread-count",
  authenticate,
  notificationController.unreadCount
);

/** GET /api/v1/notifications — the caller's own, newest first. */
router.get(
  "/notifications",
  authenticate,
  validate({ query: listNotificationsSchema }),
  notificationController.listNotifications
);

/** POST /api/v1/notifications/read-all */
router.post(
  "/notifications/read-all",
  authenticate,
  csrfProtection,
  notificationController.markAllRead
);

/**
 * POST /api/v1/notifications/:id/read
 *
 * Scoped to the caller in the service; another user's id changes nothing.
 */
router.post(
  "/notifications/:id/read",
  authenticate,
  csrfProtection,
  validate({ params: notificationParamsSchema }),
  notificationController.markRead
);

module.exports = router;
