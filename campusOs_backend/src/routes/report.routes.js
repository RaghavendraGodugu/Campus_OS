/**
 * Report routes.
 *
 * Every route requires a report permission, but the permission is only the first
 * gate: which sections of a report a caller receives is decided per section by
 * the service, so holding `REPORT_READ_DEPARTMENT` narrows the report rather
 * than merely unlocking it.
 */

const express = require("express");

const reportController = require("../controllers/report.controller");
const { validate } = require("../middleware/validate");
const { authenticate, requireAnyPermission } = require("../middleware/auth");
const { P } = require("../utils/permissions");
const {
  overviewSchema,
  scopedReportSchema,
  institutionReportSchema,
} = require("../validators/report.validator");

const router = express.Router();

const mayReadReports = requireAnyPermission(
  P.REPORT_READ_INSTITUTION,
  P.REPORT_READ_DEPARTMENT
);

/** GET /api/v1/reports/overview — sections limited to the caller's scope. */
router.get(
  "/reports/overview",
  authenticate,
  mayReadReports,
  validate({ query: overviewSchema }),
  reportController.overview
);

/** GET /api/v1/reports/requests */
router.get(
  "/reports/requests",
  authenticate,
  mayReadReports,
  validate({ query: scopedReportSchema }),
  reportController.requests
);

/** GET /api/v1/reports/students */
router.get(
  "/reports/students",
  authenticate,
  mayReadReports,
  validate({ query: scopedReportSchema }),
  reportController.students
);

/**
 * GET /api/v1/reports/complaints
 *
 * Gated on institution-wide report access. A grievance has no departmental
 * dimension, so there is nothing to narrow it to — the honest answer for a
 * department-scoped caller is 403 rather than a partial figure.
 */
router.get(
  "/reports/complaints",
  authenticate,
  requireAnyPermission(P.REPORT_READ_INSTITUTION),
  validate({ query: institutionReportSchema }),
  reportController.complaints
);

/** GET /api/v1/reports/finance — institution scope only. */
router.get(
  "/reports/finance",
  authenticate,
  requireAnyPermission(P.REPORT_READ_INSTITUTION),
  validate({ query: institutionReportSchema }),
  reportController.finance
);

module.exports = router;
