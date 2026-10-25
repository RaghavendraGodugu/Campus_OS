const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const brandingService = require("../services/branding.service");

/** GET /api/v1/branding — public read (for CSS injection). */
const get = asyncHandler(async (req, res) => {
  const branding = await brandingService.getBranding();
  return sendSuccess(res, {
    message: "Branding retrieved",
    data: { branding },
  });
});

/** GET /api/v1/branding/variables — CSS variable overrides for runtime injection. */
const getVariables = asyncHandler(async (req, res) => {
  const variables = await brandingService.getResolvedVariables();
  return sendSuccess(res, {
    message: "Branding variables",
    data: { variables },
  });
});

/** GET /api/v1/branding/palettes — list available palettes. */
const listPalettes = asyncHandler(async (req, res) => {
  const palettes = brandingService.listPalettes();
  return sendSuccess(res, {
    message: "Available palettes",
    data: { palettes },
  });
});

/** PATCH /api/v1/branding — update branding (SUPER_ADMIN only). */
const update = asyncHandler(async (req, res) => {
  const branding = await brandingService.updateBranding({
    user: req.user,
    payload: req.validated.body,
  });
  return sendSuccess(res, {
    message: "Branding updated",
    data: { branding },
  });
});

/** POST /api/v1/branding/toggle — enable/disable branding (SUPER_ADMIN only). */
const toggle = asyncHandler(async (req, res) => {
  const branding = await brandingService.toggleBranding({
    user: req.user,
    isActive: req.validated.body.isActive,
  });
  return sendSuccess(res, {
    message: branding.isActive ? "Branding enabled" : "Branding disabled",
    data: { branding },
  });
});

/** POST /api/v1/branding/preview — preview variables without saving. */
const preview = asyncHandler(async (req, res) => {
  // Just return the variables for preview - the frontend applies them to :root
  return sendSuccess(res, {
    message: "Preview variables ready",
    data: { variables: req.body },
  });
});

module.exports = { get, getVariables, listPalettes, update, toggle, preview };
