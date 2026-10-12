/**
 * Refunds.
 *
 * ## Request, decide, execute — three separate acts
 *
 * A student requests a refund. An authorised officer approves or rejects it.
 * Only approval calls the gateway. Splitting them means a student can never
 * move money, and an approval is a recorded human decision rather than a side
 * effect of someone clicking "refund".
 *
 * ## Bounds are checked against stored values
 *
 * The refundable amount is computed from the *stored* captured amount less what
 * has already been refunded — never from anything the caller sent. A request
 * for more than is left is refused with the remaining figure, which is the
 * number the student actually needs.
 *
 * ## Partial refunds accumulate correctly
 *
 * Each refund reduces the payment's `refundedAmount`, and the invoice is
 * reopened only when the cumulative refunded total reaches the amount that was
 * credited. Three ₹100 refunds against a ₹250 payment leave ₹50 outstanding;
 * they do not reopen the invoice.
 */

const Refund = require("../models/Refund");
const Payment = require("../models/Payment");
const Invoice = require("../models/Invoice");
const Student = require("../models/Student");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { userHasPermission, P } = require("../utils/permissions");
const {
  ROLES,
  REFUND_STATUS,
  PAYMENT_STATUS,
  INVOICE_STATUS,
  AUDIT_ACTION,
} = require("../config/constants");
const { getGateway } = require("../config/razorpay");
const money = require("../utils/money");
const { logger } = require("../config/logger");
const { nextReference } = require("./finance.service");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");

/** Minimum stated reason for a request, rejection or revocation. */
const MIN_REASON_LENGTH = 10;

/**
 * Resolve a refund by ObjectId or by its printed reference.
 *
 * Notification links and receipts carry `REF-2026-000001`, not an ObjectId, so
 * every lookup has to accept both. Calling `findById` with a reference throws a
 * Mongoose CastError — a 400 for a perfectly valid reference.
 */
function findRefund(identifier) {
  const id = String(identifier ?? "").trim();

  return Refund.findOne(
    /^[a-f\d]{24}$/i.test(id) ? { _id: id } : { reference: id.toUpperCase() }
  );
}

/**
 * How much of a payment may still be refunded.
 *
 * @param {object} payment
 * @returns {number} Minor units.
 */
function refundableAmount(payment) {
  if (payment.status !== PAYMENT_STATUS.PAID) return 0;

  const captured = payment.capturedAmount ?? payment.amount;
  return Math.max(0, captured - (payment.refundedAmount ?? 0));
}

/**
 * Request a refund.
 *
 * @param {object} params
 * @param {object} params.user    The student requesting it.
 * @param {string} params.paymentId
 * @param {string} [params.amount] Omit for "everything remaining".
 * @param {string} params.reason
 * @param {object} [params.req]
 */
async function requestRefund({ user, paymentId, amount, reason, req }) {
  if (user.role !== ROLES.STUDENT) {
    throw ApiError.forbidden(
      "Only the student who made the payment can request a refund"
    );
  }

  const payment = await Payment.findById(paymentId);
  if (!payment || payment.student.toString() !== user.student?.toString()) {
    throw ApiError.notFound("Payment not found");
  }

  if (payment.status !== PAYMENT_STATUS.PAID) {
    throw ApiError.badRequest("Only a settled payment can be refunded");
  }

  const refundable = refundableAmount(payment);
  if (refundable <= 0) {
    throw ApiError.badRequest("This payment has already been fully refunded");
  }

  const requested =
    amount === undefined || amount === null ? refundable : money.toMinor(String(amount));

  if (requested <= 0) {
    throw ApiError.badRequest("A refund amount must be greater than zero");
  }

  if (requested > refundable) {
    // Report the real remainder rather than a generic rejection.
    throw new ApiError(
      ERROR_CODE.VALIDATION_ERROR,
      `Only ${money.format(refundable)} of this payment can still be refunded`,
      {
        details: [
          {
            field: "amount",
            message: `Maximum refundable is ${money.format(refundable)}`,
            code: "EXCEEDS_REMAINING",
          },
        ],
      }
    );
  }

  if (typeof reason !== "string" || reason.trim().length < MIN_REASON_LENGTH) {
    throw ApiError.badRequest(
      `A refund request requires a reason of at least ${MIN_REASON_LENGTH} characters`
    );
  }

  const reference = await nextReference("refund", "REF", new Date().getFullYear());

  const refund = await Refund.create({
    reference,
    payment: payment._id,
    invoice: payment.invoice,
    student: payment.student,
    refundAmount: requested,
    reason: reason.trim(),
    status: REFUND_STATUS.REQUESTED,
    requestedBy: user._id,
  });

  await auditService.record({
    action: AUDIT_ACTION.REFUND_REQUESTED,
    entity: "Refund",
    entityId: refund._id,
    entityRef: refund.reference,
    metadata: { amount: requested, paymentId: payment._id },
    actor: user,
    req,
  });

  await notifyOfficers(refund);

  return refund;
}

