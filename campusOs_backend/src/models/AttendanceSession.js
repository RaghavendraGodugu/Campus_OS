const mongoose = require("mongoose");

const { ATTENDANCE_STATUS_VALUES } = require("../config/constants");

/**
 * Attendance for one class meeting.
 *
 * ## One document per entry per date
 *
 * The unit a teacher actually marks is "the 09:00 Database Systems class on
 * Monday the 12th", not "a student's attendance for the term". Storing the
 * meeting keeps the marking operation atomic (one insert, one set of records)
 * and makes a duplicate submission a database conflict rather than a silently
 * doubled class.
 *
 * ## Percentage is never stored
 *
 * There is deliberately no `percentage` or `attended` field. A stored total is
 * a second source of truth that goes wrong the first time a session is
 * corrected, and the correction is exactly when the number matters. Every
 * figure is derived by aggregation from these documents — see
 * `attendance.service.js`.
 *
 * ## The term and subject are denormalised
 *
 * Both are already reachable through `entry`, but every summary query filters
 * by term and groups by subject. Copying the two ids onto the session keeps
 * those queries single-collection and index-backed instead of an aggregation
 * that must join the timetable for every read. They are written from the entry
 * and never edited independently.
 */
const attendanceRecordSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: ATTENDANCE_STATUS_VALUES,
        message: "{VALUE} is not an attendance status",
      },
    },
  },
  { _id: false }
);

const correctionSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    /**
     * Why the record changed.
     *
     * Kept here rather than in the audit log: the audit log redacts free text
     * on purpose, and a correction's reason is part of the academic record that
     * the faculty member and the HOD need to read. The audit entry records that
     * a correction happened, by whom and at which revision; this holds the
     * sentence.
     */
    reason: { type: String, required: true, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const attendanceSessionSchema = new mongoose.Schema(
  {
    entry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TimetableEntry",
      required: [true, "Attendance belongs to a timetable entry"],
    },

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

    /** The teacher of the class at the time it was marked. */
    faculty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    /** UTC midnight of the calendar date the class met. */
    date: {
      type: Date,
      required: [true, "Attendance needs a date"],
    },

    records: {
      type: [attendanceRecordSchema],
      required: true,
      validate: {
        validator(records) {
          if (!Array.isArray(records) || records.length === 0) return false;
          const ids = new Set(records.map((record) => String(record.student)));
          return ids.size === records.length;
        },
        message: "Each student may appear once, and the class cannot be empty",
      },
    },

    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    markedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    /** Incremented by every correction. 0 means never corrected. */
    revision: {
      type: Number,
      default: 0,
      min: 0,
    },

    corrections: {
      type: [correctionSchema],
      default: [],
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

/**
 * One attendance record per class per date.
 *
 * This is the constraint that makes a double submission fail loudly. The
 * service also checks first so it can return a useful message, but two
 * simultaneous marks race past that check; this index is what actually stops
 * the duplicate.
 */
attendanceSessionSchema.index({ entry: 1, date: 1 }, { unique: true });

/** The student summary: "my attendance this term". */
attendanceSessionSchema.index({ "records.student": 1, term: 1 });

/** The HOD roll-up: "this subject, this term". */
attendanceSessionSchema.index({ term: 1, subject: 1, date: 1 });

const AttendanceSession = mongoose.model("AttendanceSession", attendanceSessionSchema);

module.exports = AttendanceSession;
