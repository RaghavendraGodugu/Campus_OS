const mongoose = require("mongoose");
const { HOSTEL_LEAVE_STATUS } = require("../config/constants");

/** A student's leave request against an active allocation. */
const hostelLeaveSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    allocation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HostelAllocation",
      required: true,
    },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    status: {
      type: String,
      enum: Object.values(HOSTEL_LEAVE_STATUS),
      default: HOSTEL_LEAVE_STATUS.PENDING,
    },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, maxlength: 300, default: "" },
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
hostelLeaveSchema.index({ student: 1, fromDate: -1 });
hostelLeaveSchema.index({ status: 1, fromDate: 1 });

module.exports = mongoose.model("HostelLeave", hostelLeaveSchema);
