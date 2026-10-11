/**
 * Authentication service.
 *
 * Owns login, refresh-token rotation, logout and session revocation. Routes and
 * controllers contain no authentication logic of their own.
 *
 * ## Refresh rotation and reuse detection
 *
 * Every refresh token belongs to a **family** — the chain of rotations from one
 * original login. On refresh, the presented token is revoked and replaced; the
 * replacement stays in the same family and session.
 *
 * If a token that is *already revoked* is ever presented, the legitimate client
 * must have lost its newer token, or a thief replayed a captured one. We cannot
 * tell which, so the whole family is revoked and the user must sign in again.
 * That is the standard OAuth 2.1 / BCP guidance, and it converts a silent,
 * indefinite compromise into a visible, bounded one.
 *
 * ## No transactions
 *
 * Rotation is a read-modify-write on a subdocument array. The claim step is a
 * single atomic `findOneAndUpdate` whose filter requires the token to be live
 * *now*. MongoDB re-evaluates a single-document update predicate while holding
 * the document lock, so two concurrent refreshes cannot both claim the same
 * token: the loser matches nothing and is treated as reuse. This holds on a
 * standalone `mongod`, which a transaction-based design would not.
 */

const User = require("../models/User");
const bcrypt = require("bcryptjs");
const { ApiError } = require("../utils/ApiError");
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  safeCompare,
  generateCsrfToken,
  randomId,
  expiryFromToken,
} = require("../utils/tokens");
const { describePermissions } = require("../utils/permissions");
const { AUDIT_ACTION } = require("../config/constants");
const { logger } = require("../config/logger");
const auditService = require("./audit.service");

/**
 * Maximum stored refresh-token entries per account.
 *
 * This counts *revoked* entries too, because they are retained for reuse
 * detection (see pruneUserSessions). A full rotation cycle therefore consumes
 * two slots — one revoked, one live — so the ceiling is set well above the
 * number of sessions a user realistically holds. `$slice: -MAX` evicts the
 * oldest entries, which are the most likely to be spent or expired.
 */
const MAX_SESSIONS_PER_USER = 40;

/**
 * Hash compared against when no account matches, so the "unknown email" path
 * costs roughly the same as a wrong password.
 *
 * Without this, response timing reveals which addresses are registered. The
 * value only needs to be a well-formed bcrypt hash; it protects no real
 * password.
 */
const DUMMY_HASH = "$2b$12$abcdefghijklmnopqrstuuI6eJQqFb0lWqNfPYHnBbTK9s6UcH8AZqKa";

/**
 * Remove *expired* sessions from one user.
 *
 * Revoked sessions are deliberately **retained**. Reuse detection works by
 * finding a presented token whose hash matches an already-revoked entry; if
 * rotation deleted the spent token, a replay would find nothing and reuse
 * would go undetected. Revoked entries are therefore kept until they expire,
 * which is exactly as long as the token could still be replayed.
 *
 * The array is capped at MAX_SESSIONS_PER_USER, so retention cannot grow
 * without bound.
 */
async function pruneUserSessions(userId) {
  await User.updateOne(
    { _id: userId },
    { $pull: { refreshTokens: { expiresAt: { $lte: new Date() } } } }
  );
}

/**
 * Authenticate with email and password.
 *
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.password
 * @param {object} [params.req] Express request, for audit/session metadata.
 * @returns {Promise<{user: object, accessToken: string, refreshToken: string, csrfToken: string, expiresAt: Date, sessionId: string}>}
 * @throws {ApiError} 401 with an intentionally vague message.
 */
