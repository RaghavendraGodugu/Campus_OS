const mongoose = require("mongoose");

/**
 * One seat held at one event.
 *
 * The unique compound index is the rule: one person, one event, one record.
 * Capacity is enforced by counting these before allowing another register, so
 * "full" is a arithmetic answer, not a field that can drift out of date.
 */
const eventRsvpSchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

eventRsvpSchema.index({ event: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("EventRsvp", eventRsvpSchema);
