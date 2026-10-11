/**
 * Route table.
 *
 * Every feature router is mounted here under the versioned `/api/v1` prefix
 * (spec §7). The health routes are mounted outside that prefix so platform
 * probes use a stable URL that does not change between API versions.
 */

const express = require("express");

const healthController = require("../controllers/health.controller");
const authRoutes = require("./auth.routes");

const router = express.Router();

// ===== Health (unversioned, unauthenticated) =====
router.get("/health", healthController.health);
router.get("/health/live", healthController.live);
router.get("/health/ready", healthController.ready);

// ===== Versioned API =====
router.use("/api/v1", authRoutes);

module.exports = router;
