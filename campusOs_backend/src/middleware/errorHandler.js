/**
 * Central error handling.
 *
 * This module is the security boundary for error reporting: it is the only
 * code allowed to translate an exception into an HTTP response. The spec
 * forbids exposing stack traces, database internals, tokens or secrets, so the
 * policy is:
 *
 *  - `ApiError`      -> its message is safe by construction; send it.
 *  - ZodError        -> send field-level messages only, never the raw payload.
 *  - Mongoose known  -> duplicate key / validation / bad ObjectId, mapped to
 *                       friendly text; `details` are field-level only.
 *  - JWT errors      -> generic 401, never the reason or the token.
 *  - Everything else -> opaque 500. The real error is logged, not returned.
 */

const { ZodError } = require("zod");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { getEnv } = require("../config/env");

/** 404 handler for unmatched routes. Registered after all real routes. */
function notFoundHandler(req, res, next) {
  next(
    new ApiError(
      ERROR_CODE.NOT_FOUND,
      `Route ${req.method} ${req.originalUrl} does not exist`
    )
  );
}

/**
 * Map a ZodError onto the wire format: `[{ field, message }]`.
 * Never include the rejected value — it may contain a submitted password.
 */
function formatZodIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Translate known third-party errors into `ApiError`.
 * Returns null when the error is unrecognised, which means "treat as 500".
 *
 * An `ApiError` is already correctly shaped and is returned untouched — it is
 * an operational error whose message was written to be safe for clients.
 */
function normaliseKnownError(err) {
  if (err instanceof ApiError) {
    return err;
  }

  // --- Mongoose duplicate key -------------------------------------------------
  if (err?.code === 11000) {
    // err.keyValue holds the offending field values, which for a users
    // collection would include the email address. Report the field only.
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return new ApiError(
      ERROR_CODE.CONFLICT,
      `A record with that ${field} already exists`,
      { cause: err }
    );
  }

  // --- Mongoose schema validation --------------------------------------------
  if (err?.name === "ValidationError" && err.errors) {
    const details = Object.entries(err.errors).map(([field, issue]) => ({
      field,
      message: issue.message,
      code: "VALIDATION_ERROR",
    }));
    return new ApiError(ERROR_CODE.VALIDATION_ERROR, "The submitted data is invalid", {
      details,
      cause: err,
    });
  }

  // --- Mongoose bad ObjectId --------------------------------------------------
  // A malformed id is a client error, not a server fault.
  if (err?.name === "CastError") {
    return new ApiError(ERROR_CODE.VALIDATION_ERROR, `Invalid value for ${err.path}`, {
      cause: err,
    });
  }

  // --- Zod -------------------------------------------------------------------
  if (err instanceof ZodError) {
    return new ApiError(ERROR_CODE.VALIDATION_ERROR, "The submitted data is invalid", {
      details: formatZodIssues(err),
      cause: err,
    });
  }

  // --- body-parser (malformed JSON, oversized body) --------------------------
  if (err?.type === "entity.parse.failed") {
    return new ApiError(ERROR_CODE.VALIDATION_ERROR, "Request body is not valid JSON", {
      cause: err,
    });
  }
  if (err?.type === "entity.too.large") {
    return new ApiError(ERROR_CODE.PAYLOAD_TOO_LARGE, "Request body is too large", {
      cause: err,
    });
  }

  // --- express-rate-limit ----------------------------------------------------
  if (err?.type === "headers.quota.exceeded" || err?.code === "ERR_HTTP_HEADERS_SENT") {
    return new ApiError(ERROR_CODE.RATE_LIMITED, "Too many requests, please slow down", {
      cause: err,
    });
  }

  // --- JWT -------------------------------------------------------------------
  // Never reveal which of expiry/signature/tampering failed.
  if (err?.name === "TokenExpiredError" || err?.name === "JsonWebTokenError") {
    return new ApiError(
      ERROR_CODE.UNAUTHENTICATED,
      "Your session is invalid or has expired",
      {
        cause: err,
      }
    );
  }

  return null;
}

/**
 * Express error-handling middleware. Must keep all four parameters — Express
 * identifies an error handler by arity, so `next` cannot be omitted even
 * though it is unused.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const env = getEnv();

  // The logger is required lazily: `config/logger` reads the environment at
  // import time, and this module must stay loadable even when the environment
  // is invalid (that is one of the failures it has to report cleanly).
  const { logger } = require("../config/logger");

  const apiError =
    normaliseKnownError(err) ??
    new ApiError(
      ERROR_CODE.INTERNAL_ERROR,
      "An unexpected error occurred. Please try again later."
    );

  const logPayload = {
    err,
    reqId: req.id,
    method: req.method,
    url: req.originalUrl,
    statusCode: apiError.statusCode,
    errorCode: apiError.code,
    // Logging the user id is safe and essential for triage; the token is not.
    userId: req.user?._id?.toString(),
  };

  if (apiError.statusCode >= 500) {
    logger.error(
      { ...logPayload, msg: "Unhandled server error" },
      "Unhandled server error"
    );
  } else {
    logger.warn(
      { ...logPayload, msg: "Request rejected" },
      `${req.method} ${req.originalUrl} -> ${apiError.statusCode}`
    );
  }

  // If headers were already sent (e.g. a stream failed mid-download) the
  // only correct action is to destroy the socket; the client sees a truncated
  // response rather than a corrupted JSON error appended to it.
  if (res.headersSent) {
    return req.destroy();
  }

  const body = apiError.toJSON();

  // Development convenience only: attach the stack so a developer can debug
  // without attaching a debugger. Never emitted in production.
  if (env.NODE_ENV !== "production" && apiError.statusCode >= 500 && err?.stack) {
    body.stack = err.stack;
  }

  return res.status(apiError.statusCode).json(body);
}

module.exports = { errorHandler, notFoundHandler, normaliseKnownError };
