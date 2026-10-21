const mongoose = require("mongoose");

const { ROOM_KINDS, ROOM_KIND_VALUES } = require("../config/constants");

/**
 * A room that a class can be scheduled into.
 *
 * ## Why capacity and kind are fields, not notes
 *
 * The two clashes that actually happen are "two classes in one room" and "a
 * lab scheduled in a lecture hall". The first is prevented by the timetable's
 * overlap check; the second can only be prevented if the room knows what it is.
 * A free-text location field can describe either and enforce neither.
 *
 * `capacity` is not used to validate enrolment yet — the roster is derived from
 * programme and semester, and a section can legitimately overflow. It is
 * recorded now because the timetable UI needs to show it when a scheduler is
 * choosing a room, and adding it later would leave existing rooms blank.
 */
const roomSchema = new mongoose.Schema(
  {
    /** Building or block, e.g. "Academic Block A". */
    block: {
      type: String,
      trim: true,
      maxlength: [80, "A block name cannot exceed 80 characters"],
      default: "",
    },

    /** The identifier on the door: "LH-204", "CS Lab 2". */
    name: {
      type: String,
      required: [true, "A room needs a name"],
      trim: true,
      maxlength: [60, "A room name cannot exceed 60 characters"],
    },

    capacity: {
      type: Number,
      default: 60,
      min: [1, "A room must hold at least one person"],
      max: [2000, "Capacity looks wrong"],
    },

    kind: {
      type: String,
      enum: {
        values: ROOM_KIND_VALUES,
        message: "{VALUE} is not a room kind",
      },
      default: ROOM_KINDS.CLASSROOM,
    },

    isActive: {
      type: Boolean,
      default: true,
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
 * A room is unique by building and name.
 *
 * The same name in two blocks is genuinely two rooms ("Seminar Hall" exists in
 * more than one building), so the pair is the constraint rather than the name.
 */
roomSchema.index({ block: 1, name: 1 }, { unique: true });

roomSchema.index({ isActive: 1, kind: 1 });

const Room = mongoose.model("Room", roomSchema);

module.exports = Room;
