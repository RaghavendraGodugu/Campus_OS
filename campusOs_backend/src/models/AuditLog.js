/**
 * Audit log.
 *
 * Append-only record of privileged actions (spec §8, §13). Every entry names
 * who did what to which resource, when, and from where.
 *
 * Confidentiality: the complaint body is *not* stored in `metadata`. Only
 * non-sensitive identifiers go in, so reading the audit trail can never leak a
 * grievance's contents to someone who could not see the complaint itself.
 * See `services/audit.service.js`, which owns that decision.
 *
 * Immutability: the schema exposes no update path. Writes go through
 * `AuditLog.record()`; corrections are new entries, never edits, so the trail
 * remains trustworthy as evidence.
 */

const mongoose = require("mongoose");

const { AUDIT_ACTION, ROLE_VALUES } = require("../config/constants");

/**
 * Metadata is `Mixed` but bounded: it must stay a small identification
 * summary, never a copy of the resource. Capped at 200 keys of scalar values.
 */
const auditLogSchema = new mongoose.Schema(
  {
    /** Who performed the action. Null for system/webhook-initiated events. */
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    /** Denormalised so the trail stays readable if the user is deleted. */
    actorEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },

    actorRole: {
      type: String,
      enum: {
        values: [...ROLE_VALUES, "SYSTEM"],
        message: "`{VALUE}` is not a valid actor role",
      },
      default: "SYSTEM",
    },

    action: {
      type: String,
      required: [true, "Action is required"],
      enum: {
        values: Object.values(AUDIT_ACTION),
        message: "`{VALUE}` is not a valid audit action",
      },
      index: true,
    },

    /** Logical resource type, e.g. "Request", "Payment". */
    entity: {
      type: String,
      required: [true, "Entity type is required"],
      trim: true,
      uppercase: true,
      maxlength: [40, "Entity type cannot exceed 40 characters"],
    },

    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    /** Human-readable reference (e.g. "REQ-2026-000123"). */
    entityRef: {
      type: String,
      trim: true,
      maxlength: [60, "Entity reference cannot exceed 60 characters"],
    },

    /**
     * Non-sensitive context: before/after status, changed field names, reason
     * codes. Never free-text complaint or document contents.
     */
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /** Request correlation id, linking the entry to server logs. */
    requestId: {
      type: String,
      trim: true,
      maxlength: [64, "Request id cannot exceed 64 characters"],
    },

    ip: {
      type: String,
      trim: true,
      maxlength: [64, "IP cannot exceed 64 characters"],
    },

    userAgent: {
      type: String,
      trim: true,
      maxlength: [300, "User agent cannot exceed 300 characters"],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
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

// ===== Indexes =====

/** "Full history for this resource" — the primary audit-trail query. */
auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });

/** "Everything this user did" — accountability query. */
auditLogSchema.index({ actor: 1, createdAt: -1 });

/**
 * Report queries are always time-bounded, so the timestamp leads.
 * Also supports the retention sweep.
 */
auditLogSchema.index({ createdAt: -1 });

/**
 * Backs the access-denied investigation trail specifically — the query run when
 * investigating a suspected data-access incident.
 *
 * Named explicitly because it shares keys with the `{actor, createdAt}` index
 * above: without an explicit name MongoDB would auto-generate the identical
 * name `actor_1_createdAt_-1` for both and refuse to create the second.
 */
auditLogSchema.index(
  { actor: 1, createdAt: -1 },
  {
    name: "audit_denied_trail",
    partialFilterExpression: { action: AUDIT_ACTION.ACCESS_DENIED },
  }
);

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

module.exports = AuditLog;