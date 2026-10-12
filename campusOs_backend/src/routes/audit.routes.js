/**
 * Audit trail routes.
 *
 * Read-only. There is deliberately no POST, PUT or DELETE: entries are written
 * by the workflows they describe, and a correction is a new entry rather than an
 * edit.
 */

const express = require("express");

const auditController = require("../controllers/audit.controller");
const { validate } = require("../middleware/validate");
const { authenticate, requireAnyPermission } = require("../middleware/auth");
const { P } = require("../utils/permissions");
const {
  auditQuerySchema,
  deniedQuerySchema,
  trailSchema,
} = require("../validators/report.validator");

const router = express.Router();

const mayReadAudit = requireAnyPermission(
  P.AUDIT_READ_INSTITUTION,
  P.AUDIT_READ_DEPARTMENT
);

/** GET /api/v1/audit/denied — declared before the general query. */
router.get(
  "/audit/denied",
  authenticate,
  requireAnyPermission(P.AUDIT_READ_INSTITUTION),
  validate({ query: deniedQuerySchema }),
  auditController.denied
);

/** GET /api/v1/audit/trail — the history of one resource. */
router.get(
  "/audit/trail",
  authenticate,
  mayReadAudit,
  validate({ query: trailSchema }),
  auditController.trail
);

/** GET /api/v1/audit */
router.get(
  "/audit",
  authenticate,
  mayReadAudit,
  validate({ query: auditQuerySchema }),
  auditController.query
);

module.exports = router;
