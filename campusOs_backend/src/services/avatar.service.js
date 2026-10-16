/**
 * Profile pictures.
 *
 * ## Stored as a key, never as a URL
 *
 * A URL is a public address for somebody's face that nobody chose to publish.
 * A data blob would put megabytes of image inside the user document, which is
 * then read by every query that does not need a picture. So the avatar is a
 * storage key like every other file, and it is served through an endpoint that
 * authenticates first.
 *
 * ## Images only, and small
 *
 * The ceiling is 2 MB, well below the 10 MB document limit. An avatar is shown
 * at 40px in the top bar; anything larger is a photograph being used as an
 * avatar, and the honest response to that is a crop, not a 4 MB download for a
 * user who is only ever shown a thumbnail.
 *
 * ## Replacing one does not leak the old bytes
 *
 * The new image is committed before the previous one is deleted, so a failure
 * part-way leaves an orphaned object rather than a record pointing at bytes
 * that no longer exist — which would be a broken avatar for every user.
 */

const User = require("../models/User");
const { getStorage, sniffMimeType } = require("../config/storage");
const { ApiError } = require("../utils/ApiError");
const auditService = require("./audit.service");
const { AUDIT_ACTION } = require("../config/constants");
const { logger } = require("../config/logger");

/** The only types an avatar may be. */
const ALLOWED_AVATAR_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});

/**
 * Avatar ceiling.
 *
 * Deliberately far below MAX_FILE_BYTES. An avatar is displayed at 40px in the
 * top bar and 96px on the profile; a 10 MB file for that is a waste of both the
 * uploader's bandwidth and everyone's.
 */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** WebP's signature is a RIFF container with a WEBP tag at offset 8. */
function isWebp(buffer) {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  );
}

/**
 * Sniff an avatar's real type.
 *
 * The shared sniffer does not know WebP — it was written for documents — so the
 * two extra signatures are checked here rather than widening the document
 * allowlist, which would let a WebP into a certificate upload.
 */
function sniffAvatarType(buffer) {
  const known = sniffMimeType(buffer);
  if (known && ALLOWED_AVATAR_TYPES[known]) return known;
  if (isWebp(buffer)) return "image/webp";
  return null;
}

/**
 * Store a new avatar, replacing any previous one.
 *
 * @returns {Promise<{storageKey: string|null, mimeType: string|null, bytes: number|null}>}
 */
async function setAvatar({ user, file }) {
  if (!file?.buffer || file.buffer.length === 0) {
    throw ApiError.badRequest("The uploaded image is empty.");
  }

  if (file.buffer.length > MAX_AVATAR_BYTES) {
    throw ApiError.badRequest("Image is too large. The maximum is 2 MB.");
  }

  const verified = sniffAvatarType(file.buffer);

  if (!verified || !ALLOWED_AVATAR_TYPES[verified]) {
    logger.warn(
      {
        userId: user._id,
        declared: file.mimetype,
        bytes: file.buffer.length,
      },
      "Rejected an avatar whose content is not an accepted image"
    );
    throw ApiError.badRequest("Upload a JPEG, PNG or WebP image.");
  }

  const previousKey = user.avatar?.storageKey ?? null;
  const storage = getStorage();

  const stored = await storage.save(file.buffer, {
    folder: "avatars",
    // Generated. A user's email or name never becomes part of a storage path.
    filename: `avatar-${user._id}.${ALLOWED_AVATAR_TYPES[verified]}`,
    mimeType: verified,
  });

  const updated = await User.findByIdAndUpdate(
    user._id,
    {
      $set: {
        avatar: {
          storageKey: stored.key,
          mimeType: verified,
          bytes: stored.bytes ?? file.buffer.length,
          updatedAt: new Date(),
        },
      },
    },
    { new: true }
  );

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.AVATAR_UPDATED,
    entity: "User",
    entityId: user._id,
    // The key is an unguessable path; recording the type and size is enough to
    // explain the record, and does not put a storage path in the audit trail.
    metadata: {
      mimeType: verified,
      bytes: stored.bytes ?? file.buffer.length,
      replaced: Boolean(previousKey),
    },
  });

  // Only after the new avatar is committed. A failure here leaks one orphaned
  // object, which is recoverable; the reverse would break every user's picture.
  if (previousKey && previousKey !== stored.key) {
    try {
      await storage.delete(previousKey, { mimeType: user.avatar?.mimeType });
    } catch (error) {
      logger.warn(
        { err: error, key: previousKey },
        "Could not delete the replaced avatar"
      );
    }
  }

  return updated.avatar;
}

/**
 * Remove an avatar. Idempotent, so a retried delete is not an error.
 *
 * The current record is re-read rather than taken from the caller's document.
 * `req.user` is a snapshot taken when the request was authenticated, so anything
 * that changed the avatar earlier in the same request — or in a test that set it
 * up — is invisible on it, and the previous key would silently be `null` and the
 * old image would never be deleted.
 */
async function clearAvatar({ user }) {
  const current = await User.findById(user._id).select("avatar");
  const previousKey = current?.avatar?.storageKey ?? null;

  await User.findByIdAndUpdate(
    user._id,
    {
      $set: {
        avatar: { storageKey: null, mimeType: null, bytes: null, updatedAt: null },
      },
    },
    { new: true }
  );

  if (!previousKey) return false;

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.AVATAR_REMOVED,
    entity: "User",
    entityId: user._id,
    metadata: {},
  });

  try {
    await getStorage().delete(previousKey);
    return true;
  } catch (error) {
    logger.warn(
      { err: error, key: previousKey },
      "Avatar removed but file delete failed"
    );
    return false;
  }
}

/** The bytes, or a signed redirect when the adapter is a CDN. */
async function readAvatar({ user }) {
  const key = user.avatar?.storageKey;
  if (!key) throw ApiError.notFound("No profile picture");

  const storage = getStorage();

  if (typeof storage.getSignedUrl === "function") {
    return {
      redirect: await storage.getSignedUrl(key, {
        mimeType: user.avatar.mimeType,
        download: false,
      }),
      mimeType: user.avatar.mimeType,
    };
  }

  return { buffer: await storage.read(key), mimeType: user.avatar.mimeType };
}

module.exports = {
  setAvatar,
  clearAvatar,
  readAvatar,
  sniffAvatarType,
  isWebp,
  MAX_AVATAR_BYTES,
  ALLOWED_AVATAR_TYPES,
};
