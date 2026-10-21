const mongoose = require("mongoose");

/**
 * One student's mark for one assessment component.
 *
 * ## Why a mark is its own document
 *
 * Marks are entered one student at a time, corrected individually, and audited.
 * Embedding them in the assessment would make a correction rewrite the whole
 * component and make "who changed this mark" impossible to answer. The unique
 * `{ assessment, student }` index makes an accidental double entry a database
 * conflict instead of two rows that disagree.
 *
 * ## What is deliberately not stored
 *
 * There is no total, percentage or grade here. Those are derived from all the
 * marks of a subject on read (see `result.service.js`), so a corrected mark
 * cannot leave a stale total behind — the same rule attendance follows.
 *
 * `subject` and `term` are denormalised from the assessment so the marks sheet
 * and the result aggregation are single-collection queries. They are written
 * from the assessment and never edited independently.
 */
const assessmentMarkSchema = new mongoose.Schema(
  {
    assessment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assessment",
      required: true,
    },

    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },

    term: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicTerm",
      required: true,
    },

    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },

    marksObtained: {
      type: Number,
      required: true,
      min: [0, "Marks cannot be negative"],
    },

    enteredBy: {
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

/** One mark per student per component. */
assessmentMarkSchema.index({ assessment: 1, student: 1 }, { unique: true });

/** The marks sheet for a subject. */
assessmentMarkSchema.index({ subject: 1, term: 1 });

/** A student's own result rows for a term. */
assessmentMarkSchema.index({ student: 1, term: 1 });

const AssessmentMark = mongoose.model("AssessmentMark", assessmentMarkSchema);

module.exports = AssessmentMark;