async function login({ email, password, req }) {
  const normalisedEmail = String(email).trim().toLowerCase();

  const user = await User.findOne({ email: normalisedEmail }).select("+passwordHash");

  // Always run a bcrypt comparison, even with no matching account, so the two
  // failure paths take comparable time.
  const passwordMatches = await bcryptCompare(password, user?.passwordHash);

  // One message for every failure mode. A caller must not be able to tell
  // "no such account" from "wrong password" from "inactive".
  if (!user || !passwordMatches || !user.isActive) {
    await auditService.record({
      action: AUDIT_ACTION.LOGIN_FAILED,
      entity: "User",
      entityId: user?._id ?? null,
      metadata: {
        email: normalisedEmail,
        reason: user && !user.isActive ? "inactive" : "bad_credentials",
      },
      actor: user ?? null,
      req,
    });
    throw ApiError.invalidCredentials();
  }

  // Clear any earlier forced invalidation: signing in is the user's explicit
  // decision to start a new session.
  if (user.sessionsInvalidatedAt) {
    user.sessionsInvalidatedAt = null;
  }

  const tokens = await issueSession(user, req);

  user.lastLoginAt = new Date();
  await user.save().catch((error) => {
    logger.warn({ err: error, userId: user.id }, "Failed to record lastLoginAt");
  });

  await auditService.record({
    action: AUDIT_ACTION.LOGIN,
    entity: "User",
    entityId: user._id,
    metadata: { role: user.role },
    actor: user,
    req,
  });

  return { user, ...tokens };
}

/**
 * Compare a password against a hash, tolerating a missing hash.
 * @param {string} plainText
 * @param {string|undefined} hash
 * @returns {Promise<boolean>}
 */
async function bcryptCompare(plainText, hash) {
  return bcrypt.compare(plainText, hash || DUMMY_HASH);
}

/**
 * Issue a fresh session and persist the refresh-token hash.
 *
 * @param {import('mongoose').Document} user
 * @param {object} [req]
 */
async function issueSession(user, req) {
  const sessionId = randomId(16);
  const familyId = randomId(16);

  const accessToken = signAccessToken({
    userId: user._id.toString(),
    role: user.role,
    sessionId,
  });

  const refreshToken = signRefreshToken({
    userId: user._id.toString(),
    sessionId,
    familyId,
  });

  const csrfToken = generateCsrfToken({
    userId: user._id.toString(),
    sessionId,
  });

  const expiresAt = expiryFromToken(verifyRefreshToken(refreshToken));

  const entry = {
    tokenHash: hashToken(refreshToken),
    sessionId,
    familyId,
    device: (req?.get?.("user-agent") ?? "").slice(0, 200),
    userAgent: (req?.get?.("user-agent") ?? "").slice(0, 200),
    ip: req?.ip ?? req?.socket?.remoteAddress ?? "",
    issuedAt: new Date(),
    expiresAt,
  };

  // Prune first, then append with $slice to cap the array. These must be two
  // operations: $pull and $push on the same array in one update is a MongoDB
  // path conflict and would be rejected.
  await pruneUserSessions(user._id);

  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        refreshTokens: { $each: [entry], $slice: -MAX_SESSIONS_PER_USER },
      },
    }
  ).catch((error) => {
    logger.error({ err: error, userId: user.id }, "Failed to persist refresh session");
    throw ApiError.badRequest("Could not start a session. Please try again.");
  });

  return { accessToken, refreshToken, csrfToken, expiresAt, sessionId, familyId };
}

/**
 * Rotate a refresh token.
 *
 * @param {object} params
 * @param {string} params.refreshToken Raw token from the cookie.
 * @param {object} [params.req]
 * @returns {Promise<{user: object, accessToken: string, refreshToken: string, csrfToken: string}>}
 * @throws {ApiError} 401 on any invalid, expired or reused token.
 */
