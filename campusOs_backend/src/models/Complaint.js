/**
 * Complaint — a grievance or grievance-like report.
 *
 * ## Confidentiality is enforced in the query, not the view
 *
 * A confidential complaint (sexual harassment, safety, financial misconduct) is
 * readable by exactly three audiences: the complainant, the assigned handler,
 * and roles holding `complaint:read:confidential` (Dean, Principal). Everyone
 * else receives a 404 — identical to the response for a record that does not
 * exist, so ids cannot be probed to discover that a grievance was filed.
 *
 * This is why `confidential` is a query predicate in `complaint.service.js`
 * rather than a field the UI hides.
 *
 * ## SLA is a policy, not a constant
 *
 * `dueAt` is computed once at submission from the category's configured policy
 * and the institution's business calendar (see utils/sla.js). The deadline is
 * stored rather than derived so that a later policy change does not silently
 * move a deadline a student is already relying on.
 */

const mongoose = require("mongoose");

const {
  COMPLAINT_STATUS,
  COMPLAINT_STATUS_VALUES,
  COMPLAINT_PRIORITY,
  COMPLAINT_PRIORITY_VALUES,
} = require("../config/constants");

const complaintSchema = new mongoose.Schema(
  {
    /** Human-readable reference, e.g. "CMP-2026-000042". */
    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    /**
     * Complainant. The owner of the record.
     *
     * Not always present: an anonymous grievance is filed without an account,
     * and there is deliberately nothing else on the record that identifies who
     * wrote it. The requirement is therefore conditional rather than absolute.
     */
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
      index: true,
    },

    /**
     * Filed without an account.
     *
     * The consequences are real and are stated to the person before they file,
     * not discovered afterwards: there is no one to contact, nothing can be
     * discussed by email, and the office cannot ask a follow-up question.
     */
    isAnonymous: {
      type: Boolean,
      default: false,
      index: true,
    },

    /**
     * Hash of the tracking code, never the code itself.
     *
     * Stored hashed so that a database dump does not hand over working
     * tracking codes — with them, anyone could read the status of somebody
     * else's grievance. The code itself is shown once, at filing, and the
     * complainant keeps it. Lookups hash what they type and match on the
     * digest, so the stored value is useless without the code.
     *
     * Indexed, because it is a lookup key.
     */
    trackingCodeHash: {
      type: String,
      default: null,
      index: true,
      sparse: true,
      select: false,
    },

    /**
     * Free-text account of what happened.
     *
     * Deliberately stored as submitted: a grievance's credibility can rest on
     * the original wording, so this is not normalised or rewritten.
     */
    subject: {
      type: String,
      required: [true, "Subject is required"],
      trim: true,
      maxlength: [200, "Subject cannot exceed 200 characters"],
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: [5000, "Description cannot exceed 5000 characters"],
    },

    category: {
      type: String,
      required: [true, "Category is required"],
      enum: {
        values: [
          "ACADEMICS",
          "FEES",
          "SCHOLARSHIP",
          "HOSTEL",
          "MESS",
          "TRANSPORT",
          "LIBRARY",
          "INFRASTRUCTURE",
          "IT",
          "MAINTENANCE",
          "PLACEMENTS",
          "SAFETY",
          "HARASSMENT",
          "MISCONDUCT",
          "OTHER",
        ],
        message: "`{VALUE}` is not a valid complaint category",
      },
      index: true,
    },

    /**
     * Finer classification within the category.
     * Free-form because departments define their own sub-categories.
     */
    subCategory: {
      type: String,
      trim: true,
      maxlength: [100, "Sub-category cannot exceed 100 characters"],
    },

    /**
     * Whether this complaint is restricted.
     *
     * Defaults to `true` for the categories that are inherently sensitive.
     * This is a default rather than a client input: a student must not be able
     * to downgrade a harassment complaint to a public one by flipping a flag,
     * and must not be able to file a "sensitive" complaint designed to bypass
     * ordinary routing either — the escalation path is available to everyone.
     */
    confidential: {
      type: Boolean,
      default: function () {
        return ["SAFETY", "HARASSMENT", "MISCONDUCT"].includes(this.category);
      },
      index: true,
    },

    priority: {
      type: String,
      required: [true, "Priority is required"],
      enum: {
        values: COMPLAINT_PRIORITY_VALUES,
        message: "`{VALUE}` is not a valid priority",
      },
      default: COMPLAINT_PRIORITY.MEDIUM,
      index: true,
    },

    /** Department currently responsible for handling. */
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },

    /** Staff member currently handling it. */
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    status: {
      type: String,
      required: true,
      enum: {
        values: COMPLAINT_STATUS_VALUES,
        message: "`{VALUE}` is not a valid complaint status",
      },
      default: COMPLAINT_STATUS.OPEN,
      index: true,
    },

    /** Append-only transition trail. Same guarantees as Request.statusHistory. */
    statusHistory: [
      {
        from: {
          type: String,
          enum: { values: [...COMPLAINT_STATUS_VALUES, null], message: "Invalid status" },
          default: null,
        },
        to: { type: String, required: true, enum: { values: COMPLAINT_STATUS_VALUES } },
        /**
         * Who moved it.
         *
         * Not always anybody: the opening entry of an anonymous grievance was
         * made by whoever filed it, and there is deliberately no record of
         * them. Those two fields are therefore optional, and their absence is
         * itself the fact — the entry records that the report arrived with no
         * one attached.
         */
        actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        actorRole: { type: String, default: null },
        note: {
          type: String,
          trim: true,
          maxlength: [1000, "Note cannot exceed 1000 characters"],
        },
        at: { type: Date, required: true, default: Date.now },
      },
    ],

    /** Student-visible updates. Staff must not put internal notes here. */
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
        /**
         * A confidential complaint may still have updates; they are simply
         * visible to a smaller audience (the query enforces it).
         */
        at: { type: Date, required: true, default: Date.now },
      },
    ],

    /** Internal investigation notes. Never returned to the complainant. */
    internalNotes: [
      {
        author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        body: {
          type: String,
          required: true,
          trim: true,
          maxlength: [2000, "Note cannot exceed 2000 characters"],
        },
        at: { type: Date, required: true, default: Date.now },
      },
    ],

    /** Resolution summary. Written when status becomes RESOLVED. */
    resolution: {
      type: String,
      trim: true,
      maxlength: [3000, "Resolution cannot exceed 3000 characters"],
    },

    resolvedAt: { type: Date, default: null },

    /**
     * Whether the student may still reopen.
     *
     * Set when resolved, cleared on reopen. A resolution is not the end of the
     * matter if the student says it is not (spec §10, reopening rules).
     */
    canReopen: { type: Boolean, default: false },

    /** Student feedback on the outcome. */
    feedback: {
      rating: { type: Number, min: 1, max: 5, default: null },
      satisfied: { type: Boolean, default: null },
      comment: {
        type: String,
        trim: true,
        maxlength: [1000, "Feedback cannot exceed 1000 characters"],
        default: null,
      },
      at: { type: Date, default: null },
    },

    // ===== SLA =====

    /**
     * Response deadline, computed at submission from the configured policy and
     * business calendar. Stored, not derived, so a later policy change cannot
     * move a deadline a student is already relying on.
     */
    dueAt: { type: Date, default: null },

    /** When the clock stops: first staff response, or resolution. */
    respondedAt: { type: Date, default: null },

    /** Business minutes by which the deadline was missed; 0 when met. */
    slaBreachMinutes: {
      type: Number,
      default: 0,
      min: [0, "Breach minutes cannot be negative"],
    },

    /**
     * Escalation ledger.
     *
     * Each entry records one escalation. The `escalatedAtLevel` plus
     * `dedupeKey` combination lets the escalation job run repeatedly without
     * producing duplicate escalations — a retry sees the existing entry and
     * stops.
     */
    escalations: [
      {
        level: { type: Number, required: true, min: 1 },
        escalatedAt: { type: Date, required: true, default: Date.now },
        escalatedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reason: {
          type: String,
          trim: true,
          maxlength: [500, "Reason cannot exceed 500 characters"],
        },
        /** Prevents duplicate escalation and duplicate notifications on retry. */
        dedupeKey: { type: String, required: true },
        /** True when raised by the scheduled job, false when done manually. */
        automatic: { type: Boolean, default: true },
      },
    ],

    /** Highest escalation level reached, so the job does not re-escalate. */
    escalationLevel: { type: Number, default: 0, min: 0 },

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

