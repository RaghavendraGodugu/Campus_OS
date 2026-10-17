/**
 * JWT issuing and verification, plus the stateless CSRF token.
 *
 * ## Two token types, two secrets
 *
 * Access tokens are short-lived (15m) and stateless: the server does not store
 * them, so a request never waits on a database lookup to authorise.
 *
 * Refresh tokens are long-lived (7d) and their *state* lives in
 * `User.refreshTokens` as SHA-256 hashes. The token itself is still a JWT so it
 * can be read and rejected without a database round-trip on the common path.
 *
 * They are signed with **different secrets**. If both used one key, a leaked
 * refresh secret would also let an attacker mint access tokens, and the short
 * expiry would provide no protection.
 *
 * ## Why tokens live in cookies, not localStorage
 *
 * A token in localStorage is readable by any script that runs on the page, so a
 * single XSS bug exfiltrates a long-lived credential. An HttpOnly cookie is not
 * exposed to JavaScript at all. The trade-off is that cookies are sent
 * automatically, which is what makes CSRF protection mandatory — see
 * middleware/csrf.js.
 *
 * ## Token type binding
 *
 * Every token carries a `typ` claim, and verification requires the expected
 * type. Without this, a refresh token would be accepted wherever an access
 * token is expected, turning a 7-day credential into a 7-day API key.
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const { getEnv } = require("../config/env");

const TOKEN_TYPE = {
  ACCESS: "access",
  REFRESH: "refresh",
  /**
   * The half-finished state of a two-factor login.
   *
   * A distinct type, not a flag on an access token. If the challenge were an
   * access token then every place that verifies "is this a valid session?" would
   * accept it — and the challenge exists precisely during the window where the
   * password is known but the second factor is not.
   */
  CHALLENGE: "2fa-challenge",
};

/** How long a two-factor challenge stays usable. */
const CHALLENGE_EXPIRY = "5m";

/** Token lifetime defaults, overridable via the environment. */
const DEFAULT_ACCESS_EXPIRY = "15m";
const DEFAULT_REFRESH_EXPIRY = "7d";

/**
 * Sign an access token.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.role
 * @param {string} params.sessionId Correlates the token with its session entry.
 * @returns {string} Signed JWT.
 */
function signAccessToken({ userId, role, sessionId }) {
  const env = getEnv();

  return jwt.sign({ role, sid: sessionId, typ: TOKEN_TYPE.ACCESS }, env.JWT_SECRET, {
    subject: userId.toString(),
    expiresIn: env.JWT_EXPIRES_IN || DEFAULT_ACCESS_EXPIRY,
    // Note: `clockTolerance` is a verify-only option and jsonwebtoken
    // rejects it at signing time; it is set in verifyToken instead.
  });
}

/**
 * Sign a refresh token.
 *
 * ## The `jti` nonce is mandatory, not decorative
 *
 * A JWT's `iat` claim has **one-second** resolution. Two tokens minted for the
 * same subject and session inside the same second are byte-identical, because
 * every claim matches. A client that refreshes immediately — which is the
 * common case, and the case a rotation scheme most needs to defend — would
 * receive the same token back, rotation would be a no-op, and reuse detection
 * would never fire.
 *
 * A cryptographically random `jti` guarantees every issued token is distinct,
 * so a rotated token can always be told apart from the one it replaced.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.sessionId
 * @param {string} params.familyId Groups a rotation chain for reuse detection.
 * @returns {string}
 */
function signRefreshToken({ userId, sessionId, familyId }) {
  const env = getEnv();

  return jwt.sign(
    { sid: sessionId, fid: familyId, typ: TOKEN_TYPE.REFRESH, jti: randomId(16) },
    env.REFRESH_TOKEN_SECRET,
    {
      subject: userId.toString(),
      expiresIn: env.REFRESH_TOKEN_EXPIRES_IN || DEFAULT_REFRESH_EXPIRY,
    }
  );
}

/**
 * Verify a token of an expected type.
 *
 * @param {string} token
 * @param {string} expectedType One of TOKEN_TYPE.
 * @param {'access'|'refresh'} secret Which secret to verify against.
 * @returns {object} Decoded payload.
 * @throws {jwt.JsonWebTokenError|jwt.TokenExpiredError} On any failure.
 */
