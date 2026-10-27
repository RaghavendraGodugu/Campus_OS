const express = require("express");
const { authenticate, requirePermission } = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { validate } = require("../middleware/validate");
const { P } = require("../utils/permissions");
const controller = require("../controllers/event.controller");
const {
  idParam,
  createEventSchema,
  updateEventSchema,
} = require("../validators/event.validator");

const router = express.Router();

router.get(
  "/events",
  authenticate,
  requirePermission(P.EVENT_READ),
  controller.listEvents
);

router.post(
  "/events",
  authenticate,
  csrfProtection,
  requirePermission(P.EVENT_MANAGE),
  validate({ body: createEventSchema }),
  controller.createEvent
);

router.patch(
  "/events/:id",
  authenticate,
  csrfProtection,
  requirePermission(P.EVENT_MANAGE),
  validate({ params: idParam, body: updateEventSchema }),
  controller.updateEvent
);

router.post(
  "/events/:id/rsvp",
  authenticate,
  csrfProtection,
  requirePermission(P.EVENT_READ),
  validate({ params: idParam }),
  controller.rsvp
);

router.delete(
  "/events/:id/rsvp",
  authenticate,
  csrfProtection,
  requirePermission(P.EVENT_READ),
  validate({ params: idParam }),
  controller.withdraw
);

module.exports = router;
