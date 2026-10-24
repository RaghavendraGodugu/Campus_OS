const mongoose = require("mongoose");

/**
 * A campus event. Workshops, fests, seminars, sports days.
 *
 * Publishing is the gate students look through, the same rule placements use:
 * a draft is nothing to act on yet, so nobody outside the organisers sees it.
 * The RSVP ledger lives in its own collection — one envelope per person, a
 * unique index to hold them — because count queries have to stay cheap when
 * capacity is being compared on every register.
 */
const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    kind: {
      type: String,
      required: true,
      enum: ["WORKSHOP", "FEST", "SEMINAR", "SPORTS", "CULTURAL", "OTHER"],
    },
    venue: { type: String, trim: true, maxlength: 160, default: "" },
    // A placed event. `endsAt` stays optional because several one-hour sessions
    // simply run to completion at their start time plus a known duration.
    startsAt: { type: Date, required: true },
    endsAt: { type: Date },
    /** Attendee ceiling. Absent means whoever shows up is fine. */
    capacity: { type: Number, min: 1, max: 5000 },
    status: {
      type: String,
      required: true,
      enum: ["DRAFT", "PUBLISHED", "CANCELLED"],
      default: "DRAFT",
    },
    /** The department that owns the event, for reporting; extinct when null. */
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
    /** Who to ask about it. */
    contact: { type: String, trim: true, maxlength: 160, default: "" },
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_d, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

eventSchema.index({ status: 1, startsAt: -1 });

module.exports = mongoose.model("Event", eventSchema);
