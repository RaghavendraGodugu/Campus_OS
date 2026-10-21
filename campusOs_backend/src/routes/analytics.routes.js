const express = require("express");

const { authenticate, requireAnyPermission } = require("../middleware/auth");
const controller = require("../controllers/campusAnalytics.controller");
const { READ_PERMISSIONS } = require("../services/campusAnalytics.service");

const router = express.Router();

/**
 * Campus analytics.
 *
 * The route is reachable by anyone who can read one campus domain; the service
 * then returns only the sections they may read. This is deliberately not gated
 * on a generic "analytics" permission: a warden should see their occupancy
 * without being given institution-wide reporting rights.
 */
router.get(
  "/analytics/campus",
  authenticate,
  requireAnyPermission(...READ_PERMISSIONS),
  controller.campus
);

module.exports = router;
