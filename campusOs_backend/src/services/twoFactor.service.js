const crypto = require("crypto");

const User = require("../models/User");
const totp = require("./totp.service");
const { getEnv } = require("../config/env");
const { ApiError } = require("../utils/ApiError");
const auditService = require("./audit.service");
const { AUDIT_ACTION } = require("../config/constants");
const { logger } = require("../config/logger");

/**
 * Two-factor authentication.
 *
 * ## The secret is sealed, because it is a password
 *
 * Whoever holds a TOTP secret can mint valid codes forever. Stored plainly, one
 * leaked database dump hands over permanent impersonation of that account with
 * no second factor left to stop it — so it is AES-256-GCM encrypted under a key
 * derived from `CSRF_SECRET`.
 *
 * shortcut: the key is derived from CSRF_SECRET rather than a dedicated
 * `TOTP_ENCRYPTION_KEY`. It is a one-line change to use a dedicated key, and it
 * only matters if the two need rotating independently.
 *
 * ## Recovery codes exist because "no second factor" is not an option
 *
 * A user who loses their phone with 2FA on and no recovery path is locked out
 * of their own account permanently. Ten single-use codes, shown once and stored
 * only as hashes, is the cheapest way to not do that to somebody.
 *
 * ## Timing is not the attack here; guessing is
 *
 * Failed attempts are counted and throttled per account. Six digits is a
 * million possibilities, which is small enough that the only thing standing
 * between an attacker and a valid account is that the code changes every thirty
 * seconds and the attempt rate does not.
 */

/** How many recovery codes a user gets. */
const RECOVERY_CODE_COUNT = 10;

/**
 * The sealing key.
 *
 * Derived rather than random so it is stable across restarts without needing to
 * be configured. `scryptSync` is used because it is deliberately slow, which is
 * the right property for a key that must not be brute-forced.
 */
function sealingKey() {
  const env = getEnv();
  return crypto.scryptSync(env.CSRF_SECRET, "campusos:totp:v1", 32);
}

/** Encrypt a TOTP secret for storage. */
function seal(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sealingKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);

  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/** Decrypt. Throws if the ciphertext was tampered with. */
function unseal(payload) {
  const [iv, tag, ciphertext] = String(payload ?? "").split(".");
  if (!iv || !tag || !ciphertext) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "The stored second factor is unreadable; it must be re-enrolled"
    );
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    sealingKey(),
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Recovery codes, as SHA-256 hashes. */
function hashRecoveryCode(code) {
  return crypto
    .createHash("sha256")
    .update(String(code).trim().toUpperCase())
    .digest("hex");
}

/**
 * Begin enrolment.
 *
 * Generates a fresh secret every time. Re-running enrolment replaces any
 * half-finished attempt rather than leaving two secrets in the user document,
 * only one of which the user knows.
 */
async function beginEnrolment({ user }) {
  const secret = totp.generateSecret();

  await User.updateOne(
    { _id: user._id },
    { $set: { "twoFactor.pendingSecret": seal(secret) } }
  );

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.TWO_FACTOR_ENROL_STARTED,
    entity: "User",
    entityId: user._id,
    metadata: {},
  });

  return {
    secret: totp.formatSecret(secret),
    rawSecret: secret,
    provisioningUri: totp.provisioningUri({
      secret,
      account: user.email,
      issuer: "CampusOS",
    }),
  };
}

/**
 * Confirm enrolment with a code from the authenticator app.
 *
 * ## The code is checked against the *pending* secret
 *
 * The pending one, because that is what was shown on screen. Confirming against
 * a stale confirmed secret would enable 2FA with an app the user never scanned.
 */
async function confirmEnrolment({ user, code }) {
  const fresh = await User.findById(user._id).select("twoFactor");
  if (!fresh?.twoFactor?.pendingSecret) {
    throw ApiError.badRequest("Start setting up your authenticator first");
  }

  const pending = unseal(fresh.twoFactor.pendingSecret);
  if (!totp.verify(pending, code)) {
    throw ApiError.badRequest(
      "That code was not accepted. Check your app and try again."
    );
  }

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    crypto.randomBytes(5).toString("hex").toUpperCase()
  );

  fresh.twoFactor = {
    enabled: true,
    encryptedSecret: fresh.twoFactor.pendingSecret,
    pendingSecret: null,
    confirmedAt: new Date(),
    recoveryCodes: recoveryCodes.map(hashRecoveryCode),
    lastUsedAt: null,
  };
  await fresh.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.TWO_FACTOR_ENABLED,
    entity: "User",
    entityId: user._id,
    metadata: { recoveryCodes: recoveryCodes.length },
  });

  // Shown exactly once. They are hashed from here on and cannot be retrieved.
  return { recoveryCodes };
}

/**
 * Turn 2FA off.
 *
 * Requires a working code, not just a session cookie. Otherwise a stolen session
 * cookie is enough to remove the very second factor that would have limited its
 * damage — which is the whole point of having it.
 */
async function disable({ user, code }) {
  if (!user.twoFactor?.enabled) {
    throw ApiError.badRequest("Two-factor is not switched on");
  }

  const ok = await checkCode({ user, code });
  if (!ok) {
    throw ApiError.badRequest("That code was not accepted, so two-factor stays on");
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        "twoFactor.enabled": false,
        "twoFactor.encryptedSecret": null,
        "twoFactor.recoveryCodes": [],
        "twoFactor.confirmedAt": null,
        "twoFactor.lastUsedAt": null,
      },
    }
  );

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.TWO_FACTOR_DISABLED,
    entity: "User",
    entityId: user._id,
    metadata: {},
  });

  return true;
}

/**
 * Is this code or recovery code good?
 *
 * Exactly one thing may be consumed per call: a recovery code is spent whether
 * or not the attempt succeeded afterwards, so a guessed-then-corrected code
 * cannot burn through somebody's whole list.
 */
async function checkCode({ user, code, at = Date.now() }) {
  const candidate = String(code ?? "").trim();
  if (!candidate) return false;

  if (user.twoFactor?.encryptedSecret) {
    try {
      const secret = unseal(user.twoFactor.encryptedSecret);
      if (totp.verify(secret, candidate, { at })) {
        await User.updateOne(
          { _id: user._id },
          { $set: { "twoFactor.lastUsedAt": new Date() } }
        );
        return true;
      }
    } catch (error) {
      logger.error({ err: error, userId: user._id }, "Stored 2FA secret unreadable");
    }
  }

  const hashed = hashRecoveryCode(candidate);
  const stored = user.twoFactor?.recoveryCodes ?? [];
  const index = stored.indexOf(hashed);

  if (index !== -1) {
    await User.updateOne(
      { _id: user._id },
      { $pull: { "twoFactor.recoveryCodes": hashed } }
    );

    await auditService.record({
      actor: user,
      action: AUDIT_ACTION.TWO_FACTOR_RECOVERY_USED,
      entity: "User",
      entityId: user._id,
      metadata: { remaining: stored.length - 1 },
    });

    return true;
  }

  return false;
}

/** Is 2FA on for this account? Safe to call with a user that may lack the field. */
function isEnabled(user) {
  return Boolean(user?.twoFactor?.enabled && user?.twoFactor?.encryptedSecret);
}

module.exports = {
  beginEnrolment,
  confirmEnrolment,
  disable,
  checkCode,
  isEnabled,
  seal,
  unseal,
  hashRecoveryCode,
  RECOVERY_CODE_COUNT,
};
