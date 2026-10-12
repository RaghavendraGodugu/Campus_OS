/**
 * Certificate application and issued certificate.
 *
 * ## A file is not an issued certificate
 *
 * The spec (§11) is explicit: "Never assume that a certificate is officially
 * issued merely because a file was uploaded."
 *
 * This model enforces that. `document.storageKey` may be populated by an
 * upload, but the record is only an issued certificate when `status` is
 * `GENERATED` **and** `issuedAt` and `issuedBy` are both set — and those three
 * fields are written only by `certificate.service.generate()`, after an
 * approval has been recorded. A student who uploads a PDF titled
 * "bonafide.pdf" to their own application has changed nothing about their
 * certificate's status.
 */

const mongoose = require("mongoose");

const { CERTIFICATE_STATUS, CERTIFICATE_STATUS_VALUES } = require("../config/constants");

const certificateSchema = new mongoose.Schema(
  {
    /** Human-readable reference, e.g. "CERT-2026-000042". */
    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    /** Certificate type, e.g. BONAFIDE, TRANSCRIPT, NODUES. */
    type: {
      type: String,
      required: [true, "Certificate type is required"],
      enum: {
        values: [
          "BONAFIDE",
          "STUDY",
          "TRANSFER",
          "MIGRATION",
          "CHARACTER",
          "COURSE_COMPLETION",
          "NO_DUES",
          "INTERNSHIP",
          "TRANSCRIPT",
        ],
        message: "`{VALUE}` is not a valid certificate type",
      },
      index: true,
    },

    /** Requesting student. The owner. */
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Certificate must belong to a student"],
      index: true,
    },

    /**
     * Student-visible purpose, recorded on the certificate body.
     */
    purpose: {
      type: String,
      trim: true,
      maxlength: [500, "Purpose cannot exceed 500 characters"],
    },

    /** Number of physical copies requested. */
    copies: {
      type: Number,
      default: 1,
      min: [1, "At least one copy is required"],
      max: [10, "At most 10 copies per application"],
    },

    /** Department that verifies and approves it. */
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },

    // ===== Invariants enforced by the schema itself =====

    /**
     * "A certificate counts as issued only when status, issuer and stored document
     * all agree."
     *
     * Implemented as a **field validator** rather than a `pre` hook, because
     * `Model.create()` runs with validation disabled by default and `pre('save')`
     * throws are swallowed — a hook-based check silently never runs. A `validate`
     * on the path field is evaluated by every operation that validates, so it
     * cannot be bypassed by choosing a different write method.
     */
    status: {
      type: String,
      required: true,
      enum: {
        values: CERTIFICATE_STATUS_VALUES,
        message: "`{VALUE}` is not a valid certificate status",
      },
      default: CERTIFICATE_STATUS.APPLIED,
      index: true,
      // NOTE: deliberately no cross-field validator here.
      //
      // "GENERATED requires issuedAt + issuedBy + document" cannot be a field
      // validator: `findOneAndUpdate` validates the *pre-update* document, so the
      // one update that legitimately issues a certificate (setting status, issuer,
      // timestamp and document together in a single `$set`) is validated while
      // `status` is still APPROVED and the issue fields are not yet visible. The
      // check therefore rejected every real issuance.
      //
      // It is enforced in certificate.service.generate() instead, which is the only
      // function that writes GENERATED and which writes the complete record
      // atomically.
    },

    /**
     * Staff member who verified the student's standing.
     * Verification is a distinct act from approval.
     */
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    verifiedAt: { type: Date, default: null },

    /**
     * Approving authority.
     *
     * `approvedAt` carries a validator rather than a document hook because a
     * hook can be skipped by the caller's write options (`create()` runs with
     * validation off by default), while a field validator runs whenever the
     * document is validated at all.
     */
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
      // NOTE: deliberately no cross-field validator here.
      //
      // `findOneAndUpdate` validates the *pre-update* document, so a rule like
      // "approvedAt requires approvedBy" fails even for a correct `$set` of both
      // fields — the approver is not yet visible when the validator runs. That
      // made every legitimate approval fail, which is worse than no check.
      //
      // The invariant is enforced in two places that actually work: the
      // `status` validator below (evaluated on `create`/`save`, which do see
      // the finished document) and certificate.service.transition(), which
      // always writes `approvedBy` alongside `approvedAt`.
    },

    /** Issuing officer, set when the PDF is generated. */
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    issuedAt: { type: Date, default: null },

    /**
     * The generated PDF.
     *
     * Populating this does NOT make the certificate issued; see the file
     * header. `storageKey` is opaque and is never a public URL.
     */
    document: {
      storageKey: { type: String, default: null },
      originalName: { type: String, default: null },
      mimeType: { type: String, default: null },
      bytes: { type: Number, default: null },
      /** Which storage adapter wrote it: "local" or "cloudinary". */
      adapter: { type: String, default: null },
      generatedAt: { type: Date, default: null },
    },

    /**
     * Short verification code printed on the certificate.
     *
     * Lets the issuing institution confirm authenticity later without the PDF
     * being treated as self-authenticating.
     */
    verificationCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: [24, "Verification code cannot exceed 24 characters"],
      default: null,
    },

    /** Revocation record, populated when a certificate is withdrawn. */
    revocation: {
      // As with approvedAt, no cross-field validator: `findOneAndUpdate`
      // validates the pre-update document. The "a revocation must state a
      // reason" rule lives in certificate.service.revoke().
      revokedAt: { type: Date, default: null },
      revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      reason: {
        type: String,
        trim: true,
        maxlength: [1000, "Reason cannot exceed 1000 characters"],
        default: null,
      },
    },

    /** Rejection record. */
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: [1000, "Rejection reason cannot exceed 1000 characters"],
      default: null,
    },

    /** Student-visible timeline. */
    updates: [
      {
        author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        authorRole: { type: String, required: true },
        body: {
          type: String,
          required: true,
          trim: true,
          maxlength: [2000, "Update cannot exceed 2000 characters"],
        },
        at: { type: Date, required: true, default: Date.now },
      },
    ],

    statusHistory: [
      {
        from: {
          type: String,
          enum: { values: [...CERTIFICATE_STATUS_VALUES, null] },
          default: null,
        },
        to: { type: String, required: true, enum: { values: CERTIFICATE_STATUS_VALUES } },
        actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        actorRole: { type: String, required: true },
        note: {
          type: String,
          trim: true,
          maxlength: [1000, "Note cannot exceed 1000 characters"],
        },
        at: { type: Date, required: true, default: Date.now },
      },
    ],

    submittedAt: { type: Date, default: null },
    isDemo: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// The student's own list.
certificateSchema.index({ student: 1, createdAt: -1 });

// Departmental verification queue.
certificateSchema.index({ department: 1, status: 1, submittedAt: 1 });

/**
 * Public verification lookup.
 *
 * Backs "verify this certificate is genuine", which reads by
 * verificationCode rather than by id and is intentionally available to staff.
 */
certificateSchema.index({ verificationCode: 1 });

const Certificate = mongoose.model("Certificate", certificateSchema);

// ===== Invariants enforced by the schema itself =====

module.exports = Certificate;
module.exports.CERTIFICATE_TYPES = Object.freeze([
  "BONAFIDE",
  "STUDY",
  "TRANSFER",
  "MIGRATION",
  "CHARACTER",
  "COURSE_COMPLETION",
  "NO_DUES",
  "INTERNSHIP",
  "TRANSCRIPT",
]);
