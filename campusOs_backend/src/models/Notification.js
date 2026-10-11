/**
 * Notification — an in-app message for one user.
 *
 * ## Delivery failures must not break the workflow
 *
 * A notification is a side effect of a state change, never a precondition for
 * it. A full notification collection cannot be allowed to fail an approval, so
 * `notification.service.js` swallows and logs delivery errors.
 *
 * ## Confidentiality
 *
 * `body` is written by the notification service from a template, never copied
 * from the resource. A notification about a confidential complaint therefore
 * cannot carry the complaint's text into an inbox.
 */

const mongoose = require("mongoose");

const { NOTIFICATION_TYPE } = require("../config/constants");

const notificationSchema = new mongoose.Schema(
  {
    /** Recipient. */
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Notification must have a recipient"],
      index: true,
    },

    type: {
      type: String,
      required: [true, "Notification type is required"],
      enum: {
        values: Object.values(NOTIFICATION_TYPE),
        message: "`{VALUE}` is not a valid notification type",
      },
    },

    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },

    /**
     * Short summary written from a template.
     *
     * Must never embed the contents of a confidential resource — see the file
     * header.
     */
    body: {
      type: String,
      required: [true, "Body is required"],
      trim: true,
      maxlength: [500, "Body cannot exceed 500 characters"],
    },

    /**
     * In-app route to open when the notification is selected, e.g.
     * "/student/requests/REQ-2026-000123".
     */
    link: {
      type: String,
      trim: true,
      maxlength: [300, "Link cannot exceed 300 characters"],
    },

    /** When read; null until acknowledged. */
    readAt: { type: Date, default: null },

    /**
     * Idempotency key.
     *
     * Retrying a notification must not produce duplicates, so callers pass a
     * deterministic key and a duplicate insert is absorbed. The compound unique
     * index below is what makes that safe under concurrency.
     */
    dedupeKey: {
      type: String,
      trim: true,
      maxlength: [200, "Dedupe key cannot exceed 200 characters"],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
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

// The notification bell: "my unread, newest first".
notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });

// Unread count query, served on every dashboard load.
notificationSchema.index({ user: 1, createdAt: -1 });

/**
 * Guarantees at most one notification per (user, dedupeKey).
 *
 * Sparse, so most notifications (which carry no key) are unaffected, and a
 * null key never collides with another null key.
 */
notificationSchema.index(
  { user: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: "string" } },
  }
);

const Notification = mongoose.model("Notification", notificationSchema);

module.exports = Notification;