/**
 * Approve a refund and execute it against the gateway.
 *
 * Approval and execution happen together, but execution failure is recorded
 * rather than swallowed: the refund lands in FAILED with the gateway's reason,
 * so an operator can retry it. The student's money is never marked refunded on
 * a gateway call that failed.
 */
async function approveRefund({ user, refundId, note, req }) {
  if (!userHasPermission(user, P.REFUND_APPROVE)) {
    throw ApiError.forbidden("You do not have permission to approve refunds");
  }

  const refund = await findRefund(refundId);
  if (!refund) {
    throw ApiError.notFound("Refund not found");
  }

  if (refund.status !== REFUND_STATUS.REQUESTED) {
    throw ApiError.conflict(
      `This refund has already been ${refund.status.toLowerCase()}`
    );
  }

  // Re-read the payment and re-derive the bound. Between the request and this
  // approval another refund may have been processed.
  const payment = await Payment.findById(refund.payment);
  if (!payment) {
    throw ApiError.notFound("The payment for this refund no longer exists");
  }

  const refundable = refundableAmount(payment);
  if (refund.refundAmount > refundable) {
    throw new ApiError(
      ERROR_CODE.CONFLICT,
      `Only ${money.format(refundable)} remains refundable on this payment`
    );
  }

  const now = new Date();

  const approved = await Refund.findOneAndUpdate(
    { _id: refund._id, status: REFUND_STATUS.REQUESTED },
    {
      $set: {
        status: REFUND_STATUS.APPROVED,
        approvedBy: user._id,
        approvedAt: now,
        approvalNote: note?.trim(),
      },
    },
    { new: true }
  );

  if (!approved) {
    // Approved concurrently by someone else.
    throw ApiError.conflict("This refund was approved by someone else first");
  }

  // ===== Execute against the gateway =====
  const gateway = getGateway();

  try {
    const result = await gateway.refundPayment({
      paymentId: payment.razorpayPaymentId ?? payment.razorpayOrderId,
      amount: refund.refundAmount,
      reason: refund.reason,
      notes: { refund: refund.reference },
    });

    const processed = await Refund.findOneAndUpdate(
      { _id: refund._id },
      {
        $set: {
          status: REFUND_STATUS.PROCESSED,
          razorpayRefundId: result.id,
          processedBy: user._id,
          processedAt: new Date(),
        },
      },
      { new: true }
    );

    await applyRefundToLedger({
      payment,
      refund: processed,
      amount: refund.refundAmount,
      req,
    });

    await auditService.record({
      action: AUDIT_ACTION.REFUND_PROCESSED,
      entity: "Refund",
      entityId: processed._id,
      entityRef: processed.reference,
      metadata: {
        amount: refund.refundAmount,
        gatewayRefundId: result.id,
        gateway: gateway.name,
      },
      actor: user,
      req,
    });

    await notifyStudent(processed, "Refund processed", refund.refundAmount);

    logger.info(
      { refund: processed.reference, amount: refund.refundAmount, gateway: gateway.name },
      "Refund processed"
    );

    return processed;
  } catch (error) {
    logger.error({ err: error, refund: refund.reference }, "Refund execution failed");

    await Refund.updateOne(
      { _id: refund._id },
      {
        $set: {
          status: REFUND_STATUS.FAILED,
          failureDescription: String(error.message ?? error).slice(0, 500),
        },
      }
    );

    await notifyStudent(refund, "Refund could not be processed", refund.refundAmount);

    throw new ApiError(
      ERROR_CODE.INTEGRATION_ERROR,
      "The refund was approved but the payment provider rejected it. It has been marked FAILED for an operator to retry."
    );
  }
}

/** Reject a refund request. */
async function rejectRefund({ user, refundId, reason, req }) {
  if (!userHasPermission(user, P.REFUND_APPROVE)) {
    throw ApiError.forbidden("You do not have permission to decide refunds");
  }

  const refund = await findRefund(refundId);
  if (!refund) {
    throw ApiError.notFound("Refund not found");
  }

  if (refund.status !== REFUND_STATUS.REQUESTED) {
    throw ApiError.conflict(
      `This refund has already been ${refund.status.toLowerCase()}`
    );
  }

  if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
    throw ApiError.badRequest(
      `A rejection requires a stated reason of at least ${MIN_REASON_LENGTH} characters`
    );
  }

  const rejected = await Refund.findOneAndUpdate(
    { _id: refund._id, status: REFUND_STATUS.REQUESTED },
    {
      $set: {
        status: REFUND_STATUS.REJECTED,
        approvedBy: user._id,
        approvedAt: new Date(),
        approvalNote: reason.trim(),
        rejectionReason: reason.trim(),
      },
    },
    { new: true }
  );

  if (!rejected) {
    throw ApiError.conflict("This refund was decided by someone else first");
  }

  await auditService.record({
    action: AUDIT_ACTION.REFUND_REQUESTED,
    entity: "Refund",
    entityId: rejected._id,
    entityRef: rejected.reference,
    metadata: { decision: "REJECTED" },
    actor: user,
    req,
  });

  await notifyStudent(rejected, "Refund request declined", refund.refundAmount);

  return rejected;
}

