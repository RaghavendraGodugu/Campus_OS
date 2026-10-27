/**
 * Cookie management.
 *
 * All session cookies are configured here so their security attributes cannot
 * drift between the login, refresh and logout code paths.
 *
 * ## Why SameSite=None
 *
 * The production deployment serves the frontend from Vercel and the API from
 * Render. Those are different *sites*, so a `SameSite=Lax` cookie — the browser
 * default — would not be sent on the API calls the SPA makes. `None` is
 * required for the architecture, and it is precisely why CSRF protection is
 * mandatory rather than optional.
 *
 * `SameSite=None` is ignored by browsers unless `Secure` is also set, so the
 * two are always applied together.
 *
 * In development the frontend proxies `/api` through Vite, making the two
 * same-origin; there `Lax` is used so the flow also works over plain HTTP,
 * which browsers refuse to send `Secure` cookies over.
 */

const { getEnv } = require("../config/env");

const COOKIE_NAMES = {
  ACCESS_TOKEN: "cos_at",
  REFRESH_TOKEN: "cos_rt",
  CSRF_TOKEN: "cos_ct",
};

/** Verbs that require CSRF validation. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Build cookie options appropriate to the environment.
 *
 * @param {object} [overrides]
 * @returns {import('express').CookieOptions}
 */
function cookieOptions(overrides = {}) {
  const env = getEnv();
  const isProduction = env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProduction || env.COOKIE_SECURE,
    // Cross-site in production (Vercel -> Render); same-origin in development.
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    ...overrides,
  };
}

/** Options for a short-lived access token. */
function accessTokenOptions() {
  return cookieOptions({ maxAge: 15 * 60 * 1000 }); // 15 minutes
}

/** Options for a long-lived refresh token. */
function refreshTokenOptions() {
  const env = getEnv();
  const maxAge =
    parseDurationToMs(env.REFRESH_TOKEN_EXPIRES_IN) ?? 7 * 24 * 60 * 60 * 1000;
  return cookieOptions({ maxAge, path: "/api/v1/auth" });
}

/**
 * The CSRF cookie stays readable because it is part of the double-submit
 * fallback for same-origin development and non-browser clients. It is never an
 * authentication credential, so `httpOnly` is deliberately false.
 *
 * In the split Vercel/Render deployment the page cannot read a cookie scoped to
 * the API host; there the server accepts a trusted Origin header instead.
 */
function csrfTokenOptions() {
  return cookieOptions({ httpOnly: false, maxAge: 15 * 60 * 1000 });
}

/**
 * Set the full session cookie set after a successful login or refresh.
 *
 * @param {import('express').Response} res
 * @param {object} tokens
 * @param {string} tokens.accessToken
 * @param {string} tokens.refreshToken
 * @param {string} tokens.csrfToken
 */
function setAuthCookies(res, { accessToken, refreshToken, csrfToken }) {
  res.cookie(COOKIE_NAMES.ACCESS_TOKEN, accessToken, accessTokenOptions());
  res.cookie(COOKIE_NAMES.REFRESH_TOKEN, refreshToken, refreshTokenOptions());
  res.cookie(COOKIE_NAMES.CSRF_TOKEN, csrfToken, csrfTokenOptions());
}

/**
 * Refresh the short-lived cookies after rotation, leaving the refresh cookie
 * untouched (it was just reissued by the caller).
 */
function setAccessCookies(res, { accessToken, csrfToken }) {
  res.cookie(COOKIE_NAMES.ACCESS_TOKEN, accessToken, accessTokenOptions());
  res.cookie(COOKIE_NAMES.CSRF_TOKEN, csrfToken, csrfTokenOptions());
}

/**
 * Clear every session cookie.
 *
 * Express 5 ignores `maxAge`/`expires` on `clearCookie`, so only `path` (and
 * the security attributes, which must match or the browser keeps the original)
 * need to be supplied.
 */
function clearAuthCookies(res) {
  const base = cookieOptions();
  const refreshPath = "/api/v1/auth";

  res.clearCookie(COOKIE_NAMES.ACCESS_TOKEN, base);
  res.clearCookie(COOKIE_NAMES.REFRESH_TOKEN, { ...base, path: refreshPath });
  res.clearCookie(COOKIE_NAMES.CSRF_TOKEN, { ...base, httpOnly: false });
}

/** Does this request method require CSRF validation? */
function requiresCsrf(req) {
  return UNSAFE_METHODS.has(req.method);
}

/**
 * Parse a duration string ("7d", "15m", "30s") into milliseconds.
 * Returns null when unparseable, so callers can apply their own default.
 *
 * @param {string} value
 * @returns {number|null}
 */
function parseDurationToMs(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * multipliers[unit];
}

module.exports = {
  COOKIE_NAMES,
  UNSAFE_METHODS,
  cookieOptions,
  accessTokenOptions,
  refreshTokenOptions,
  csrfTokenOptions,
  setAuthCookies,
  setAccessCookies,
  clearAuthCookies,
  requiresCsrf,
  parseDurationToMs,
};
