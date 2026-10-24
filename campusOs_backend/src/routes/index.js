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
const complaintRoutes = require("./complaint.routes");
const certificateRoutes = require("./certificate.routes");
const financeRoutes = require("./finance.routes");
const notificationRoutes = require("./notification.routes");
const announcementRoutes = require("./announcement.routes");
const reportRoutes = require("./report.routes");
const academicTermRoutes = require("./academicTerm.routes");
const directoryRoutes = require("./directory.routes");
const documentRoutes = require("./document.routes");
const profileRoutes = require("./profile.routes");
const adminRoutes = require("./admin.routes");
const auditRoutes = require("./audit.routes");
const academicRoutes = require("./academic.routes");
const attendanceRoutes = require("./attendance.routes");
const resultRoutes = require("./result.routes");
const hostelRoutes = require("./hostel.routes");
const libraryRoutes = require("./library.routes");
const placementRoutes = require("./placement.routes");
const eventRoutes = require("./event.routes");
const analyticsRoutes = require("./analytics.routes");

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
router.use("/api/v1", complaintRoutes);
router.use("/api/v1", certificateRoutes);
router.use("/api/v1", financeRoutes);
router.use("/api/v1", notificationRoutes);
router.use("/api/v1", announcementRoutes);
router.use("/api/v1", reportRoutes);
router.use("/api/v1", academicTermRoutes);
router.use("/api/v1", directoryRoutes);
router.use("/api/v1", documentRoutes);
router.use("/api/v1", profileRoutes);
router.use("/api/v1", adminRoutes);
router.use("/api/v1", auditRoutes);
router.use("/api/v1", academicRoutes);
router.use("/api/v1", attendanceRoutes);
router.use("/api/v1", resultRoutes);
router.use("/api/v1", hostelRoutes);
router.use("/api/v1", libraryRoutes);
router.use("/api/v1", placementRoutes);
router.use("/api/v1", eventRoutes);
router.use("/api/v1", analyticsRoutes);

module.exports = router;
