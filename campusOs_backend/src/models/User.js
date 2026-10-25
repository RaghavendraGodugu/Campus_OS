/**
 * User account.
 *
 * Holds authentication identity and role only. A student's academic record
 * (roll number, department, semester) lives in the separate `Student`
 * collection so that staff never carry a student profile they do not need, and
 * so a student's record survives a role change without duplication.
 *
 * Security notes:
 *  - `passwordHash` uses `select: false`, so it is absent from every query
 *    unless explicitly requested. A forgotten `.select("+passwordHash")` is
 *    therefore a leak of nothing rather than a leak of credentials.
 *  - The refresh token tree stores *hashes*, never tokens. A database dump does
 *    not yield usable sessions.
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const { ROLES, ROLE_VALUES, STAFF_ROLES } = require("../config/constants");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      // Normalised at the schema level as well as in validators, so a value
      // written by a script cannot bypass the lower-casing rule.
      lowercase: true,
      trim: true,
      maxlength: [200, "Email cannot exceed 200 characters"],
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please provide a valid email address"],
    },

    passwordHash: {
      type: String,
      required: [true, "Password is required"],
      select: false,
    },

    /**
     * Authentication role. Authorisation decisions are derived from this on
     * every request (see utils/permissions.js); they are never read from a
     * token claim, so a role change takes effect immediately.
     */
    role: {
      type: String,
      required: true,
      enum: {
        values: ROLE_VALUES,
        message: "`{VALUE}` is not a valid role",
      },
      default: ROLES.STUDENT,
      index: true,
    },

    /**
     * Department for staff roles. Required for roles whose permissions are
     * department-scoped; null for students (whose department lives on the
     * Student profile).
     */
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: undefined,
    },

    /**
     * Which notifications this person wants.
     *
     * ## Categories, not individual types
     *
     * Fourteen notification types is a settings page nobody reads. Grouped by
     * subject — requests, complaints, certificates, finance, announcements —
     * somebody can express "don't interrupt me about money" in one tap.
     *
     * ## Defaults are stored, so "unset" is not ambiguous
     *
     * Every category is written out at creation rather than falling back to a
     * hard-coded default at read time. Otherwise turning a category on and then
     * back off would be indistinguishable from never having touched it, and the
     * "what happens if I do nothing" question would have no stable answer.
     *
     * `muted` is per-category rather than a global off switch: somebody who
     * wants silence about money but not about a certificate they are waiting on
     * should be able to say so.
     */
    /**
     * Single-use tokens for "prove you own this inbox".
     *
     * One field, not a collection: at most one verification and one reset may be
     * outstanding at a time, and asking for a new one retires the old. Storing
     * the SHA-256 hash rather than the token means a database dump yields no
     * usable links — the same reasoning as the refresh-token family.
     *
     * `purpose` keeps the two apart. A verification link must not be usable to
     * set a password, or a link that gets pasted into a chat would hand over the
     * account.
     */
    emailTokens: {
      verification: {
        hash: { type: String, default: null, select: false },
        expiresAt: { type: Date, default: null },
      },
      reset: {
        hash: { type: String, default: null, select: false },
        expiresAt: { type: Date, default: null },
      },
    },

    /**
     * Whether the address has been proven.
     *
     * Set when the verification link is used. Admin-created accounts start
     * unverified: the institute chose the address, and nobody has yet shown
     * that they can read mail there.
     */
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },

    notificationPreferences: {
      requests: { type: Boolean, default: true },
      complaints: { type: Boolean, default: true },
      certificates: { type: Boolean, default: true },
      finance: { type: Boolean, default: true },
      announcements: { type: Boolean, default: true },

      /** Bumps the bell as well as adding to the list. */
      unreadBadge: { type: Boolean, default: true },
    },

    /**
     * Two-factor authentication.
     *
     * ## The secret is encrypted at rest, not stored plainly
     *
     * A TOTP secret is a *password* — whoever holds it can mint valid codes
     * forever. A plaintext secret in a database dump means one leaked backup
     * hands over permanent impersonation of that account, with no second factor
     * left to stop it. It is sealed with AES-256-GCM under a key derived from
     * `CSRF_SECRET`, so the ciphertext is useless without an application secret
     * the backup does not contain.
     *
     * shortcut: the sealing key is derived from CSRF_SECRET rather than a
     * dedicated `TOTP_ENCRYPTION_KEY`. Upgrade path: add the dedicated key — a
     * one-line change — if the two ever need to rotate separately.
     *
     * ## `pendingSecret` until the code is confirmed
     *
     * Enrolment enables nothing. The secret sits in `pendingSecret` until a
     * code from the authenticator app comes back, so a user who abandons
     * enrolment half-way is not locked out of an app they never added.
     */
    twoFactor: {
      enabled: { type: Boolean, default: false },
      /** AES-256-GCM ciphertext of the base32 secret. Null until confirmed. */
      encryptedSecret: { type: String, default: null },
      /** Sealed, awaiting the first code. Never used to authenticate. */
      pendingSecret: { type: String, default: null },
      confirmedAt: { type: Date, default: null },
      /**
       * Recovery codes, as SHA-256 hashes.
       *
       * Hashed for the same reason a password is: they are single-use bearer
       * credentials, so a stolen list is a list of working one-time passwords.
       */
      recoveryCodes: { type: [String], default: [] },
      lastUsedAt: { type: Date, default: null },
    },

    /**
     * Profile picture.
     *
     * Held as a storage key, never as a URL or a data blob. The key is an
     * unguessable path; a URL would be a public address for somebody's face that
     * nobody chose to publish, and a blob would put an image in the user
     * document and in every query that does not need it.
     *
     * Images go through the same adapter as documents, which routes them to
     * Cloudinary's `image` pipeline — so an avatar is transcoded and resized on
     * delivery rather than served at whatever size it was uploaded.
     */
    avatar: {
      storageKey: { type: String, default: null },
      mimeType: { type: String, default: null },
      bytes: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },

    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      maxlength: [150, "Name cannot exceed 150 characters"],
    },

    phone: {
      type: String,
      trim: true,
      maxlength: [20, "Phone number cannot exceed 20 characters"],
    },

    /**
     * A staff member's title — "Associate Professor", not a job description.
     *
     * Staff-owned (changed on the profile page) because a title is what a
     * person is introduced as, not institutional truth like a role. Students
     * hold none, and the directory displays it beside their name.
     */
    designation: {
      type: String,
      trim: true,
      maxlength: [120, "Designation cannot exceed 120 characters"],
      default: "",
    },

    /**
     * The areas a staff member can speak for, self-declared.
     *
     * Normalised by the setter: trimmed, case-folded only for the duplicate
     * check, deduplicated, [] for nothing. The directory's skill search reads
     * this array directly, so a profile that says "Machine Learning" is findable
     * by a student searching "machine learning" without an index to maintain.
     */
    expertise: {
      type: [String],
      set(values) {
        if (!Array.isArray(values)) return [];
        const seen = new Set();
        return values
          .map((value) => String(value).trim())
          .filter((value) => value.length > 0)
          .filter((value) => {
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 12);
      },
      default: [],
      validate: {
        validator(values) {
          return values.every((value) => value.length <= 40);
        },
        message: "Each skill must be at most 40 characters",
      },
    },

    /**
     * Set for users whose profile is owned by a Student document. Enforced so
     * a staff account can never be linked to a student record (privilege
     * confusion).
     */
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: undefined,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    /**
     * Set when an administrator provisions the account and hands over a
     * generated temporary password.
     *
     * The alternative — letting the administrator choose the first password —
     * means the institute holds a credential that works for a real person, and
     * it is usually chosen once and never rotated. A generated one is shown to
     * the administrator exactly once, is never stored in plaintext, and this
     * flag makes the account useless until its owner replaces it.
     *
     * Cleared by `changePassword`, never by the person signing in.
     */
    mustChangePassword: {
      type: Boolean,
      default: false,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    /**
     * Forced logout of every session for this user. Set when a password is
     * changed or an admin revokes access; all refresh tokens are rejected until
     * the field is cleared.
     */
    sessionsInvalidatedAt: {
      type: Date,
      default: null,
    },

    /**
     * Refresh token tree (spec §8: rotating refresh with reuse detection).
     *
     * Each entry is one *device session*. `tokenHash` is a SHA-256 of the
     * refresh token — enough to detect reuse, useless to an attacker.
     *
     *  - On refresh, the presented token is revoked and a new one is issued.
     *  - If an already-revoked token is presented, the whole family is revoked:
     *    either the legitimate client retried, or a thief replayed a stolen
     *    token. We cannot tell which, so we end every session for the user.
     */
    refreshTokens: [
      {
        tokenHash: { type: String, required: true },
        /** Identifies the device session; stable across rotations. */
        sessionId: { type: String, required: true },
        /** Groups a rotation chain so reuse of any member is detectable. */
        familyId: { type: String, required: true },
        device: { type: String, default: "" },
        userAgent: { type: String, default: "" },
        ip: { type: String, default: "" },
        issuedAt: { type: Date, required: true },
        expiresAt: { type: Date, required: true },
        revokedAt: { type: Date, default: null },
        // Why this token was revoked: "rotated", "logout", "reuse", "admin".
        revokedReason: { type: String, default: null },
      },
    ],
  },
  {
    timestamps: true,
    // A user document is small; optimistic concurrency is not worth the
    // VersionKey overhead here. Updates use atomic $set / $pull instead.
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        // Never let credentials leave the model, whatever a caller does.
        delete ret.passwordHash;
        delete ret.refreshTokens;
        delete ret.sessionsInvalidatedAt;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// ===== Indexes =====

/**
 * Note: `unique: true` on the `email` field definition already creates its
 * unique index, so it is not redeclared here (a duplicate would be ignored
 * with a warning).
 *
 * Backs the management "list staff by department" screen.
 */
userSchema.index({ department: 1, role: 1 });

/** Expired sessions are removed by a periodic sweep. */
userSchema.index({ "refreshTokens.expiresAt": 1 });

// ===== Virtuals =====

/** True when the account is a staff member (i.e. not a student). */
userSchema.virtual("isStaff").get(function isStaff() {
  return STAFF_ROLES.includes(this.role);
});

/** True when the role's permissions are scoped to a department. */
userSchema.virtual("isDepartmentScoped").get(function isDepartmentScoped() {
  return [
    ROLES.FACULTY,
    ROLES.HOD,
    ROLES.SUPPORT_STAFF,
    ROLES.EXAM_ADMIN,
    ROLES.ACCOUNTS_ADMIN,
    ROLES.HOSTEL_ADMIN,
    ROLES.LIBRARY_ADMIN,
    ROLES.PLACEMENT_ADMIN,
  ].includes(this.role);
});

// ===== Methods =====

/**
 * Hash a plaintext password for storage.
 * @param {string} plainText
 * @returns {Promise<string>} bcrypt hash
 */
userSchema.methods.setPassword = async function setPassword(plainText) {
  // Cost 12 is the current sensible default: ~250ms per hash on commodity
  // hardware, which is expensive enough to blunt offline cracking while
  // staying acceptable for an interactive login.
  this.passwordHash = await bcrypt.hash(plainText, 12);
};

/**
 * Compare a candidate password against the stored hash.
 *
 * Always performs the comparison, even when no user matched, so that a
 * missing account and a wrong password take comparable time. Without this,
 * response latency reveals whether an email is registered.
 *
 * @param {string} plainText
 * @returns {Promise<boolean>}
 */
userSchema.methods.verifyPassword = async function verifyPassword(plainText) {
  if (!this.passwordHash) {
    // No-op hash comparison to equalise timing.
    await bcrypt.compare(plainText, "$2b$12$" + "x".repeat(53));
    return false;
  }
  return bcrypt.compare(plainText, this.passwordHash);
};

/** Shape returned to the client. Single definition, used by every endpoint. */
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    email: this.email,
    fullName: this.fullName,
    role: this.role,
    phone: this.phone ?? null,
    // Staff-only self-descriptive fields; undefined for students so the
    // payload does not change shape for them.
    designation: this.designation || undefined,
    expertise: Array.isArray(this.expertise) && this.expertise.length > 0 ? this.expertise : undefined,
    department: this.department ?? null,
    student: this.student ?? null,
    isActive: this.isActive,
    /**
     * Whether a picture exists — never the storage key.
     *
     * The key is an unguessable path, and every read of a user would otherwise
     * carry a handle to their file. The client needs to know whether to render
     * a picture or a monogram; it fetches the bytes from the endpoint when it
     * does.
     */
    hasAvatar: Boolean(this.avatar?.storageKey),
    /**
     * Reported so a provisioned account can be held at the password screen
     * until its owner replaces the generated one. It describes the account
     * being returned, never anyone else's.
     */
    mustChangePassword: this.mustChangePassword ?? false,
    /**
     * Whether the address is proven, and when. Enough for the account holder to
     * see; the tokens themselves are `select: false` and never leave the server.
     */
    emailVerified: this.emailVerified ?? false,
    /**
     * Whether a second factor is active — the person reading their own profile
     * needs this to show the settings. It says nothing an account holder does
     * not already know, and the secret and recovery codes stay server-side.
     */
    twoFactorEnabled: Boolean(this.twoFactor?.enabled),
    lastLoginAt: this.lastLoginAt ?? null,
    createdAt: this.createdAt,
  };
};

/**
 * Drop revoked and expired session entries.
 *
 * Bounded to the caller's document size; the session list is capped in the
 * auth service, so this cannot grow without bound.
 */
userSchema.methods.pruneRefreshTokens = function pruneRefreshTokens() {
  const now = new Date();
  this.refreshTokens = this.refreshTokens.filter(
    (entry) => !entry.revokedAt && entry.expiresAt > now
  );
  return this;
};

const User = mongoose.model("User", userSchema);

module.exports = User;
