/**
 * Announcement — a notice from the institution to a defined audience.
 *
 * ## Visibility is computed, never stored per recipient
 *
 * An announcement records *who it was addressed to*, not who received it. Two
 * reasons. Storing a recipient list would duplicate the audience across the
 * collection and go stale the moment a student changes department. Computing it
 * from the announcement plus the viewer's own attributes means a student's
 * access to a notice follows their enrolment instead of being frozen at the
 * moment it was posted.
 *
 * `audienceMatches` in the service is the single place that decides this, and
 * it is also applied to a single-fetch lookup so that a direct URL to an
 * announcement cannot bypass the list filter.
 *
 * ## The bell is best-effort; the announcement is not
 *
 * Fan-out writes one Notification per recipient, which at college scale is
 * thousands of documents. The announcement is always created; the fan-out is
 * bounded and resumable. `notifyMany` dedupes per recipient, so re-running it
 * tops up the bell without producing a second copy of anything.
 */

const mongoose = require("mongoose");

const { ROLES, AUDIENCE_SCOPE, ANNOUNCEMENT_PRIORITY } = require("../config/constants");

const announcementSchema = new mongoose.Schema(
  {
    /** Human reference, e.g. AN-2026-000004. */
    reference: {
      type: String,
      required: [true, "Announcement reference is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },

    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [160, "Title cannot exceed 160 characters"],
    },

    /**
     * The notice itself.
     *
     * Rendered as plain text. It is authored by an authorised officer and shown
     * to the named audience only, so unlike a complaint it carries no
     * confidential subject matter.
     */
    body: {
      type: String,
      required: [true, "Body is required"],
      trim: true,
      maxlength: [5000, "Body cannot exceed 5000 characters"],
    },

    priority: {
      type: String,
      required: true,
      enum: {
        values: Object.values(ANNOUNCEMENT_PRIORITY),
        message: "`{VALUE}` is not a valid announcement priority",
      },
      default: ANNOUNCEMENT_PRIORITY.NORMAL,
      index: true,
    },

    /** Kept at the top of the list until removed. */
    pinned: { type: Boolean, default: false, index: true },

    /**
     * Who may read this.
     *
     * Only the fields relevant to `scope` are used. A scope of DEPARTMENT with
     * no department would be an announcement to everyone, so the schema
     * validator below refuses the inconsistent combinations outright rather than
     * leaving them to be misread later.
     */
    audience: {
      scope: {
        type: String,
        required: [true, "Audience scope is required"],
        enum: {
          values: Object.values(AUDIENCE_SCOPE),
          message: "`{VALUE}` is not a valid audience scope",
        },
        default: AUDIENCE_SCOPE.ALL,
      },

      roles: {
        type: [String],
        default: undefined,
        validate: {
          validator(roles) {
            return (
              !Array.isArray(roles) ||
              roles.length === 0 ||
              roles.every((r) => Object.values(ROLES).includes(r))
            );
          },
          message: "Audience roles must be known role names",
        },
      },

      department: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
        default: undefined,
      },

      program: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Program",
        default: undefined,
      },
    },

    /** Goes live at this instant. A future date schedules the announcement. */
    publishedAt: {
      type: Date,
      required: [true, "A publication date is required"],
      default: Date.now,
      index: true,
    },

    /** Stops being listed after this instant. Null means it never expires. */
    expiresAt: { type: Date, default: null },

    status: {
      type: String,
      required: true,
      enum: {
        values: ["PUBLISHED", "ARCHIVED"],
        message: "`{VALUE}` is not a valid announcement status",
      },
      default: "PUBLISHED",
      index: true,
    },

    /** Authorised officer who posted it. */
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Announcement must have an author"],
    },

    /** Optional private attachment, delivered through the storage adapter. */
    attachment: {
      storageKey: { type: String, default: null },
      originalName: { type: String, default: null },
      mimeType: { type: String, default: null },
      bytes: { type: Number, default: null },
      adapter: { type: String, default: null },
    },

    /**
     * How many bell notifications the last fan-out produced, and whether the
     * audience was larger than the fan-out bound.
     *
     * Recorded so an operator can see that the announcement reached everyone
     * even when the notification inbox is only partially populated.
     */
    notifiedCount: { type: Number, default: 0 },
    fanOutTruncated: { type: Boolean, default: false },

    archivedAt: { type: Date, default: null },
    archivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

/**
 * Reject an audience whose scope does not match its selectors.
 *
 * A DEPARTMENT announcement with no department is addressed to everyone. That is
 * exactly the kind of mistake that silently widens access, so it is refused at
 * write time instead of being interpreted generously at read time.
 *
 * Uses `invalidate` so the failure names the offending field, rather than
 * arriving as an opaque schema error.
 */
announcementSchema.pre("validate", async function validateAudience() {
  const audience = this.audience ?? {};
  const { scope, roles, department, program } = audience;

  if (scope === AUDIENCE_SCOPE.ROLES && (!roles || roles.length === 0)) {
    this.invalidate("audience.roles", "An audience of ROLES must name at least one role");
  }

  if (scope === AUDIENCE_SCOPE.DEPARTMENT && !department) {
    this.invalidate(
      "audience.department",
      "An audience of DEPARTMENT must name a department"
    );
  }

  if (scope === AUDIENCE_SCOPE.PROGRAM && !program) {
    this.invalidate("audience.program", "An audience of PROGRAM must name a programme");
  }

  // Selectors that do not belong to the scope would silently do nothing, and
  // read as though they narrow the audience.
  if (scope === AUDIENCE_SCOPE.ALL && (roles || department || program)) {
    this.invalidate(
      "audience.scope",
      "An announcement to everyone cannot also name an audience"
    );
  }
});

// The common listing: live announcements for an audience, newest first.
announcementSchema.index({ status: 1, publishedAt: -1 });

// Pinned first, then newest.
announcementSchema.index({ pinned: -1, publishedAt: -1 });

const Announcement = mongoose.model("Announcement", announcementSchema);

module.exports = Announcement;
