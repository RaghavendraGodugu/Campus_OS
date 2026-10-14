/**
 * Rate limiting.
 *
 * Applied to the endpoints where abuse is most damaging:
 *
 *  - **Login**  credential stuffing. Also throttled per-IP *and* per-email, so
 *    one attacker cannot rotate IPs against a single account, and so a shared
 *    office NAT cannot lock out an entire college by exhausting one IP's quota.
 *  - **Refresh** token-rotation churn.
 *  - **Password recovery** out of an abundance of caution (Phase A scope).
 *  - **Global** a broad ceiling to absorb floods and scraping.
 *
 * The standard `express-rate-limit` in-memory store is used deliberately: it is
 * per-process, so limits are approximate under multi-instance deployment. For a
 * single-instance college deployment that is correct; a shared store (Redis) is
 * required before scaling horizontally, and `USE_REDIS_RATE_LIMIT` marks that
 * follow-up rather than leaving it implicit.
 */

const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { getEnv } = require("../config/env");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");

/**
 * Shared response shape so a 429 looks like every other error.
 * Note `Retry-After` is set by express-rate-limit; the client uses it to
 * schedule a retry rather than hammering.
 */
function rateLimitHandler(req, res, next, options) {
  next(
    new ApiError(
      ERROR_CODE.RATE_LIMITED,
      options.message || "Too many requests. Please wait before trying again."
    )
  );
}

/**
 * Build a limiter.
 *
 * @param {object} config
 * @param {number} config.windowMs
 * @param {number} config.limit
 * @param {string} [config.message]
 * @param {boolean} [config.skipSuccessfulRequests] Count only failures.
 * @param {(req) => string} [config.keyGenerator]
 */
function createLimiter({
  windowMs,
  limit,
  message,
  skipSuccessfulRequests = false,
  keyGenerator,
}) {
  const env = getEnv();

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator,
    handler: (req, res, next) => rateLimitHandler(req, res, next, { message }),
    // Rate limiting is disabled under test so the suite is not throttled by
    // the many repeated requests it makes. Production behaviour is unaffected.
    skip: () => env.NODE_ENV === "test",
  });
}

/**
 * Default key: client IP, normalised for IPv6.
 *
 * `ipKeyGenerator` is **required**, not optional. An IPv6 client is routinely
 * handed a /64 or larger prefix, so it can present a different address on every
 * single request. Keying a limiter on the raw address would let an attacker
 * bypass every login throttle simply by rotating source addresses.
 * `ipKeyGenerator` groups addresses into /56 or /64 buckets before hashing,
 * which collapses that entire range into one bucket.
 *
 * Express 5 exposes the real client address on `req.ip` because app.js sets
 * `trust proxy` to one hop.
 */
const defaultKeyGenerator = (req) => ipKeyGenerator(req.ip);

/**
 * Key on the submitted email rather than the IP.
 *
 * Stops an attacker distributing guesses across many addresses against one
 * account. Uses the *raw* body value because this runs before validation, and
 * is only ever used as an opaque rate-limit bucket key.
 */
const emailKeyGenerator = (req) => {
  const email = req.body?.email;
  return typeof email === "string"
    ? email.trim().toLowerCase()
    : defaultKeyGenerator(req);
};

/** Login: 10 attempts per 15 minutes per IP. */
const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many sign-in attempts. Please try again in a few minutes.",
  // Only failed attempts count, so a legitimate user is never locked out by
  // their own successful use.
  skipSuccessfulRequests: true,
  keyGenerator: defaultKeyGenerator,
});

/** Per-account login throttle, independent of source IP. */
const loginPerAccountLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: "Too many sign-in attempts for this account. Please try again later.",
  skipSuccessfulRequests: true,
  keyGenerator: emailKeyGenerator,
});

/** Token refresh: generous, but bounded so rotation cannot be used as a DoS. */
const refreshLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  message: "Too many session refresh attempts.",
  keyGenerator: defaultKeyGenerator,
});

/** Broad ceiling across the API. */
/**
 * The public grievance endpoints.
 *
 * Filing one is unauthenticated by definition, so the only thing standing
 * between the endpoint and an inbox of spam is this. Tracking is read-only and
 * returns almost nothing, but a tight limit is still worth having: without one,
 * the codes are being probed, and a probe that succeeds is a disclosure about
 * somebody else's grievance.
 */
const anonymousFilingLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: "Too many anonymous reports from this connection. Please try later.",
  keyGenerator: defaultKeyGenerator,
});

const complaintTrackingLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: "Too many lookups. Please try again in a few minutes.",
  keyGenerator: defaultKeyGenerator,
});

const globalLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 300,
  message: "Too many requests. Please slow down.",
  keyGenerator: defaultKeyGenerator,
});

module.exports = {
  createLimiter,
  loginLimiter,
  loginPerAccountLimiter,
  refreshLimiter,
  anonymousFilingLimiter,
  complaintTrackingLimiter,
  globalLimiter,
  defaultKeyGenerator,
  emailKeyGenerator,
};