function verifyToken(token, expectedType, secret) {
  const decoded = jwt.verify(token, secret, { clockTolerance: 5 });

  if (decoded.typ !== expectedType) {
    // A refresh token presented as an access token (or vice versa) is an
    // attack signature, not a normal client error.
    const error = new jwt.JsonWebTokenError("Invalid token type");
    throw error;
  }

  return decoded;
}

/** Verify an access token using the access secret. */
function verifyAccessToken(token) {
  return verifyToken(token, TOKEN_TYPE.ACCESS, getEnv().JWT_SECRET);
}

/**
 * Sign the token for the second step of a two-factor login.
 *
 * Authorises exactly one thing: "prove you hold the second factor for this
 * account". It is not a session, carries no role, and no middleware accepts it.
 */
function signTwoFactorChallenge({ userId, sessionId }) {
  const env = getEnv();
  return jwt.sign({ sid: sessionId, typ: TOKEN_TYPE.CHALLENGE }, env.JWT_SECRET, {
    subject: userId.toString(),
    expiresIn: CHALLENGE_EXPIRY,
  });
}

/** Verify a two-factor challenge. */
function verifyTwoFactorChallenge(token) {
  return verifyToken(token, TOKEN_TYPE.CHALLENGE, getEnv().JWT_SECRET);
}

/** Verify a refresh token using the refresh secret. */
function verifyRefreshToken(token) {
  return verifyToken(token, TOKEN_TYPE.REFRESH, getEnv().REFRESH_TOKEN_SECRET);
}

/**
 * Hash a refresh token for storage.
 *
 * SHA-256 rather than bcrypt deliberately: this hash is verified on every
 * refresh request, so it must be fast. It is safe here because the input is a
 * high-entropy 256-bit random token, not a guessable password — there is no
 * dictionary to attack. Storing the hash means a database leak yields no
 * usable sessions.
 *
 * @param {string} token
 * @returns {string} Hex digest.
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time comparison of two hashes.
 * Prevents timing attacks when checking a presented token against storage.
 *
 * @param {string} a
 * @param {string} b
 */
function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Derive the stateless CSRF token.
 *
 * ## The problem
 *
 * Cookie auth means the browser attaches session cookies to any cross-site
 * request, including one an attacker's page triggers. The server must prove
 * the request came from a page that could read our cookie.
 *
 * ## The double-submit pattern
 *
 *  1. The server sends a CSRF cookie that JavaScript *can* read.
 *  2. The frontend echoes it in the `X-CSRF-Token` header.
 *  3. The server requires both, and binds them to the user's identity.
 *
 * A cross-origin attacker cannot read the cookie, so it cannot populate the
 * header, so the request is rejected. Binding the token to the user and
 * session also stops an attacker from *setting* a cookie of their own choosing
 * (the naive double-submit flaw).
 *
 * Stateless by design: no CSRF table, no lookup, nothing to expire early. The
 * access token's own 15-minute lifetime bounds the exposure window.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.sessionId
 * @returns {string} Hex HMAC.
 */
function generateCsrfToken({ userId, sessionId }) {
  const env = getEnv();
  return crypto
    .createHmac("sha256", env.CSRF_SECRET)
    .update(`${userId}:${sessionId}`)
    .digest("hex");
}

/**
 * Verify a presented CSRF token against the expected value.
 * @param {string} presented
 * @param {string} expected
 */
function verifyCsrfToken(presented, expected) {
  return safeCompare(presented, expected);
}

/**
 * Read the `seconds`-or-duration style value from a JWT payload.
 * @param {object} decoded
 * @returns {Date}
 */
function expiryFromToken(decoded) {
  return new Date(decoded.exp * 1000);
}

/** Cryptographically random identifier, URL-safe. */
function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

module.exports = {
  TOKEN_TYPE,
  signAccessToken,
  signTwoFactorChallenge,
  verifyTwoFactorChallenge,
  signRefreshToken,
  verifyToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  safeCompare,
  generateCsrfToken,
  verifyCsrfToken,
  expiryFromToken,
  randomId,
};
