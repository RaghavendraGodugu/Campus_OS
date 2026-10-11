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
const requestRoutes = require("./request.routes");

const router = express.Router();

// ===== Health (unversioned, unauthenticated) =====
router.get("/health", healthController.health);
router.get("/health/live", healthController.live);
router.get("/health/ready", healthController.ready);

// ===== Versioned API =====
// Each feature router is mounted under its own path segment, so the version
// prefix and the domain stay separable and new modules slot in predictably.
// auth.routes defines "/login", so mounting at "/api/v1/auth" yields
// POST /api/v1/auth/login.
router.use("/api/v1/auth", authRoutes);
router.use("/api/v1", requestRoutes);

module.exports = router;
