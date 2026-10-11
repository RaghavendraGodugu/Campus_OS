/**
 * Academic programme (e.g. B.Tech Computer Science, MBA).
 *
 * A programme belongs to exactly one department and defines the degree a
 * student is enrolled in. Kept separate from Department because one
 * department almost always offers several programmes, and because fees,
 * certificates and announcements are all scoped to a programme rather than to
 * a department.
 */

const mongoose = require("mongoose");

const programSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Programme name is required"],
      trim: true,
      maxlength: [150, "Programme name cannot exceed 150 characters"],
    },

    code: {
      type: String,
      required: [true, "Programme code is required"],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [20, "Programme code cannot exceed 20 characters"],
      match: [
        /^[A-Z0-9-]+$/,
        "Programme code must contain only letters, numbers and hyphens",
      ],
    },

    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Programme must belong to a department"],
      index: true,
    },

    /** Degree level, used for programme filtering and certificates. */
    level: {
      type: String,
      required: [true, "Programme level is required"],
      enum: {
        values: ["UNDERGRADUATE", "POSTGRADUATE", "DIPLOMA", "CERTIFICATE", "DOCTORAL"],
        message: "`{VALUE}` is not a valid programme level",
      },
    },

    /** Standard duration in years; used on documents. */
    durationYears: {
      type: Number,
      min: [1, "Duration must be at least 1 year"],
      max: [10, "Duration cannot exceed 10 years"],
      default: 3,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

/** "Show me all active programmes in this department." */
programSchema.index({ department: 1, isActive: 1 });

const Program = mongoose.model("Program", programSchema);

module.exports = Program;