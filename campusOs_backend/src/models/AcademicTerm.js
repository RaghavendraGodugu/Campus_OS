const mongoose = require("mongoose");

const { ACADEMIC_TERM_STATUS, ACADEMIC_TERM_KINDS } = require("../config/constants");

/**
 * An academic term.
 *
 * ## Why a term exists
 *
 * Without one, "how many certificates did we issue this semester?" can only be
 * answered by a date range somebody typed. That is not reproducible: two people
 * typing "this semester" produce two different answers, and neither can be
 * shown to be right.
 *
 * A term makes the answer a record. A report can name the term it covers, an
 * export can carry the term's name, and a figure from last term can never be
 * quietly presented as this term's.
 *
 * ## Exactly one term is current
 *
 * `isCurrent` is a field rather than a computed date range, so a term can be
 * opened and closed by hand. A term whose dates have passed is still the current
 * term until an administrator closes it — otherwise every record written last
 * month would silently belong to nothing, and a college that has not yet opened
 * its next term would have no current term at all.
 *
 * The partial unique index below is what makes "exactly one" true at the
 * database level. Application code that checks-then-writes races with itself
 * under two simultaneous clicks, which is exactly when a duplicate would be
 * created.
 */

const academicTermSchema = new mongoose.Schema(
  {
    /**
     * The name people use: "Autumn 2026", "Semester 1 2026-27".
     * Not generated from the dates, because a term can be called what the
     * college calls it.
     */
    name: {
      type: String,
      required: [true, "A term needs a name"],
      trim: true,
      maxlength: 80,
      unique: true,
    },

    /** Full, formal label for exports and transcripts. */
    code: {
      type: String,
      required: [true, "A term needs a code"],
      trim: true,
      uppercase: true,
      maxlength: 24,
    },

    kind: {
      type: String,
      enum: {
        values: Object.values(ACADEMIC_TERM_KINDS),
        message: "{VALUE} is not a term kind",
      },
      default: ACADEMIC_TERM_KINDS.SEMESTER,
    },

    /** Academic year this term belongs to, e.g. "2026-27". */
    academicYear: {
      type: String,
      required: [true, "A term needs an academic year"],
      trim: true,
      maxlength: 16,
    },

    startsOn: {
      type: Date,
      required: [true, "A term needs a start date"],
    },

    endsOn: {
      type: Date,
      required: [true, "A term needs an end date"],
    },

    /**
     * Whether this is the term new records belong to.
     *
     * Held on the document rather than derived from today's date, so an
     * administrator can close a term before its end date and open the next one
     * early.
     */
    isCurrent: { type: Boolean, default: false },

    status: {
      type: String,
      enum: {
        values: Object.values(ACADEMIC_TERM_STATUS),
        message: "{VALUE} is not a term status",
      },
      default: ACADEMIC_TERM_STATUS.PLANNED,
    },

    /**
     * Fees and certificates raised against this term.
     *
     * Kept on the term rather than inferred, so a report can say which term a
     * total belongs to without re-deriving the range on every read.
     */
    counts: {
      students: { type: Number, default: 0 },
      invoices: { type: Number, default: 0 },
      certificates: { type: Number, default: 0 },
      requests: { type: Number, default: 0 },
    },

    openedAt: { type: Date, default: null },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    notes: { type: String, default: null, trim: true, maxlength: 500 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/**
 * At most one term may be current.
 *
 * A partial unique index, so the guarantee holds even if two requests race — a
 * check-then-write in application code would not. Closed and planned terms are
 * excluded, which is why the filter is on `isCurrent` and not on `status`.
 */
academicTermSchema.index(
  { isCurrent: 1 },
  {
    unique: true,
    partialFilterExpression: { isCurrent: true },
    name: "one_current_academic_term",
  }
);

/** Newest term first when listing a history. */
academicTermSchema.index({ academicYear: 1, startsOn: -1 });

academicTermSchema.virtual("isUpcoming").get(function upcoming() {
  return this.startsOn > new Date();
});

academicTermSchema.virtual("hasEnded").get(function ended() {
  return this.endsOn < new Date();
});

/**
 * Is this term usable for new records?
 *
 * Planned terms accept nothing: opening one early and raising fees against it
 * is how a term gets skipped.
 */
academicTermSchema.methods.acceptsNewRecords = function acceptsNewRecords() {
  return this.isCurrent === true && this.status === ACADEMIC_TERM_STATUS.OPEN;
};

module.exports = mongoose.models.AcademicTerm || mongoose.model("AcademicTerm", academicTermSchema);