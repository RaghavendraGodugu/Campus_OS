/**
 * College department.
 *
 * The unit of institutional organisation: an HOD's permission scope, the
 * routing target for requests and complaints, and the grouping for reports.
 */

const mongoose = require("mongoose");

const departmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Department name is required"],
      unique: true,
      trim: true,
      maxlength: [150, "Department name cannot exceed 150 characters"],
    },

    /** Short identifier used in documents and reference numbers. */
    code: {
      type: String,
      required: [true, "Department code is required"],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [20, "Department code cannot exceed 20 characters"],
      match: [
        /^[A-Z0-9-]+$/,
        "Department code must contain only letters, numbers and hyphens",
      ],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },

    /**
     * Head of department. A reference rather than an embedded copy, so
     * reassignment updates everywhere at once.
     */
    hod: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
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

// Powers the active-department dropdown, ordered by name.
// Note: `unique: true` on the `name` and `code` field definitions above already
// creates those indexes; redeclaring them here triggers a duplicate-index warning.
departmentSchema.index({ isActive: 1, name: 1 });

const Department = mongoose.model("Department", departmentSchema);

module.exports = Department;
