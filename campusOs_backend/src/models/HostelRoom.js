const mongoose = require("mongoose");

/** A room in a hostel. `capacity` is the only limit on allocation. */
const hostelRoomSchema = new mongoose.Schema(
  {
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: "Hostel", required: true },
    number: { type: String, required: true, trim: true, uppercase: true, maxlength: 16 },
    capacity: { type: Number, required: true, min: 1, max: 20 },
    isActive: { type: Boolean, default: true },
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
  }
);
hostelRoomSchema.index({ hostel: 1, number: 1 }, { unique: true });
hostelRoomSchema.index({ hostel: 1, isActive: 1 });

module.exports = mongoose.model("HostelRoom", hostelRoomSchema);
