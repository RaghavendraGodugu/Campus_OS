const mongoose = require("mongoose");
const { HOSTEL_ALLOCATION_STATUS } = require("../config/constants");

/**
 * A student's room allocation.
 *
 * The partial unique index makes "one active allocation per student" a database
 * fact. A second active row is refused by the index even if two wardens allocate
 * simultaneously.
 */
const hostelAllocationSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: "Hostel", required: true },
    room: { type: mongoose.Schema.Types.ObjectId, ref: "HostelRoom", required: true },
    academicYear: { type: String, required: true, trim: true, maxlength: 16 },
    status: {
      type: String,
      enum: Object.values(HOSTEL_ALLOCATION_STATUS),
      default: HOSTEL_ALLOCATION_STATUS.ACTIVE,
    },
    allocatedAt: { type: Date, default: Date.now },
    allocatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    vacatedAt: { type: Date, default: null },
    vacatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
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
hostelAllocationSchema.index(
  { student: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE" } }
);
hostelAllocationSchema.index({ room: 1, status: 1 });
hostelAllocationSchema.index({ hostel: 1, status: 1 });

module.exports = mongoose.model("HostelAllocation", hostelAllocationSchema);
