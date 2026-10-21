const mongoose = require("mongoose");
const { PLACEMENT_APPLICATION_STATUS } = require("../config/constants");

/** One student's application to one drive. */
const placementApplicationSchema = new mongoose.Schema(
  {
    drive: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PlacementDrive",
      required: true,
    },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    status: {
      type: String,
      enum: Object.values(PLACEMENT_APPLICATION_STATUS),
      default: PLACEMENT_APPLICATION_STATUS.APPLIED,
    },
    appliedAt: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedAt: { type: Date, default: Date.now },
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
placementApplicationSchema.index({ drive: 1, student: 1 }, { unique: true });
placementApplicationSchema.index({ student: 1, status: 1 });

module.exports = mongoose.model("PlacementApplication", placementApplicationSchema);
