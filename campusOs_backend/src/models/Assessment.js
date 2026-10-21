const mongoose = require("mongoose");

const { ASSESSMENT_KINDS, ASSESSMENT_KIND_VALUES } = require("../config/constants");

/**
 * One assessment component of a subject in a term.
 *
 * ## Why components are records, not columns
 *
 * "Internal 1", "Internal 2", "Lab record", "End semester" are what a college
 * actually enters marks against. Modelling them as an array of assessments —
 * rather than a fixed internal/external pair on a result — is what lets a
 * department use three internals while another uses one project and a viva,
 * without a schema change.
 *
 * ## Max marks belong to the component
 *
 * A 20-mark internal and a 70-mark end-semester are not comparable; the final
 * percentage is `sum(obtained) / sum(max)`. Keeping `maxMarks` here means the
 * denominator is always the assessments that actually exist, not a number
 * typed into a form once and forgotten.
 */
const assessmentSchema = new mongoose.Schema(
  {
    term: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicTerm",
      required: true,
    },

    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },

    name: {
      type: String,
      required: [true, "An assessment needs a name"],
      trim: true,
      maxlength: [80, "An assessment name cannot exceed 80 characters"],
    },

    kind: {
      type: String,
      enum: {
        values: ASSESSMENT_KIND_VALUES,
        message: "{VALUE} is not an assessment kind",
      },
      default: ASSESSMENT_KINDS.INTERNAL,
    },

    maxMarks: {
      type: Number,
      required: [true, "An assessment needs a maximum mark"],
      min: [1, "Maximum marks must be at least 1"],
      max: [500, "Maximum marks look wrong"],
    },

    /** Display order on the marks sheet. Ties fall back to name. */
    sequence: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

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

/** A subject cannot have two components with the same name in one term. */
assessmentSchema.index({ subject: 1, term: 1, name: 1 }, { unique: true });

/** The marks sheet: "this subject's components, in order". */
assessmentSchema.index({ subject: 1, term: 1, isActive: 1, sequence: 1 });

const Assessment = mongoose.model("Assessment", assessmentSchema);

module.exports = Assessment;
