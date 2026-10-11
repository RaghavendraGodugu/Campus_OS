/**
 * Request type — the catalogue of applications a student may submit.
 *
 * Administered data, not code: the college decides which services exist, which
 * fields they collect, and who approves them. Adding "no-dues certificate" must
 * not require a deploy.
 *
 * The form definition (`fields`) is validated on write so a malformed
 * definition cannot produce an unusable submission form at runtime.
 */

const mongoose = require("mongoose");

const requestTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Request type name is required"],
      unique: true,
      trim: true,
      maxlength: [150, "Name cannot exceed 150 characters"],
    },

    /** Short code used in reference numbers, e.g. "BONAFIDE". */
    code: {
      type: String,
      required: [true, "Request type code is required"],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [30, "Code cannot exceed 30 characters"],
      match: [/^[A-Z0-9_]+$/, "Code must contain only letters, numbers and underscores"],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },

    /**
     * Department that owns and routes this request. Drives the HOD approval
     * scope, so a request routed to the wrong department would be approved by
     * the wrong person.
     */
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Request type must belong to a department"],
      index: true,
    },

    /**
     * Form fields collected from the student.
     *
     * Each entry describes one input. Validated as a whole array so a bad
     * definition fails at write time rather than producing a broken form.
     */
    fields: {
      type: [
        {
          name: {
            type: String,
            required: [true, "Field name is required"],
            trim: true,
            match: [/^[a-zA-Z][a-zA-Z0-9_]*$/, "Field name must be a valid identifier"],
          },
          label: {
            type: String,
            required: [true, "Field label is required"],
            trim: true,
            maxlength: [120, "Field label cannot exceed 120 characters"],
          },
          type: {
            type: String,
            required: [true, "Field type is required"],
            enum: {
              values: ["TEXT", "TEXTAREA", "NUMBER", "DATE", "SELECT", "BOOLEAN"],
              message: "`{VALUE}` is not a supported field type",
            },
          },
          required: { type: Boolean, default: false },
          /** Allowed values when type is SELECT. */
          options: {
            type: [String],
            default: undefined,
          },
          /** Advisory bounds when type is NUMBER. */
          min: { type: Number, default: undefined },
          max: { type: Number, default: undefined },
          maxLength: {
            type: Number,
            default: undefined,
            validate: {
              validator: (v) => v === undefined || v > 0,
              message: "maxLength must be greater than zero",
            },
          },
          /** Longer explanation shown beneath the input. */
          helpText: {
            type: String,
            trim: true,
            maxlength: [300, "Help text cannot exceed 300 characters"],
          },
        },
      ],
      default: [],
      validate: {
        validator: (fields) => new Set(fields.map((f) => f.name)).size === fields.length,
        message: "Field names must be unique within a request type",
      },
    },

    /**
     * Documents the student must attach (e.g. "ID proof", "fee receipt").
     * Only names and requirements — actual files live in the Document
     * collection, and nothing here grants access to one.
     */
    requiredDocuments: {
      type: [
        {
          name: {
            type: String,
            required: true,
            trim: true,
            maxlength: [120, "Document name cannot exceed 120 characters"],
          },
          description: {
            type: String,
            trim: true,
            maxlength: [300, "Description cannot exceed 300 characters"],
          },
          required: { type: Boolean, default: true },
        },
      ],
      default: [],
    },

    /**
     * Approval chain, executed in order. Each step names a permission the actor
     * must hold; the workflow service refuses to advance past a step whose
     * permission the actor lacks.
     */
    approvalSteps: {
      type: [
        {
          label: {
            type: String,
            required: true,
            trim: true,
            maxlength: [100, "Step label cannot exceed 100 characters"],
          },
          permission: {
            type: String,
            required: [true, "Step permission is required"],
            trim: true,
          },
          /** Free-form note shown on the approval screen. */
          instructions: {
            type: String,
            trim: true,
            maxlength: [500, "Instructions cannot exceed 500 characters"],
          },
        },
      ],
      default: [],
    },

    /**
     * Whether completing this request depends on money. Phase A invoices are
     * issued by the accounts module; this flag links the two without
     * embedding finance logic in the request engine.
     */
    requiresPayment: { type: Boolean, default: false },

    /** Whether a fee must be settled before approval. */
    requiresFeeClearance: { type: Boolean, default: false },

    /** Response-time policy in hours. Advisory in Phase A; drives SLA later. */
    slaHours: {
      type: Number,
      min: [1, "SLA must be at least 1 hour"],
      max: [2160, "SLA cannot exceed 90 days"],
      default: 72,
    },

    isActive: { type: Boolean, default: true, index: true },

    /** Marks seeded example rows so they can be hidden from real use. */
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

// "Show me the active services in my department, ordered by name."
requestTypeSchema.index({ department: 1, isActive: 1, name: 1 });

// Students browse the catalogue without an explicit filter.
requestTypeSchema.index({ isActive: 1, isDemo: 1 });

const RequestType = mongoose.model("RequestType", requestTypeSchema);

module.exports = RequestType;