/**
 * Record a processed refund against the payment and invoice.
 *
 * The invoice is only reopened when the cumulative refunded total reaches what
 * was credited — a partial refund leaves the invoice settled.
 */
async function applyRefundToLedger({ payment, refund, amount, req }) {
  const newRefunded = money.add(payment.refundedAmount ?? 0, amount);

  await Payment.updateOne(
    { _id: payment._id },
    { $set: { refundedAmount: newRefunded } }
  );

  const credited = payment.capturedAmount ?? payment.amount;
  const fullyRefunded = newRefunded >= credited;

  const invoice = await Invoice.findById(payment.invoice);
  if (!invoice) return;

  if (fullyRefunded) {
    // The money is back with the student; the invoice is no longer settled.
    await Invoice.updateOne(
      { _id: invoice._id },
      {
        $set: {
          paidAmount: 0,
          balanceDue: invoice.total,
          status: INVOICE_STATUS.ISSUED,
          isFullyPaid: false,
          paidAt: null,
        },
      }
    );
  }

  await auditService.record({
    action: AUDIT_ACTION.REFUND_PROCESSED,
    entity: "Invoice",
    entityId: invoice._id,
    entityRef: invoice.reference,
    metadata: {
      refund: refund.reference,
      amount,
      cumulativeRefunded: newRefunded,
      fullyRefunded,
      invoiceReopened: fullyRefunded,
    },
    req,
  });
}

/** List refunds visible to the caller. */
async function listRefunds({ user, filters = {}, page = 1, limit = 20 }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);

  const query =
    user.role === ROLES.STUDENT
      ? { student: user.student }
      : userHasPermission(user, P.PAYMENT_READ_INSTITUTION)
        ? {}
        : { _id: null };

  if (filters.status) query.status = filters.status;

  const [items, total] = await Promise.all([
    Refund.find(query)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate(
        "payment",
        "razorpayPaymentId amount capturedAmount refundedAmount status mode"
      )
      .populate("invoice", "reference status total balanceDue")
      .lean(),
    Refund.countDocuments(query),
  ]);

  return { items, total, page: safePage, limit: safeLimit };
}

/** Fetch one refund, enforcing visibility. */
async function getRefund({ refundId, user }) {
  const refund = await findRefund(refundId)
    .populate("payment", "razorpayPaymentId amount capturedAmount refundedAmount")
    .populate("invoice", "reference total balanceDue");

  if (!refund) {
    throw ApiError.notFound("Refund not found");
  }

  if (user.role === ROLES.STUDENT) {
    if (refund.student.toString() !== user.student?.toString()) {
      throw ApiError.notFound("Refund not found");
    }
  } else if (!userHasPermission(user, P.PAYMENT_READ_INSTITUTION)) {
    throw ApiError.notFound("Refund not found");
  }

  return refund;
}

/** How much of a payment remains refundable — exposed for the client's UI. */
async function refundableFor({ paymentId, user }) {
  const payment = await Payment.findById(paymentId).select(
    "student status amount capturedAmount refundedAmount"
  );

  if (!payment || payment.student.toString() !== user.student?.toString()) {
    throw ApiError.notFound("Payment not found");
  }

  const remaining = refundableAmount(payment);

  return {
    paymentId: payment._id,
    capturedAmount: payment.capturedAmount ?? payment.amount,
    refundedAmount: payment.refundedAmount ?? 0,
    refundableAmount: remaining,
    refundableFormatted: money.format(remaining),
  };
}

async function notifyStudent(refund, title, amount) {
  const userId = await resolveUserId(refund.student);
  if (!userId) return;

  await notificationService.notify({
    userId,
    type: "REFUND_STATUS_CHANGED",
    title: `Refund ${refund.reference}: ${title}`,
    body: `${money.format(amount)} · status ${refund.status.toLowerCase()}`,
    link: `/student/finance/refunds/${refund.reference}`,
    dedupeKey: `refund:${refund._id}:${refund.status}`,
  });
}

async function notifyOfficers(refund) {
  const staff = await require("../models/User")
    .find({ role: ROLES.ACCOUNTS_ADMIN, isActive: true })
    .select("_id")
    .lean();

  await notificationService.notifyMany({
    userIds: staff.map((s) => s._id.toString()),
    type: "REFUND_STATUS_CHANGED",
    title: `Refund request ${refund.reference}`,
    body: `A student has requested a refund of ${money.format(refund.refundAmount)}.`,
    link: `/management/finance/refunds/${refund.reference}`,
    dedupeKeyPrefix: `refund:${refund._id}:requested`,
  });
}

async function resolveUserId(studentId) {
  const student = await Student.findById(studentId).select("user").lean();
  return student?.user?.toString() ?? null;
}

module.exports = {
  findRefund,
  requestRefund,
  approveRefund,
  rejectRefund,
  listRefunds,
  getRefund,
  refundableFor,
  refundableAmount,
  applyRefundToLedger,
  MIN_REASON_LENGTH,
};
