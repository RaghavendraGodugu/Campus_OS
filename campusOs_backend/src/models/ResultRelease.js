const mongoose = require("mongoose");

/**
 * The release of a programme's results for a term.
 *
 * ## Why publication is a record, not a flag on every result
 *
 * A result is not "published" on its own; a programme's results are released
 * together, once the office decides they are ready. One record per
 * `{ term, program }` makes that a single auditable act — who released them and
 * when — and makes "is this student allowed to see their result?" a lookup,
 * not a scan of every subject.
 *
 * ## Why the existence of this document is the gate
 *
 * Students never query results directly; the service checks for a release
 * before returning anything. A result row that exists but has no release is
 * invisible to the student by construction, which is stronger than a flag that
 * a bug could forget to set.
 */
const resultReleaseSchema = new mongoose.Schema(
  {
    term: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicTerm",
      required: true,
    },

    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Program",
      required: true,
    },

    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    publishedAt: {
      type: Date,
      required: true,
      default: Date.now,
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

/** One release per programme per term. Releasing again updates the timestamp. */
resultReleaseSchema.index({ term: 1, program: 1 }, { unique: true });

const ResultRelease = mongoose.model("ResultRelease", resultReleaseSchema);

module.exports = ResultRelease;
