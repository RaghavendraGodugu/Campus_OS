/**
 * Complaint routes.
 *
 * Note the deliberate absence of a route-level permission gate on
 * `/complaints/:id/transition`: which actions are available depends on both the
 * current status and the caller, and both are enforced by the complaint
 * workflow table plus the visibility re-check inside the service. A blanket
 * gate could not express "resolve, but only from INVESTIGATING".
 */

const express = require("express");

const complaintController = require("../controllers/complaint.controller");
const { validate } = require("../middleware/validate");
const {
  authenticate,
  requirePermission,
  requireStudentAccount,
} = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { P } = require("../utils/permissions");
const {
  createComplaintSchema,
  listComplaintsSchema,
  getComplaintSchema,
  transitionSchema,
  updateSchema,
  internalNoteSchema,
  feedbackSchema,
} = require("../validators/complaint.validator");

const router = express.Router();

/** GET /api/v1/complaints/sla-policy — read before the `:id` wildcard. */
router.get("/complaints/sla-policy", authenticate, complaintController.getSlaPolicy);

/** GET /api/v1/complaints — scope- and confidentiality-filtered. */
router.get(
  "/complaints",
  authenticate,
  validate({ query: listComplaintsSchema }),
  complaintController.listComplaints
);

/** POST /api/v1/complaints — students only. */
router.post(
  "/complaints",
  authenticate,
  csrfProtection,
  requirePermission(P.COMPLAINT_CREATE),
  requireStudentAccount,
  validate({ body: createComplaintSchema }),
  complaintController.fileComplaint
);

/** GET /api/v1/complaints/:id */
router.get(
  "/complaints/:id",
  authenticate,
  validate({ params: getComplaintSchema }),
  complaintController.getComplaint
);

/** POST /api/v1/complaints/:id/transition */
router.post(
  "/complaints/:id/transition",
  authenticate,
  csrfProtection,
  validate({ params: getComplaintSchema, body: transitionSchema }),
  complaintController.transitionComplaint
);

/** POST /api/v1/complaints/:id/updates — visible to the complainant. */
router.post(
  "/complaints/:id/updates",
  authenticate,
  csrfProtection,
  validate({ params: getComplaintSchema, body: updateSchema }),
  complaintController.addUpdate
);

/**
 * POST /api/v1/complaints/:id/internal-notes
 * Staff only. A student holding the complaint cannot annotate it internally.
 */
router.post(
  "/complaints/:id/internal-notes",
  authenticate,
  csrfProtection,
  requirePermission(P.COMPLAINT_UPDATE_ASSIGNED),
  validate({ params: getComplaintSchema, body: internalNoteSchema }),
  complaintController.addInternalNote
);

/** POST /api/v1/complaints/:id/feedback — complainant only, once. */
router.post(
  "/complaints/:id/feedback",
  authenticate,
  csrfProtection,
  requirePermission(P.COMPLAINT_FEEDBACK_OWN),
  validate({ params: getComplaintSchema, body: feedbackSchema }),
  complaintController.submitFeedback
);

module.exports = router;
