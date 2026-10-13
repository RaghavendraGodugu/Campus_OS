/**
 * Upload parsing.
 *
 * ## Memory storage, always
 *
 * Files are buffered, never streamed to disk. A streamed upload has to be
 * trusted the moment it lands, because a partially-received file is already a
 * file. Buffering means nothing is written until the content has been verified,
 * so a rejected upload leaves nothing behind to clean up.
 *
 * ## Limits are enforced at the stream
 *
 * `limits.fileSize` stops reading at the cap rather than reading everything and
 * then complaining, which is the difference between a rejected upload and an
 * out-of-memory crash from a ten-gigabyte "avatar".
 *
 * ## The MIME type here is a claim, not a fact
 *
 * Multipart carries whatever the client typed. It is recorded so a helpful error
 * can mention what was sent, and it is never used to decide what the file *is* —
 * `file-type.js` sniffs the actual bytes in the upload service.
 */
const multer = require("multer");

const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { MAX_FILE_BYTES } = require("../config/storage");

/** One file per request; multi-file needs a different contract, not a bigger number. */
const MAX_FILES = 1;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_FILES,
    // Bound the non-file parts too. Without this, a request can carry an
    // arbitrarily large text field alongside a 1 kB file.
    fields: 10,
    fieldSize: 64 * 1024,
  },
});

/** Wrap multer so its errors arrive as ApiError, not as a generic 500. */
function parseSingleFile(field = "file") {
  const handler = upload.single(field);

  return (req, res, next) =>
    handler(req, res, (error) => {
      if (!error) return next();

      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          return next(
            new ApiError(
              ERROR_CODE.PAYLOAD_TOO_LARGE,
              `File is too large. The maximum is ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`
            )
          );
        }
        if (error.code === "LIMIT_FILE_SIZE" || error.code === "LIMIT_UNEXPECTED_FILE") {
          return next(
            new ApiError(
              ERROR_CODE.VALIDATION_ERROR,
              `Upload one file in the "${field}" field.`
            )
          );
        }
        return next(
          new ApiError(ERROR_CODE.VALIDATION_ERROR, `Upload rejected: ${error.message}`)
        );
      }

      // Anything else came from the stream itself.
      return next(
        new ApiError(ERROR_CODE.VALIDATION_ERROR, "The upload could not be read.")
      );
    });
}

/** Reject the request when no file arrived, before any handler runs. */
function requireFile(req, res, next) {
  if (!req.file) {
    return next(
      new ApiError(
        ERROR_CODE.VALIDATION_ERROR,
        'No file was uploaded. Send one file in the "file" field.'
      )
    );
  }
  return next();
}

module.exports = { parseSingleFile, requireFile, MAX_FILES };
