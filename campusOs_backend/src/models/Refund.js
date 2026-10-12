/**
 * Refund — money returned against a captured payment.
 *
 * ## Approval and execution are separate acts
 *
 * A student *requests* a refund; an authorised officer approves it; only then
 * is the gateway called. The requester can never trigger a refund, and approval
 * without a recorded reason is refused — a refund with no explanation is
 * unauditable.
 *
 * ## Amounts are bounded by the payment
 *
 * `refundAmount` may never exceed the captured amount less what has already
 * been refunded. That is checked in `finance.service.approveRefund()` against
 * the stored payment, not against anything the caller supplied.
 */

const mongoose = require("mongoose");

const { REFUND_STATUS, REFUND_STATUS_VALUES } = require("../config/constants");

const refundSchema = new mongoose.Schema(
  {
    /** Human-readable reference, e.g. "REF-2026-000017". */
    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: [true, "Refund must belong to a payment"],
      index: true,
    },

    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
      index: true,
    },

    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },

    /** Amount to return, in minor units. Null on a request means "all". */
    refundAmount: { type: Number, required: true, min: 1 },

    reason: {
      type: String,
      required: [true, "A refund reason is required"],
      trim: true,
      maxlength: [1000, "Reason cannot exceed 1000 characters"],
    },

    status: {
      type: String,
      required: true,
      enum: {
        values: REFUND_STATUS_VALUES,
        message: "`{VALUE}` is not a valid refund status",
      },
      default: REFUND_STATUS.REQUESTED,
      index: true,
    },

    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    requestedAt: { type: Date, required: true, default: Date.now },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    approvalNote: {
      type: String,
      trim: true,
      maxlength: [1000, "Note cannot exceed 1000 characters"],
    },

    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    processedAt: { type: Date, default: null },

    rejectionReason: { type: String, trim: true, maxlength: [1000], default: null },

    razorpayRefundId: { type: String, default: null, unique: true, sparse: true },

    failureDescription: { type: String, trim: true, maxlength: [500], default: null },
  },
  {
    timestamps: true,
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

// The student's refund requests.
refundSchema.index({ student: 1, createdAt: -1 });

// Officer work queue.
refundSchema.index({ status: 1, createdAt: 1 });

const Refund = mongoose.model("Refund", refundSchema);

module.exports = Refund;
