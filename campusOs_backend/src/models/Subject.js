const mongoose = require("mongoose");

const { SUBJECT_KINDS, SUBJECT_KIND_VALUES } = require("../config/constants");

/**
 * A subject — one teachable paper, in one programme, in one semester.
 *
 * ## Why this is not just a "course" string
 *
 * A timetable needs to know three things about a class before it can be placed:
 * which programme's students attend, which semester they are in, and which
 * department owns the paper. A free-text course name answers none of them, so
 * every schedule becomes a spreadsheet with a hidden convention in it.
 *
 * ## Why the code is unique per programme, not institution-wide
 *
 * Two programmes legitimately teach "CS301" and "CS301" — same code, different
 * syllabus, different department. A global unique index would force one of them
 * to be renamed to something nobody uses. The compound index below makes the
 * pair unique, which is the real constraint.
 *
 * ## Why a subject is retired rather than deleted
 *
 * A timetable entry from last term and an attendance record from last month
 * both point at this document. Deleting the subject would orphan the history
 * that explains a student's attendance percentage. `isActive: false` removes it
 * from new scheduling without breaking what already happened.
 */
const subjectSchema = new mongoose.Schema(
  {
    /** The code students see on a timetable: "CS301", "MA201". */
    code: {
      type: String,
      required: [true, "A subject needs a code"],
      trim: true,
      uppercase: true,
      maxlength: [20, "A subject code cannot exceed 20 characters"],
    },

    name: {
      type: String,
      required: [true, "A subject needs a name"],
      trim: true,
      maxlength: [160, "A subject name cannot exceed 160 characters"],
    },

    /** Owning department. Drives HOD scope and reporting. */
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "A subject belongs to a department"],
      index: true,
    },

    /**
     * The programme whose students attend.
     *
     * This is the field that makes "students see their programme's timetable"
     * a query rather than a guess.
     */
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Program",
      required: [true, "A subject belongs to a programme"],
    },

    semester: {
      type: Number,
      required: [true, "A subject belongs to a semester"],
      min: [1, "Semester must be at least 1"],
      max: [12, "Semester cannot exceed 12"],
    },

    credits: {
      type: Number,
      default: 3,
      min: [0, "Credits cannot be negative"],
      max: [20, "Credits cannot exceed 20"],
    },

    kind: {
      type: String,
      enum: {
        values: SUBJECT_KIND_VALUES,
        message: "{VALUE} is not a subject kind",
      },
      default: SUBJECT_KINDS.THEORY,
    },

    /** False retires the subject from new scheduling without deleting history. */
    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
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

/** The real uniqueness constraint: one code per programme. */
subjectSchema.index({ program: 1, code: 1 }, { unique: true });

/** Backs "subjects for this department, this semester, still active". */
subjectSchema.index({ department: 1, semester: 1, isActive: 1 });

const Subject = mongoose.model("Subject", subjectSchema);

module.exports = Subject;