// ===== Indexes =====

// The triage queue: open work in a department, oldest first.
complaintSchema.index({ department: 1, status: 1, submittedAt: 1 });

// Institution oversight for a category.
complaintSchema.index({ category: 1, status: 1, createdAt: -1 });

// The complainant's own list.
complaintSchema.index({ student: 1, createdAt: -1 });

/**
 * The escalation sweep: unacknowledged, unresolved, past deadline.
 *
 * A compound predicate would be more selective, but this partial index covers
 * exactly the set the job scans, so the job does not read the whole collection.
 */
complaintSchema.index(
  { dueAt: 1 },
  {
    name: "complaint_overdue_scan",
    partialFilterExpression: {
      respondedAt: null,
      resolvedAt: null,
    },
  }
);

/**
 * Confidentiality query support.
 *
 * Every read filters on `confidential`; this index serves both the
 * `confidential: false` list and the restricted list.
 */
/**
 * A grievance that is not anonymous must belong to somebody; an anonymous one
 * must not.
 *
 * Expressed as a validator rather than a field-level `required`, because the
 * rule is about the pair. Field-level requiredness cannot say "this one, unless
 * that flag is set".
 */
complaintSchema.pre("validate", function hasComplainant() {
  // Synchronous: Mongoose's document middleware here takes no callback, so
  // throwing is how a hook reports a problem.
  if (this.isAnonymous) {
    if (this.student) {
      throw new Error("An anonymous grievance cannot be tied to a student account");
    }
    return;
  }

  if (!this.student) {
    throw new Error("Complaint must belong to a student");
  }
});

complaintSchema.index({ confidential: 1, department: 1, status: 1 });
/** The officer's queue for anonymous grievances. */
complaintSchema.index({ isAnonymous: 1, status: 1, submittedAt: 1 });

const Complaint = mongoose.model("Complaint", complaintSchema);

module.exports = Complaint;
module.exports.SENSITIVE_CATEGORIES = Object.freeze([
  "SAFETY",
  "HARASSMENT",
  "MISCONDUCT",
]);
module.exports.ALL_CATEGORIES = Object.freeze([
  "ACADEMICS",
  "FEES",
  "SCHOLARSHIP",
  "HOSTEL",
  "MESS",
  "TRANSPORT",
  "LIBRARY",
  "INFRASTRUCTURE",
  "IT",
  "MAINTENANCE",
  "PLACEMENTS",
  "SAFETY",
  "HARASSMENT",
  "MISCONDUCT",
  "OTHER",
]);
