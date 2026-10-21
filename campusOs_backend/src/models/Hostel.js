const mongoose = require("mongoose");
const { HOSTEL_KIND_VALUES, HOSTEL_KINDS } = require("../config/constants");

/** A hostel block. Rooms belong to it; allocations point at both. */
const hostelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, maxlength: 80 },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
      maxlength: 16,
    },
    kind: { type: String, enum: HOSTEL_KIND_VALUES, default: HOSTEL_KINDS.COED },
    address: { type: String, trim: true, maxlength: 200, default: "" },
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
hostelSchema.index({ isActive: 1, kind: 1 });

module.exports = mongoose.model("Hostel", hostelSchema);
