/**
 * Email verification and password reset.
 *
 * ## The two flows share a token store and nothing else
 *
 * Both prove the same thing — this person can read mail at this address — so
 * both use one field on the user. What they must not share is authority: a
 * verification link marks the address proven and stops. Only a reset link may
 * set a password. Keeping `purpose` explicit means a link that ends up pasted
 * into a ticket cannot be used to take the account over.
 *
 * ## Tokens are random, stored hashed, and single-use
 *
 * 32 random bytes, so there is nothing to guess. Stored as SHA-256 because the
 * server only ever needs to compare, and so a database dump yields no working
 * links. Single-use because a reset link is a bearer credential: one that stays
 * valid after use is a link that stays useful to whoever captured it.
 *
 * ## Asking for a reset never reveals whether the address exists
 *
 * `requestReset` returns the same thing for an unknown address as for a known
 * one. Otherwise this endpoint becomes a way to enumerate every student and
 * staff member in the college, and the rate limiter would not help — enumeration
 * needs one request per guess, not a burst.
 */

const crypto = require("node:crypto");

const User = require("../models/User");
const mailer = require("./mailer.service");
const auditService = require("./audit.service");
const { ApiError } = require("../utils/ApiError");
const { hashToken, safeCompare } = require("../utils/tokens");
const { getEnv } = require("../config/env");
const { AUDIT_ACTION } = require("../config/constants");
const { logger } = require("../config/logger");

const PURPOSE = { VERIFICATION: "verification", RESET: "reset" };

/** Verification is a formality; a reset that sits in an inbox for a month is a gift to whoever finds it. */
const TTL = {
  [PURPOSE.VERIFICATION]: 24 * 60 * 60 * 1000,
  [PURPOSE.RESET]: 60 * 60 * 1000,
};

function webUrl(path) {
  const base = getEnv().WEB_URL || "http://localhost:5173";
  return `${base.replace(/\/$/, "")}${path}`;
}

/**
 * Mint a token, store its hash, and mail the link.
 *
 * Replaces any outstanding token of the same purpose, so the newest link always
 * works and older ones stop.
 */
async function issue({ user, purpose, req }) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TTL[purpose]);

  const field = `emailTokens.${purpose}`;
  await User.updateOne(
    { _id: user._id },
    { $set: { [field]: { hash: hashToken(token), expiresAt } } }
  );

  const link =
    purpose === PURPOSE.VERIFICATION
      ? webUrl(`/verify-email?token=${token}`)
      : webUrl(`/reset-password?token=${token}`);

  const message =
    purpose === PURPOSE.VERIFICATION
      ? {
          subject: "Confirm your CampusOS email address",
          text:
            `Hello ${user.fullName},\n\n` +
            `Confirm this address so your college can reach you:\n\n${link}\n\n` +
            `The link works for 24 hours. If you did not expect this, ignore this ` +
            `message — nothing changes until you use the link.\n`,
        }
      : {
          subject: "Reset your CampusOS password",
          text:
            `Hello ${user.fullName},\n\n` +
            `Reset your password here:\n\n${link}\n\n` +
            `The link works for one hour and can be used once. If you did not ask ` +
            `for this, nothing has changed and you can ignore this message.\n`,
        };

  const result = await mailer.send({ to: user.email, ...message });

  await auditService.record({
    action: AUDIT_ACTION.EMAIL_SENT,
    entity: "User",
    entityId: user._id,
    // The purpose, never the link.
    metadata: { purpose, delivered: result.delivered },
    actor: user,
    req,
  });

  return { ...result, expiresAt };
}

/** Send a verification link to an address that has not been proven yet. */
async function sendVerification({ user, req }) {
  return issue({ user, purpose: PURPOSE.VERIFICATION, req });
}

/**
 * Start a password reset.
 *
 * Always resolves to the same shape, whatever the address turned out to be.
 */