async function refreshSession({ refreshToken, req }) {
  if (!refreshToken) {
    throw ApiError.unauthenticated("No session to refresh");
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    // Bad signature, wrong type or expired — indistinguishable to the client.
    throw ApiError.unauthenticated("Your session is invalid or has expired");
  }

  const presentedHash = hashToken(refreshToken);

  // Atomically claim the token. The `$elemMatch` requires it to be live right
  // now, so a concurrent second refresh finds nothing and falls into the reuse
  // path below.
  const claimed = await User.findOneAndUpdate(
    {
      _id: payload.sub,
      refreshTokens: { $elemMatch: { tokenHash: presentedHash, revokedAt: null } },
    },
    {
      $set: {
        "refreshTokens.$.revokedAt": new Date(),
        "refreshTokens.$.revokedReason": "rotated",
      },
    },
    { new: false }
  );

  if (!claimed) {
    await handlePossibleReuse(payload, presentedHash, req);
    throw ApiError.unauthenticated("Your session is invalid or has expired");
  }

  const user = await User.findById(payload.sub).select("-passwordHash");

  if (!user || !user.isActive) {
    throw ApiError.unauthenticated("Your session is invalid or has expired");
  }

  // A forced global logout (password change, admin revocation) invalidates
  // every session. Signing in again clears the flag; it is not cleared here,
  // because doing so would let a stolen token resume a revoked session.
  if (user.sessionsInvalidatedAt) {
    await revokeAllSessions(user._id, "admin", req);
    throw ApiError.unauthenticated("Your session is invalid or has expired");
  }

  const accessToken = signAccessToken({
    userId: user._id.toString(),
    role: user.role,
    sessionId: payload.sid,
  });

  const nextRefreshToken = signRefreshToken({
    userId: user._id.toString(),
    sessionId: payload.sid,
    familyId: payload.fid,
  });

  const csrfToken = generateCsrfToken({
    userId: user._id.toString(),
    sessionId: payload.sid,
  });

  const nextEntry = {
    tokenHash: hashToken(nextRefreshToken),
    sessionId: payload.sid,
    familyId: payload.fid,
    device: "",
    userAgent: (req?.get?.("user-agent") ?? "").slice(0, 200),
    ip: req?.ip ?? "",
    issuedAt: new Date(),
    expiresAt: expiryFromToken(verifyRefreshToken(nextRefreshToken)),
  };

  // Append the replacement token alongside the revoked original.
  //
  // The spent token is deliberately NOT removed here. Reuse detection matches a
  // replayed token against a stored *revoked* entry, so deleting it would make
  // replay undetectable — the exact case the rotation scheme exists to catch.
  // Revoked entries are pruned only once they expire (see pruneUserSessions),
  // which is the window in which a replay is still meaningful.
  try {
    await User.updateOne(
      { _id: user._id },
      { $push: { refreshTokens: { $each: [nextEntry], $slice: -MAX_SESSIONS_PER_USER } } }
    );
  } catch (error) {
    logger.error(
      { err: error, userId: user.id },
      "Failed to persist rotated refresh session"
    );
    throw ApiError.badRequest("Could not refresh the session. Please sign in again.");
  }

  await auditService.record({
    action: AUDIT_ACTION.TOKEN_REFRESH,
    entity: "User",
    entityId: user._id,
    metadata: { familyId: payload.fid },
    actor: user,
    req,
  });

  return { user, accessToken, refreshToken: nextRefreshToken, csrfToken };
}

/**
 * Investigate a failed claim.
 *
 * If the presented hash matches a token that exists but is already revoked,
 * this is reuse: revoke every session for that account.
 */
async function handlePossibleReuse(payload, presentedHash, req) {
  const user = await User.findOne({
    _id: payload.sub,
    refreshTokens: { $elemMatch: { tokenHash: presentedHash, revokedAt: { $ne: null } } },
  }).select("-passwordHash");

  if (!user) {
    // Genuinely unknown token: forged, or from a long-dead pruned session.
    return;
  }

  await revokeAllSessions(user._id, "reuse", req);

  logger.warn(
    { userId: user.id, familyId: payload.fid },
    "Refresh token reuse detected — all sessions revoked"
  );

  await auditService.record({
    action: AUDIT_ACTION.TOKEN_REUSE_DETECTED,
    entity: "User",
    entityId: user._id,
    metadata: { familyId: payload.fid },
    actor: user,
    req,
  });
}

