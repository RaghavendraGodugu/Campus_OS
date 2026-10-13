/**
 * Profile controller.
 */

const profileService = require("../services/profile.service");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");

/** GET /api/v1/profile */
const getProfile = asyncHandler(async (req, res) => {
  const profile = await profileService.getProfile({ user: req.user });

  return sendSuccess(res, {
    message: "Profile retrieved successfully",
    data: profile,
  });
});

/** PATCH /api/v1/profile — fullName and phone only. */
const updateProfile = asyncHandler(async (req, res) => {
  const profile = await profileService.updateProfile({
    user: req.user,
    changes: req.validated.body,
    req,
  });

  return sendSuccess(res, {
    message: "Profile updated",
    data: profile,
  });
});

/** POST /api/v1/profile/sign-out-everywhere */
const signOutEverywhere = asyncHandler(async (req, res) => {
  const result = await profileService.signOutEverywhere({ user: req.user, req });

  return sendSuccess(res, { message: result.message, data: {} });
});

module.exports = { getProfile, updateProfile, signOutEverywhere };