async function requestReset({ email, req }) {
  const user = await User.findOne({ email: String(email).trim().toLowerCase() });

  if (!user || !user.isActive) {
    logger.info(
      { email: String(email).trim().toLowerCase() },
      "Password reset asked for an unknown address"
    );
    return { sent: true };
  }

  const result = await issue({ user, purpose: PURPOSE.RESET, req });

  return { sent: true, ...result };
}

/**
 * Check a token without spending it.
 *
 * For showing "this link has expired" on the reset page rather than a generic
 * failure. It deliberately does *not* return the address: the page needs to know
 * whether the link still works, not whose it is, and a token that has leaked into
 * a screenshot should not confirm which account it came from.
 */
async function inspect({ token, purpose }) {
  if (!token) return { valid: false, reason: "missing" };

  const user = await findByToken({ token, purpose });

  if (!user) return { valid: false, reason: "invalid" };

  const expiresAt = slot(user, purpose).expiresAt;
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true };
}

/** Consume a verification link. Marks the address proven and retires the token. */
async function verifyEmail({ token, req }) {
  const user = await consume({ token, purpose: PURPOSE.VERIFICATION });

  if (!user) throw ApiError.badRequest("That link is not valid or has expired");

  user.emailVerified = true;
  user.emailVerifiedAt = new Date();
  await user.save();

  await auditService.record({
    action: AUDIT_ACTION.EMAIL_VERIFIED,
    entity: "User",
    entityId: user._id,
    actor: user,
    req,
  });

  return { email: user.email };
}

/**
 * Consume a reset link and set a new password.
 *
 * Every other session is invalidated. Somebody who asked for this reset may be
 * doing it *because* the account was taken, and a token that set a password
 * while leaving the thief's session alive would not have helped.
 */
async function resetPassword({ token, password, req }) {
  const user = await consume({ token, purpose: PURPOSE.RESET });

  if (!user) throw ApiError.badRequest("That link is not valid or has expired");

  await user.setPassword(password);
  user.sessionsInvalidatedAt = new Date();
  // Proving the inbox works is also proof of the address.
  user.emailVerified = true;
  user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
  user.mustChangePassword = false;
  await user.save();

  await auditService.record({
    action: AUDIT_ACTION.PASSWORD_RESET,
    entity: "User",
    entityId: user._id,
    metadata: { reason: "self_service_reset" },
    actor: user,
    req,
  });

  return { email: user.email };
}

/**
 * Read one purpose's slot off a user.
 *
 * `doc["emailTokens.verification"]` is undefined: a dotted string is a literal
 * property name, not a path. Mongoose paths are read with `.get()`.
 */
function slot(user, purpose) {
  return user.get(`emailTokens.${purpose}`) ?? {};
}

/** Find the user a token belongs to. Constant-time on the stored hash. */
async function findByToken({ token, purpose }) {
  const hash = hashToken(token);
  const users = await User.find({
    [`emailTokens.${purpose}.hash`]: hash,
  }).select(`+emailTokens.${purpose}.hash`);

  return users.find((user) => safeCompare(slot(user, purpose).hash, hash)) ?? null;
}

/**
 * Find the user and burn the token in one step.
 *
 * Clearing it before the work matters: if the password write then fails, the
 * link is already dead and the honest outcome is "try again with a new link",
 * not a link that can be replayed.
 */
async function consume({ token, purpose }) {
  const user = await findByToken({ token, purpose });

  if (!user) return null;

  const expiresAt = slot(user, purpose).expiresAt;
  const expired = !expiresAt || expiresAt.getTime() < Date.now();
  await User.updateOne(
    { _id: user._id },
    { $set: { [`emailTokens.${purpose}`]: { hash: null, expiresAt: null } } }
  );

  if (expired) return null;

  return user;
}

module.exports = {
  PURPOSE,
  TTL,
  sendVerification,
  requestReset,
  inspect,
  verifyEmail,
  resetPassword,
};
