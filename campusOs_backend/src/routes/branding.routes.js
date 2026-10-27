const express = require("express");

const controller = require("../controllers/branding.controller");
const { validate } = require("../middleware/validate");
const { authenticate, requirePermission } = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { P } = require("../utils/permissions");
const {
  updateBrandingSchema,
  toggleBrandingSchema,
} = require("../validators/branding.validator");

const router = express.Router();

/**
 * Branding endpoints.
 *
 * Reading is public (no authentication) so the CSS variables can be injected
 * before first paint. Writing requires SUPER_ADMIN.
 */

/** GET /api/v1/branding — public. */
router.get("/branding", controller.get);

/** GET /api/v1/branding/variables — public CSS variable overrides. */
router.get("/branding/variables", controller.getVariables);

/** GET /api/v1/branding/palettes — public palette list. */
router.get("/branding/palettes", controller.listPalettes);

/** PATCH /api/v1/branding — update branding (SUPER_ADMIN). */
router.patch(
  "/branding",
  authenticate,
  csrfProtection,
  requirePermission(P.SUPER_ADMIN),
  validate({ body: updateBrandingSchema }),
  controller.update
);

/** POST /api/v1/branding/toggle — enable/disable branding (SUPER_ADMIN). */
router.post(
  "/branding/toggle",
  authenticate,
  csrfProtection,
  requirePermission(P.SUPER_ADMIN),
  validate({ body: toggleBrandingSchema }),
  controller.toggle
);

/** POST /api/v1/branding/preview — preview variables without saving (SUPER_ADMIN). */
router.post(
  "/branding/preview",
  authenticate,
  csrfProtection,
  requirePermission(P.SUPER_ADMIN),
  controller.preview
);

module.exports = router;
