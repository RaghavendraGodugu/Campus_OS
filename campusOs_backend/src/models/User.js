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
