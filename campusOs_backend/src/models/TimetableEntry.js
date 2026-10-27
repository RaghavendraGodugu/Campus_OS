const mongoose = require("mongoose");

/**
 * One weekly class meeting: a subject, taught by somebody, in a room, at a
 * fixed time on a fixed weekday, for a term.
 *
 * ## Why time is stored as minutes from midnight
 *
 * "9:00–9:50" is a string; "540–590" is arithmetic. The overlap check, the
 * weekly grid and the duration all need to compare and subtract, and doing that
 * on formatted times is how a timetable ends up with a 9:00 class that starts
 * before the 8:55 one. The frontend formats; the database stores numbers.
 *
 * ## Why the overlap check lives in the service, not in an index
 *
 * MongoDB can enforce "no two entries with the same room, day and start", but
 * not "no two entries whose intervals intersect" — a 9:00–10:00 and a
 * 9:30–10:30 clash without sharing a start minute. A unique index would give
 * false confidence. The service checks the real predicate, and the compound
 * indexes below make that check cheap. The remaining race (two simultaneous
 * inserts that both pass the check) is documented in the service; the term
 * setup flow is single-operator, and a clash is visible immediately.
 *
 * ## Why faculty is on the entry rather than a separate assignment table
 *
 * For a timetable, "who teaches this class at this hour" is the entry. A
 * separate teaching-assignment collection would duplicate the same fact and
 * allow the two to disagree. When marks and attendance need a per-subject
 * teacher, they can derive it from the term's entries — or introduce an
 * explicit assignment then, with a migration.
 */
const timetableEntrySchema = new mongoose.Schema(
  {
    term: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcademicTerm",
      required: [true, "A class belongs to a term"],
    },

    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: [true, "A class needs a subject"],
    },

    /** The staff member who teaches it. Validated as staff in the service. */
    faculty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "A class needs a faculty member"],
    },

    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: [true, "A class needs a room"],
    },

    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    dayOfWeek: {
      type: Number,
      required: [true, "A class needs a weekday"],
      min: [1, "Weekday must be 1 (Monday) to 7 (Sunday)"],
      max: [7, "Weekday must be 1 (Monday) to 7 (Sunday)"],
    },

    startsOn: {
      type: Date,
      default: null,
    },

    repeatsWeekly: {
      type: Boolean,
      default: true,
    },

    /** Minutes from midnight. 0 = 00:00, 540 = 09:00. */
    startMinute: {
      type: Number,
      required: [true, "A class needs a start time"],
      min: [0, "Start time cannot be before midnight"],
      max: [1439, "Start time must be before midnight"],
    },

    endMinute: {
      type: Number,
      required: [true, "A class needs an end time"],
      min: [1, "End time must be after midnight"],
      max: [1440, "End time cannot pass midnight"],
      validate: {
        validator(value) {
          return value > this.startMinute;
        },
        message: "A class must end after it starts",
      },
    },

    /** False removes a cancelled class from the grid without erasing history. */
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

/** The weekly grid query: everything for a term, ordered by day and start. */
timetableEntrySchema.index({ term: 1, dayOfWeek: 1, startMinute: 1 });

/** "What do I teach this week?" — the faculty view. */
timetableEntrySchema.index({ faculty: 1, term: 1, dayOfWeek: 1 });

/** "Where does this subject meet?" — the student view and the clash check. */
timetableEntrySchema.index({ subject: 1, term: 1 });

/** "Is this room free at 10:00?" — the room clash check. */
timetableEntrySchema.index({ room: 1, term: 1, dayOfWeek: 1, startMinute: 1 });

const TimetableEntry = mongoose.model("TimetableEntry", timetableEntrySchema);

module.exports = TimetableEntry;
