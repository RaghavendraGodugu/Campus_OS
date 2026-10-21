const mongoose = require("mongoose");
const { PLACEMENT_DRIVE_STATUS } = require("../config/constants");

/** A recruitment drive. Students only ever see OPEN drives. */
const placementDriveSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    role: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    location: { type: String, trim: true, maxlength: 120, default: "" },
    ctcPaise: { type: Number, min: 0, default: null },
    eligiblePrograms: [{ type: mongoose.Schema.Types.ObjectId, ref: "Program" }],
    eligibleSemesters: [{ type: Number, min: 1, max: 12 }],
    applicationDeadline: { type: Date, required: true },
    driveDate: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(PLACEMENT_DRIVE_STATUS),
      default: PLACEMENT_DRIVE_STATUS.DRAFT,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
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
placementDriveSchema.index({ status: 1, applicationDeadline: 1 });
placementDriveSchema.index({ company: 1, driveDate: -1 });

module.exports = mongoose.model("PlacementDrive", placementDriveSchema);
