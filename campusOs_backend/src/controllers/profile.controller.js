/**
 * Profile controller.
 */

const User = require("../models/User");
const { ApiError } = require("../utils/ApiError");
const profileService = require("../services/profile.service");
const avatarService = require("../services/avatar.service");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendPrivateMedia } = require("../utils/mediaResponse");
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

/**
 * POST /api/v1/profile/avatar
 *
 * Multipart, so the strict profile schema is untouched — it deliberately takes
 * exactly two fields, and weakening it to accept a body it does not understand
 * would undo the feature it exists for.
 */
const uploadAvatar = asyncHandler(async (req, res) => {
  const avatar = await avatarService.setAvatar({ user: req.user, file: req.file });
  return sendSuccess(res, { message: "Profile picture updated", data: { avatar } });
});

/** DELETE /api/v1/profile/avatar */
const removeAvatar = asyncHandler(async (req, res) => {
  const removed = await avatarService.clearAvatar({ user: req.user });
  return sendSuccess(res, {
    message: removed ? "Profile picture removed" : "There was no profile picture",
    data: { removed },
  });
});

/**
 * GET /api/v1/profile/avatar — somebody else's, via their user id.
 *
 * Separate from the profile endpoint because an <img> tag cannot send a custom
 * header, and because the picture is served as bytes rather than as part of a
 * JSON record. Private and revalidated rather than re-fetched on every paint.
 */
const readAvatar = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.userId).select("avatar");
  if (!target) throw ApiError.notFound("No such account");

  const storageKey = target.avatar?.storageKey;
  if (!storageKey) throw ApiError.notFound("No profile picture");

  return sendPrivateMedia(req, res, {
    storageKey,
    mimeType: target.avatar.mimeType,
    load: async () => {
      const { buffer } = await avatarService.readAvatar({ user: target });
      return buffer;
    },
  });
});

/**
 * PATCH /api/v1/profile/notification-preferences
 *
 * Written on the user record rather than a separate collection: the settings are
 * read on every notification delivered, and a lookup per notification for a
 * document the user document already carries is the wrong trade.
 */
const updateNotificationPreferences = asyncHandler(async (req, res) => {
  const preferences = await profileService.updateNotificationPreferences({
    user: req.user,
    changes: req.validated.body,
  });

  return sendSuccess(res, {
    message: "Notification preferences saved",
    data: { preferences },
  });
});

module.exports = {
  getProfile,
  updateNotificationPreferences,
  updateProfile,
  signOutEverywhere,
  uploadAvatar,
  removeAvatar,
  readAvatar,
};
