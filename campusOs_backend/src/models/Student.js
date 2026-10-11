/**
 * Student record.
 *
 * The academic profile behind a `User`. Split from User deliberately: this
 * collection holds personally and academically sensitive data (roll number,
 * semester, fee status) that a staff member has no business reading, so
 * access is a permission check on a separate resource rather than a field on
 * the account row.
 *
 * Ownership: `user` is the single authoritative link back to the account.
 * There is no duplicated email here — the User document owns identity.
 */

const mongoose = require("mongoose");

/** Semester values. Coarse on purpose; Phase B introduces the full model. */
const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];

const studentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Student must be linked to a user account"],
      unique: true,
      index: true,
    },

    /** Institution-assigned roll number. Unique, and user-visible. */
    rollNumber: {
      type: String,
      required: [true, "Roll number is required"],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [30, "Roll number cannot exceed 30 characters"],
      match: [
        /^[A-Z0-9/-]+$/,
        "Roll number must contain only letters, numbers, hyphens and slashes",
      ],
    },

    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Program",
      required: [true, "Programme is required"],
      index: true,
    },

    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Department is required"],
      index: true,
    },

    semester: {
      type: Number,
      required: [true, "Semester is required"],
      enum: {
        values: SEMESTERS,
        message: "`{VALUE}` is not a valid semester",
      },
    },

    /**
     * Year of study (1..duration). Denormalised from the programme because
     * every report filters on it and it changes rarely — an acceptable,
     * deliberate duplication. Kept consistent on enrolment and promotion.
     */
    year: {
      type: Number,
      min: [1, "Year must be at least 1"],
      max: [10, "Year cannot exceed 10"],
      required: [true, "Year of study is required"],
    },

    section: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: [10, "Section cannot exceed 10 characters"],
    },

    /**
     * Date of enrolment. Certificates and academic tenure are derived from
     * this, so it is stored rather than recomputed from createdAt.
     */
    enrolmentDate: {
      type: Date,
      required: [true, "Enrolment date is required"],
    },

    /**
     * Batch (admission cohort), e.g. "2024". Used for announcements and
     * reports. Derived from enrolmentDate when not supplied.
     */
    batchYear: {
      type: Number,
      min: [1900, "Batch year is invalid"],
      max: [2100, "Batch year is invalid"],
    },

    /**
     * Financial standing. Computed from invoices and updated by the finance
     * service — never set directly by a student request.
     */
    feeStatus: {
      type: String,
      enum: {
        values: ["CLEAR", "DUE", "OVERDUE", "PARTIALLY_PAID"],
        message: "`{VALUE}` is not a valid fee status",
      },
      default: "DUE",
      index: true,
    },

    /** Marks the record inactive without deleting academic history. */
    isActive: {
      type: Boolean,
      default: true,
      index: true,
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

// Note: `unique: true` on `rollNumber` above already creates its index.

/**
 * Backs the management roster screen: filter by department, then programme,
 * then batch, sorted by roll number.
 */
studentSchema.index({ department: 1, program: 1, batchYear: 1, rollNumber: 1 });

/** Backs "which students in this batch still owe fees". */
studentSchema.index({ feeStatus: 1, department: 1 });

/**
 * Derive batchYear from the enrolment date when it was not supplied.
 *
 * Written as an `async` function rather than the callback form
 * (`function(next){ next(); }`): Mongoose 9 **removed** callback-based pre
 * middleware, and passing `next` into one throws `next is not a function`.
 */
studentSchema.pre("validate", async function deriveBatchYear() {
  if (!this.batchYear && this.enrolmentDate) {
    this.batchYear = this.enrolmentDate.getFullYear();
  }
});

/**
 * Shape returned to the student who owns this record, or to staff with
 * `student:read` on the owning department. There is no "public" variant —
 * deciding who may call this is the caller's job, and the service layer
 * refuses to build the query otherwise.
 */
studentSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    user: this.user,
    rollNumber: this.rollNumber,
    program: this.program,
    department: this.department,
    semester: this.semester,
    year: this.year,
    section: this.section ?? null,
    enrolmentDate: this.enrolmentDate,
    batchYear: this.batchYear,
    feeStatus: this.feeStatus,
    isActive: this.isActive,
  };
};

const Student = mongoose.model("Student", studentSchema);

module.exports = Student;