/**
 * Revoke every session for a user.
 *
 * `sessionsInvalidatedAt` is stamped so *already-issued* access tokens also
 * stop working, not just future refreshes. Without it, a stolen 15-minute
 * access token would remain usable after logout-all.
 *
 * @param {string} userId
 * @param {string} reason
 * @param {object} [req]
 */
async function revokeAllSessions(userId, reason, req) {
  const now = new Date();

  // Revocation is a security-relevant event. When it was not already recorded
  // by the caller (reuse detection and password change both log separately),
  // record it here so "who ended every session, and why" is always answerable.
  await auditService.record({
    action: AUDIT_ACTION.LOGOUT,
    entity: "User",
    entityId: userId,
    metadata: { scope: "all_sessions", reason },
    req,
  });

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        sessionsInvalidatedAt: now,
        "refreshTokens.$[token].revokedAt": now,
        "refreshTokens.$[token].revokedReason": reason,
      },
    },
    { arrayFilters: [{ "token.revokedAt": null }] }
  );

  logger.info({ userId, reason }, "All sessions revoked");
  return { revoked: true, reason };
}

/**
 * Revoke one session by its refresh-token hash (single-device logout).
 *
 * Takes the **raw refresh token** rather than a userId, because `/auth/logout`
 * is deliberately not behind `authenticate`: a user whose access token has
 * already expired must still be able to sign out. Identifying the session from
 * the refresh token means revocation works in exactly that case — deriving it
 * from `req.user` would silently skip revocation and leave the session alive
 * on the server.
 *
 * @param {string} rawRefreshToken
 * @returns {Promise<{revoked: boolean, userId: string|null}>}
 */
async function revokeSession(rawRefreshToken) {
  if (!rawRefreshToken) return { revoked: false, userId: null };

  // Identify the owner from the token. A malformed or forged token yields null,
  // and the caller still clears cookies — logout must never fail.
  let userId;
  try {
    userId = verifyRefreshToken(rawRefreshToken).sub;
  } catch {
    return { revoked: false, userId: null };
  }

  const result = await User.updateOne(
    { _id: userId, "refreshTokens.tokenHash": hashToken(rawRefreshToken) },
    {
      $set: {
        "refreshTokens.$.revokedAt": new Date(),
        "refreshTokens.$.revokedReason": "logout",
      },
    }
  );

  return { revoked: result.modifiedCount > 0, userId };
}

/**
 * Remove expired sessions across all users. Run periodically.
 *
 * Only *expired* entries are removed. Revoked-but-unexpired entries are kept
 * so that replaying them is still detected as reuse; once a token has expired
 * it can no longer be presented, so it carries no detection value.
 */
async function pruneExpiredSessions() {
  const result = await User.updateMany(
    { refreshTokens: { $exists: true, $ne: [] } },
    { $pull: { refreshTokens: { expiresAt: { $lte: new Date() } } } }
  );
  return result.modifiedCount ?? 0;
}

/**
 * Build the `/auth/me` payload.
 *
 * @param {import('mongoose').Document} user
 * @param {object} [student] Linked Student profile, when present.
 */
function buildSessionPayload(user, student) {
  const permissionInfo = describePermissions(user.role);

  return {
    user: user.toPublicJSON(),
    student: student
      ? {
          id: student._id.toString(),
          rollNumber: student.rollNumber,
          semester: student.semester,
          year: student.year,
          section: student.section ?? null,
          program: student.program,
          department: student.department,
          feeStatus: student.feeStatus,
          batchYear: student.batchYear,
        }
      : null,
    permissions: permissionInfo.permissions,
    scopes: permissionInfo.scopes,
  };
}

/** Constant-time token comparison, re-exported for tests. */
const tokensMatch = (presented, expected) => safeCompare(presented, expected);

module.exports = {
  login,
  refreshSession,
  logout: revokeSession,
  revokeAllSessions,
  pruneExpiredSessions,
  pruneUserSessions,
  buildSessionPayload,
  issueSession,
  tokensMatch,
  MAX_SESSIONS_PER_USER,
  DUMMY_HASH,
};
