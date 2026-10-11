/**
 * Document — metadata for a file attached to a request or certificate.
 *
 * ## The file itself is not authorization
 *
 * A stored Cloudinary URL is not proof that the viewer may read the file. This
 * collection records **ownership and access rules**; the storage layer signs a
 * short-lived URL only after a caller has passed a permission check. Cloudinary
 * delivery is set to private for exactly this reason (Phase A stores metadata
 * only; binary storage arrives with the certificate slice).
 *
 * ## Validation
 *
 * File type and size are checked by content, not by the client-supplied MIME
 * type, which is attacker-controlled. Magic-byte sniffing happens in the upload
 * service; the recorded `mimeType` is the *verified* result, not the claim.
 */

const mongoose = require("mongoose");

/** MIME types the platform accepts. An allowlist, never a blocklist. */
const ALLOWED_MIME_TYPES = Object.freeze(["application/pdf", "image/jpeg", "image/png"]);

const documentSchema = new mongoose.Schema(
  {
    /**
     * Storage identifier. In Phase A this is a logical name; once Cloudinary is
     * configured it becomes the provider's asset id.
     */
    storageKey: {
      type: String,
      required: [true, "Storage key is required"],
      trim: true,
      maxlength: [300, "Storage key cannot exceed 300 characters"],
    },

    /** Name as uploaded, for display. Not used to build a path. */
    originalName: {
      type: String,
      required: [true, "Original file name is required"],
      trim: true,
      maxlength: [255, "File name cannot exceed 255 characters"],
    },

    /** Verified MIME type, sniffed from content at upload. */
    mimeType: {
      type: String,
      required: [true, "MIME type is required"],
      enum: {
        values: ALLOWED_MIME_TYPES,
        message: "`{VALUE}` is not an accepted file type",
      },
    },

    /** Size in bytes. */
    size: {
      type: Number,
      required: [true, "File size is required"],
      min: [1, "File cannot be empty"],
      max: [10 * 1024 * 1024, "File cannot exceed 10 MB"],
    },

    /** Who uploaded it. */
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /**
     * What the document belongs to. Either a request or a certificate, never
     * both — an ambiguous owner would make authorization ambiguous.
     */
    request: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Request",
      default: null,
      index: true,
    },

    certificate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Certificate",
      default: null,
      index: true,
    },

    /** Student whose record the document is about. Ownership scope. */
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },

    /** Free-text label, e.g. "ID proof". */
    label: {
      type: String,
      trim: true,
      maxlength: [120, "Label cannot exceed 120 characters"],
    },

    /**
     * Whether staff may read it. Some documents are student-only (a bank
     * statement, say) and should not be visible to every department admin.
     */
    visibility: {
      type: String,
      enum: {
        values: ["PRIVATE", "STAFF", "DEPARTMENT"],
        message: "`{VALUE}` is not a valid document visibility",
      },
      default: "STAFF",
    },

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

// Documents belonging to one request.
documentSchema.index({ request: 1, createdAt: -1 });

// Audit: everything ever uploaded by one user.
documentSchema.index({ uploadedBy: 1, createdAt: -1 });

// "Which documents does this student own?"
documentSchema.index({ student: 1, createdAt: -1 });

const Document = mongoose.model("Document", documentSchema);

module.exports = Document;
module.exports.ALLOWED_MIME_TYPES = ALLOWED_MIME_TYPES;
