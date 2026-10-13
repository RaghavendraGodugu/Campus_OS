/**
 * Staff directory routes.
 *
 * Read-only, and narrow: the assignment dropdown is the only consumer, so it
 * exposes only what that dropdown needs.
 */

const express = require("express");

const directoryController = require("../controllers/directory.controller");
const { validate } = require("../middleware/validate");
const { authenticate, requireAnyPermission } = require("../middleware/auth");
const { P } = require("../utils/permissions");
const { listStaffSchema } = require("../validators/directory.validator");

const router = express.Router();

/**
 * GET /api/v1/users/staff
 *
 * Gated on the assign permissions, which is also who may appear in the list:
 * a departmental assigner sees only their own department, an institution-wide
 * assigner sees everyone.
 */
router.get(
  "/users/staff",
  authenticate,
  requireAnyPermission(P.REQUEST_ASSIGN_INSTITUTION, P.REQUEST_ASSIGN_DEPARTMENT),
  validate({ query: listStaffSchema }),
  directoryController.listStaff
);

module.exports = router;
