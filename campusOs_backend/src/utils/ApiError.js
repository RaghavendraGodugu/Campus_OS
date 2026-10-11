/**
 * Application error type.
 *
 * Services and controllers throw `ApiError`; the single error handler in
 * `middleware/errorHandler.js` is the only place that turns an error into an
 * HTTP response. That separation is what guarantees a stack trace, a Mongoose
 * internal message or a database string can never reach a client by accident —
 * anything not thrown as an `ApiError` is treated as an unknown internal fault
 * and reported as a generic 500.
 */

/** Machine-readable error codes. Clients may branch on these. */
const ERROR_CODE = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  CSRF_INVALID: "CSRF_INVALID",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  PAYMENT_VERIFICATION_FAILED: "PAYMENT_VERIFICATION_FAILED",
  INTEGRATION_ERROR: "INTEGRATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

/** Default HTTP status per code, so throw sites stay terse. */
const DEFAULT_STATUS = {
  [ERROR_CODE.VALIDATION_ERROR]: 400,
  [ERROR_CODE.UNAUTHENTICATED]: 401,
  [ERROR_CODE.INVALID_CREDENTIALS]: 401,
  [ERROR_CODE.FORBIDDEN]: 403,
  [ERROR_CODE.CSRF_INVALID]: 403,
  [ERROR_CODE.NOT_FOUND]: 404,
  [ERROR_CODE.CONFLICT]: 409,
  [ERROR_CODE.RATE_LIMITED]: 429,
  [ERROR_CODE.INVALID_TRANSITION]: 422,
  [ERROR_CODE.PAYLOAD_TOO_LARGE]: 413,
  [ERROR_CODE.UNSUPPORTED_MEDIA_TYPE]: 415,
  [ERROR_CODE.PAYMENT_VERIFICATION_FAILED]: 400,
  [ERROR_CODE.INTEGRATION_ERROR]: 502,
  [ERROR_CODE.INTERNAL_ERROR]: 500,
};

class ApiError extends Error {
  /**
   * @param {string} code One of ERROR_CODE. Drives the HTTP status.
   * @param {string} message Safe, user-understandable text. Never internals.
   * @param {object} [options]
   * @param {number} [options.status] Override the default status.
   * @param {Array}  [options.details] Field-level validation problems.
   * @param {unknown} [options.cause] Underlying error, logged but never sent.
   */
  constructor(code, message, { status, details, cause } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = status ?? DEFAULT_STATUS[code] ?? 500;
    this.details = details;
    if (cause) this.cause = cause;
    this.isOperational = true;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(message, details) {
    return new ApiError(ERROR_CODE.VALIDATION_ERROR, message, { details });
  }

  static unauthenticated(message = "Authentication required") {
    return new ApiError(ERROR_CODE.UNAUTHENTICATED, message);
  }

  static invalidCredentials(message = "Invalid email or password") {
    return new ApiError(ERROR_CODE.INVALID_CREDENTIALS, message);
  }

  static forbidden(message = "You do not have permission to perform this action") {
    return new ApiError(ERROR_CODE.FORBIDDEN, message);
  }

  static notFound(message = "Resource not found") {
    return new ApiError(ERROR_CODE.NOT_FOUND, message);
  }

  static conflict(message, details) {
    return new ApiError(ERROR_CODE.CONFLICT, message, { details });
  }

  static invalidTransition(message, details) {
    return new ApiError(ERROR_CODE.INVALID_TRANSITION, message, { details });
  }

  /** Shape written to the HTTP response. Deliberately excludes `cause`. */
  toJSON() {
    return {
      success: false,
      message: this.message,
      code: this.code,
      ...(this.details?.length ? { details: this.details } : {}),
    };
  }
}

module.exports = { ApiError, ERROR_CODE, DEFAULT_STATUS };
