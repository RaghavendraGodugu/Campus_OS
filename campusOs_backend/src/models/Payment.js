/**
 * Payment — an attempt to settle an invoice.
 *
 * ## A payment record is a record of an attempt, not proof of receipt
 *
 * A `Payment` is created in CREATED state when a Razorpay order is made. It only
 * reaches PAID when a **verified webhook** says the money settled. The browser's
 * "payment successful" callback is recorded as an ATTEMPTED note and never
 * promotes the row — the spec (§12) is explicit that an invoice must not be
 * marked paid from a browser callback.
 *
 * ## Idempotency
 *
 * Razorpay retries webhooks, and a retry must not create a second payment or
 * double-credit an invoice. `razorpayOrderId` and `razorpayPaymentId` are both
 * uniquely indexed, and `webhookEvents` records which event ids have been
 * applied. `applyWebhookEvent()` claims an event with an atomic conditional
 * write, so two concurrent deliveries of the same event produce exactly one
 * application.
 */

const mongoose = require("mongoose");

const { PAYMENT_STATUS, PAYMENT_STATUS_VALUES } = require("../config/constants");

const paymentSchema = new mongoose.Schema(
  {
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: [true, "Payment must belong to an invoice"],
      index: true,
    },

    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },

    /** Amount attempted, in minor units. Must equal the invoice balance. */
    amount: { type: Number, required: true, min: 1 },

    currency: { type: String, required: true, default: "INR" },

    /** Amount the gateway confirmed, in minor units. Null until captured. */
    capturedAmount: { type: Number, default: null, min: 0 },

    /** Our order reference. Unique: one attempt per order. */
    razorpayOrderId: {
      type: String,
      required: [true, "Gateway order id is required"],
      unique: true,
      trim: true,
      index: true,
    },

    /** Gateway payment id, once known. Unique when present. */
    razorpayPaymentId: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      trim: true,
    },

    /** Gateway refund id, once refunded. */
    razorpayRefundId: { type: String, default: null },

    status: {
      type: String,
      required: true,
      enum: {
        values: PAYMENT_STATUS_VALUES,
        message: "`{VALUE}` is not a valid payment status",
      },
      default: PAYMENT_STATUS.CREATED,
      index: true,
    },

    method: { type: String, default: null },

    /**
     * Webhook event ids already applied to this payment.
     *
     * Razorpay delivers `payment.captured` more than once in practice. This
     * ledger makes re-processing a no-op.
     */
    webhookEvents: [
      {
        eventId: { type: String, required: true },
        event: { type: String, required: true },
        appliedAt: { type: Date, required: true, default: Date.now },
      },
    ],

    /** Failure detail from the gateway. Never contains secrets. */
    failureCode: { type: String, default: null },
    failureDescription: { type: String, default: null },

    /**
     * The browser reported success.
     *
     * Recorded for audit, and explicitly NOT sufficient to mark the invoice
     * paid — only a verified webhook does that.
     */
    clientReportedSuccess: {
      reportedAt: { type: Date, default: null },
      // Signatures that failed verification, kept so an attempted forgery is
      // visible to an administrator rather than silently dropped.
      signatureVerified: { type: Boolean, default: null },
    },

    verifiedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },

    /** Total refunded against this payment, in minor units. */
    refundedAmount: { type: Number, default: 0, min: 0 },

    notes: {
      type: String,
      trim: true,
      maxlength: [500, "Notes cannot exceed 500 characters"],
    },
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

// The student's payment history.
paymentSchema.index({ student: 1, createdAt: -1 });

// Reconciliation: captured payments, newest first.
paymentSchema.index({ status: 1, createdAt: -1 });

// A payment awaiting its webhook.
paymentSchema.index({ status: 1, razorpayOrderId: 1 });

const Payment = mongoose.model("Payment", paymentSchema);

module.exports = Payment;
