/**
 * Request — a student's application for an institutional service.
 *
 * This is the centre of CampusOS: every student problem becomes one record with
 * one owner, one workflow, one status and one auditable resolution.
 *
 * ## Status is never assigned freely
 *
 * `status` is written **only** by `workflow.service.js`, which validates the
 * move against the transition table in `utils/workflow.js` and performs the
 * write with the expected current status in the filter (optimistic
 * concurrency). A handler cannot set `status` directly, and the API exposes no
 * field that would let a client do so — validators reject `status` in request
 * bodies with `.strict()`.
 *
 * ## Append-only history
 *
 * `statusHistory` records every transition with actor and timestamp. It is never
 * edited or removed, so the trail remains trustworthy as evidence.
 */

const mongoose = require("mongoose");

const { REQUEST_STATUS } = require("../config/constants");

const requestSchema = new mongoose.Schema(
  {
    /**
     * Human-readable reference, e.g. "REQ-2026-000123".
     * Unique, so two concurrent submissions can never collide on it.
     */
    reference: {
      type: String,
      required: [true, "Reference is required"],
      unique: true,
      trim: true,
      index: true,
    },

    /** The catalogue entry this was submitted against. */
    requestType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RequestType",
      required: [true, "Request type is required"],
      index: true,
    },

    /** Student who submitted it. Authoritative ownership link. */
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Request must belong to a student"],
      index: true,
    },

    /**
     * Owning department, denormalised from the RequestType at submission time.
     *
     * Deliberate duplication: approval routing and every departmental filter
     * depend on it, and a request must keep its original route even if the
     * catalogue entry is later re-pointed at another department.
     */
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Department is required"],
      index: true,
    },

    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },

    /**
     * Values for the request type's declared fields.
     *
     * Free-form by design, because the field list is admin-defined at runtime;
     * validation against that list happens in the service layer, which knows
     * which type was submitted.
     */
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /** Optional cover note from the student. */
    description: {
      type: String,
      trim: true,
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },

    status: {
      type: String,
      required: [true, "Status is required"],
      enum: {
        values: Object.values(REQUEST_STATUS),
        message: "`{VALUE}` is not a valid request status",
      },
      default: REQUEST_STATUS.SUBMITTED,
      index: true,
    },

    /** Staff member currently responsible. Single owner, by design. */
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    /**
     * Append-only transition trail.
     *
     * Each entry records who moved the request, from where, to where, when, and
     * why. Entries are never mutated — a mistake is corrected by a new entry,
     * not by editing history.
     */
    statusHistory: [
      {
        from: {
          type: String,
          enum: {
            values: [...Object.values(REQUEST_STATUS), null],
            message: "`{VALUE}` is not a valid status",
          },
          default: null,
        },
        to: {
          type: String,
          required: true,
          enum: {
            values: Object.values(REQUEST_STATUS),
            message: "`{VALUE}` is not a valid status",
          },
        },
        actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        actorRole: { type: String, required: true },
        reason: {
          type: String,
          trim: true,
          maxlength: [1000, "Reason cannot exceed 1000 characters"],
        },
        at: { type: Date, required: true, default: Date.now },
      },
    ],

    /**
     * Student-visible conversation.
     *
     * Internal staff notes live in `internalNotes` and are filtered out of every
     * student-facing read — not merely hidden in the UI.
     */
    comments: [
      {
        author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        authorRole: { type: String, required: true },
        body: {
          type: String,
          required: [true, "Comment body is required"],
          trim: true,
          maxlength: [2000, "Comment cannot exceed 2000 characters"],
        },
        at: { type: Date, required: true, default: Date.now },
      },
    ],

    /** Staff-only notes. Never returned to a student. */
    internalNotes: [
      {
        author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        body: {
          type: String,
          required: [true, "Note body is required"],
          trim: true,
          maxlength: [2000, "Note cannot exceed 2000 characters"],
        },
        at: { type: Date, required: true, default: Date.now },
      },
    ],

    /** Attached document references. See Document.js. */
    documents: [{ type: mongoose.Schema.Types.ObjectId, ref: "Document" }],

    /**
     * Which approval step is currently outstanding. Null until the request
     * enters approval.
     */
    currentApprovalStep: {
      type: Number,
      default: null,
      min: [0, "Approval step cannot be negative"],
    },

    /** Resolution summary. Written when the request reaches COMPLETED. */
    resolution: {
      type: String,
      trim: true,
      maxlength: [2000, "Resolution cannot exceed 2000 characters"],
    },

    /** Student feedback on the outcome; null until submitted. */
    feedback: {
      rating: {
        type: Number,
        min: [1, "Rating must be at least 1"],
        max: [5, "Rating cannot exceed 5"],
        default: null,
      },
      comment: {
        type: String,
        trim: true,
        maxlength: [1000, "Feedback comment cannot exceed 1000 characters"],
        default: null,
      },
      at: { type: Date, default: null },
    },

    /** Advisory response deadline, derived from the type's SLA. */
    dueAt: { type: Date, default: null },

    submittedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    isActive: { type: Boolean, default: true, index: true },
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

// ===== Indexes =====

// The management work queue: "my assigned open work, oldest first".
requestSchema.index({ assignedTo: 1, status: 1, submittedAt: 1 });

// Departmental oversight: "everything in my department, newest first".
requestSchema.index({ department: 1, status: 1, createdAt: -1 });

// The student's own list.
requestSchema.index({ student: 1, createdAt: -1 });

// Reports by type over time.
requestSchema.index({ requestType: 1, createdAt: -1 });

// Overdue sweep (Phase B SLA job).
requestSchema.index({ status: 1, dueAt: 1 });

const Request = mongoose.model("Request", requestSchema);

module.exports = Request;
