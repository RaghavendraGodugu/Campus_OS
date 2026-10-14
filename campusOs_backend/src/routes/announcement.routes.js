/**
 * Announcement routes.
 *
 * Posting is gated on ANNOUNCEMENT_MANAGE, which is held only by the roles the
 * institution would trust to speak for it. Reading is open to every role but is
 * filtered by audience in the service, so "every role may read" does not become
 * "every role may read everything".
 */

const express = require("express");

const announcementController = require("../controllers/announcement.controller");
const { validate } = require("../middleware/validate");
const { authenticate, requirePermission } = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { parseSingleFile, requireFile } = require("../middleware/upload");
const { P } = require("../utils/permissions");
const {
  createAnnouncementSchema,
  archiveAnnouncementSchema,
  pinAnnouncementSchema,
  listAnnouncementsSchema,
  announcementIdentifier,
} = require("../validators/announcement.validator");

const router = express.Router();

/** POST /api/v1/announcements — officers only. */
router.post(
  "/announcements",
  authenticate,
  csrfProtection,
  requirePermission(P.ANNOUNCEMENT_MANAGE),
  validate({ body: createAnnouncementSchema }),
  announcementController.createAnnouncement
);

/** GET /api/v1/announcements — filtered to the caller's audience. */
router.get(
  "/announcements",
  authenticate,
  validate({ query: listAnnouncementsSchema }),
  announcementController.listAnnouncements
);

/**
 * POST /api/v1/announcements/:id/image
 *
 * Officers only, and declared before `/:id` for the same reason as the
 * attachment route below: so the literal segment is never captured as an id.
 */
router.post(
  "/announcements/:id/image",
  authenticate,
  csrfProtection,
  parseSingleFile("image"),
  requireFile,
  requirePermission(P.ANNOUNCEMENT_MANAGE),
  validate({ params: announcementIdentifier }),
  announcementController.uploadImage
);

/** DELETE /api/v1/announcements/:id/image */
router.delete(
  "/announcements/:id/image",
  authenticate,
  csrfProtection,
  requirePermission(P.ANNOUNCEMENT_MANAGE),
  validate({ params: announcementIdentifier }),
  announcementController.deleteImage
);

/**
 * GET /api/v1/announcements/:id/attachment
 *
 * Declared before `/:id` so the attachment path is never parsed as a reference.
 * Authorised by the same audience rule as the announcement itself.
 */
router.get(
  "/announcements/:id/attachment",
  authenticate,
  validate({ params: announcementIdentifier }),
  announcementController.downloadAttachment
);

/** GET /api/v1/announcements/:id — 404 outside the audience. */
router.get(
  "/announcements/:id",
  authenticate,
  validate({ params: announcementIdentifier }),
  announcementController.getAnnouncement
);

/** POST /api/v1/announcements/:id/archive */
router.post(
  "/announcements/:id/archive",
  authenticate,
  csrfProtection,
  requirePermission(P.ANNOUNCEMENT_MANAGE),
  validate({ params: announcementIdentifier, body: archiveAnnouncementSchema }),
  announcementController.archiveAnnouncement
);

/** POST /api/v1/announcements/:id/pin */
router.post(
  "/announcements/:id/pin",
  authenticate,
  csrfProtection,
  requirePermission(P.ANNOUNCEMENT_MANAGE),
  validate({ params: announcementIdentifier, body: pinAnnouncementSchema }),
  announcementController.pinAnnouncement
);

module.exports = router;
