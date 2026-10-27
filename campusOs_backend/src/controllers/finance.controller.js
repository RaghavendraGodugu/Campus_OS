/**
 * Finance controller.
 *
 * HTTP layer only. Amounts are computed in `finance.service`; nothing here
 * accepts or forwards a client-supplied total.
 */

const financeService = require("../services/finance.service");
const taxProfileService = require("../services/taxProfile.service");
const refundService = require("../services/refund.service");
const receiptService = require("../services/receipt.service");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated, sendPaginated } = require("../utils/response");
const money = require("../utils/money");

/** POST /api/v1/finance/invoices — accounts staff only. */
const createInvoice = asyncHandler(async (req, res) => {
  const { student, purpose, items, request, dueAt, notes } = req.validated.body;

  const invoice = await financeService.createInvoice({
    user: req.user,
    studentId: student,
    purpose,
    items,
    request,
    dueAt,
    notes,
    req,
  });

  return sendCreated(res, {
    message: "Invoice created",
    data: {
      reference: invoice.reference,
      status: invoice.status,
      subtotal: invoice.subtotal,
      taxTotal: invoice.taxTotal,
      total: invoice.total,
      totalFormatted: money.format(invoice.total),
      balanceDue: invoice.balanceDue,
    },
  });
});

/** GET /api/v1/finance/invoices */
const listInvoices = asyncHandler(async (req, res) => {
  const { page, limit, ...filters } = req.validated.query;

  const result = await financeService.listInvoices({
    user: req.user,
    filters,
    page,
    limit,
  });

  return sendPaginated(res, {
    items: result.items.map((invoice) => ({
      ...invoice,
      totalFormatted: money.format(invoice.total),
      balanceDueFormatted: money.format(invoice.balanceDue),
    })),
    total: result.total,
    page: result.page,
    limit: result.limit,
    message: "Invoices retrieved successfully",
  });
});

/** GET /api/v1/finance/invoices/:id */
const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await financeService.getInvoice({
    invoiceId: req.validated.params.id,
    user: req.user,
  });

  return sendSuccess(res, {
    message: "Invoice retrieved successfully",
    data: {
      ...invoice.toJSON(),
      totalFormatted: money.format(invoice.total),
      paidFormatted: money.format(invoice.paidAmount),
      balanceDueFormatted: money.format(invoice.balanceDue),
    },
  });
});

/**
 * POST /api/v1/finance/payments/order
 *
 * Returns the order plus the publishable key. The key secret and the webhook
 * secret never appear in any response.
 */
const createOrder = asyncHandler(async (req, res) => {
  const result = await financeService.createOrder({
    user: req.user,
    invoiceId: req.validated.body.invoice,
    req,
  });

  return sendCreated(res, {
    message: "Payment order created",
    data: {
      paymentId: result.payment._id,
      razorpayOrderId: result.order.orderId,
      // Minor units, matching what the gateway expects.
      amount: result.order.amount,
      currency: result.order.currency,
      amountFormatted: money.format(result.order.amount),
      keyId: result.keyId,
      // Surfaces clearly that no real money is moving.
      isMock: result.isMock,
      // LIVE / TEST / MOCK, so the client can label the checkout honestly
      // rather than presenting a sandbox payment as a real one.
      mode: result.mode,
    },
  });
});

/** POST /api/v1/finance/payments/confirm — records, does not settle. */
const confirmPayment = asyncHandler(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.validated.body;

  const result = await financeService.confirmPayment({
    user: req.user,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    req,
  });

  return sendSuccess(res, {
    message: result.message,
    data: { verified: result.verified, status: result.status },
  });
});

/** GET /api/v1/finance/payments */
const listPayments = asyncHandler(async (req, res) => {
  const { page, limit, ...filters } = req.validated.query;

  const result = await financeService.listPayments({
    user: req.user,
    filters,
    page,
    limit,
  });

  return sendPaginated(res, {
    items: result.items.map((payment) => ({
      ...payment,
      amountFormatted: money.format(payment.amount),
    })),
    total: result.total,
    page: result.page,
    limit: result.limit,
    message: "Payments retrieved successfully",
  });
});

/** POST /api/v1/finance/reconcile — accounts staff. Reports, does not mutate. */
const reconcile = asyncHandler(async (req, res) => {
  const result = await financeService.reconcile({ req });

  return sendSuccess(res, {
    message: result.clean
      ? `Reconciled ${result.checked} invoices; all balances agree with their payments`
      : `Reconciled ${result.checked} invoices; ${result.discrepancies.length} discrepancy(ies) found`,
    data: {
      checked: result.checked,
      clean: result.clean,
      discrepancies: result.discrepancies,
      at: result.at,
    },
  });
});

/**
 * POST /api/v1/finance/payments/:id/verify
 *
 * Asks Razorpay whether the payment was really captured, and settles only if
 * it says so. This is the settlement path for a deployment that cannot receive
 * webhooks — it is not a weaker form of the webhook, because the decision comes
 * from Razorpay's authenticated response rather than from this request.
 */
const verifyPayment = asyncHandler(async (req, res) => {
  const outcome = await financeService.verifyPaymentWithGateway({
    user: req.user,
    paymentId: req.params.id,
    req,
  });

  const settled = outcome.applied;

  return sendSuccess(res, {
    message: settled
      ? "Payment confirmed by Razorpay and the invoice has been credited"
      : describeUnapplied(outcome),
    data: {
      applied: settled,
      reason: outcome.reason,
      status: outcome.status,
      capturedAmount: outcome.capturedAmount ?? null,
      capturedAmountFormatted:
        outcome.capturedAmount === undefined || outcome.capturedAmount === null
          ? null
          : money.format(outcome.capturedAmount),
    },
  });
});

/** Human wording for the reasons verification can decline to settle. */
function describeUnapplied(outcome) {
  switch (outcome.reason) {
    case "already_settled":
      return "This payment is already recorded as settled";
    case "not_yet_captured":
      return `Razorpay reports this payment as "${outcome.gatewayStatus}". It has not been captured yet, so nothing was credited.`;
    case "payment_failed":
      return "Razorpay reports this payment as failed. Nothing was charged.";
    default:
      return "The payment could not be confirmed, so nothing was credited";
  }
}

/**
 * POST /api/v1/finance/payments/verify-pending
 *
 * Sweeps payments left ATTEMPTED — the students who closed the browser after
 * paying. Without webhooks nothing else would ever revisit them.
 */
const verifyPending = asyncHandler(async (req, res) => {
  const { limit } = req.validated?.query ?? {};
  const results = await financeService.verifyPendingPayments({
    user: req.user,
    limit,
    req,
  });

  return sendSuccess(res, {
    message:
      `Checked ${results.checked} pending payment(s): ${results.settled} settled, ` +
      `${results.failed} failed, ${results.stillPending} still awaiting capture` +
      (results.errors ? `, ${results.errors} could not be checked` : ""),
    data: results,
  });
});

// ===== Refunds =====

/**
 * POST /api/v1/finance/refunds — a student requests a refund.
 *
 * Records intent only. No money moves here; approval is a separate,
 * permissioned act performed by accounts staff.
 */
const requestRefund = asyncHandler(async (req, res) => {
  const { payment, amount, reason } = req.validated.body;

  const refund = await refundService.requestRefund({
    user: req.user,
    paymentId: payment,
    amount,
    reason,
    req,
  });

  return sendCreated(res, {
    message: "Refund requested. An accounts administrator will review it.",
    data: {
      refund: {
        id: refund._id,
        reference: refund.reference,
        refundAmount: refund.refundAmount,
        refundAmountFormatted: money.format(refund.refundAmount),
        status: refund.status,
        reason: refund.reason,
        requestedAt: refund.requestedAt ?? refund.createdAt,
      },
    },
  });
});

/** POST /api/v1/finance/refunds/:id/approve — executes against the gateway. */
const approveRefund = asyncHandler(async (req, res) => {
  const { note } = req.validated.body ?? {};

  const refund = await refundService.approveRefund({
    user: req.user,
    refundId: req.params.id,
    note,
    req,
  });

  return sendSuccess(res, {
    message:
      refund.status === "PROCESSED"
        ? `Refund ${refund.reference} processed and the provider has confirmed it`
        : `Refund ${refund.reference} updated`,
    data: {
      refund: {
        id: refund._id,
        reference: refund.reference,
        refundAmount: refund.refundAmount,
        refundAmountFormatted: money.format(refund.refundAmount),
        status: refund.status,
        razorpayRefundId: refund.razorpayRefundId,
      },
    },
  });
});

/** POST /api/v1/finance/refunds/:id/reject — requires a stated reason. */
const rejectRefund = asyncHandler(async (req, res) => {
  const { reason } = req.validated.body ?? {};

  const refund = await refundService.rejectRefund({
    user: req.user,
    refundId: req.params.id,
    reason,
    req,
  });

  return sendSuccess(res, {
    message: `Refund ${refund.reference} declined`,
    data: {
      refund: {
        id: refund._id,
        reference: refund.reference,
        status: refund.status,
        rejectionReason: refund.rejectionReason,
      },
    },
  });
});

/** GET /api/v1/finance/refunds — students see their own. */
const listRefunds = asyncHandler(async (req, res) => {
  const { page, limit, status } = req.validated.query;

  const result = await refundService.listRefunds({
    user: req.user,
    filters: { status },
    page,
    limit,
  });

  return sendPaginated(res, {
    items: result.items.map((refund) => ({
      ...refund,
      refundAmountFormatted: money.format(refund.refundAmount),
    })),
    total: result.total,
    page: result.page,
    limit: result.limit,
    message: "Refunds retrieved successfully",
  });
});

/** GET /api/v1/finance/refunds/:id — accepts a reference or an ObjectId. */
const getRefund = asyncHandler(async (req, res) => {
  const refund = await refundService.getRefund({
    refundId: req.params.id,
    user: req.user,
  });

  return sendSuccess(res, {
    message: "Refund retrieved successfully",
    data: {
      refund: {
        ...(refund.toObject ? refund.toObject() : refund),
        refundAmountFormatted: money.format(refund.refundAmount),
      },
    },
  });
});

/** GET /api/v1/finance/payments/:id/refundable — how much is left to refund. */
const refundableForPayment = asyncHandler(async (req, res) => {
  const data = await refundService.refundableFor({
    paymentId: req.params.id,
    user: req.user,
  });

  return sendSuccess(res, {
    message: "Refundable amount retrieved successfully",
    data,
  });
});

// ===== Receipts =====

/**
 * GET /api/v1/finance/payments/:id/receipt
 *
 * Authorization is decided from the stored payment record inside the service,
 * before any bytes or URL are produced. A receipt for someone else's payment is
 * reported as 404, not 403 — its existence is not disclosed.
 */
const getReceipt = asyncHandler(async (req, res) => {
  const resolved = await receiptService.resolveReceipt({
    paymentId: req.params.id,
    user: req.user,
  });

  const { buffer } = await receiptService.readReceiptBytes({
    storageKey: resolved.storageKey,
    mimeType: "application/pdf",
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${resolved.filename}"`);
  // A receipt is a private financial document: never cached by a shared proxy.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  return res.send(buffer);
});

/** POST /api/v1/invoices/:id/schedule — split into instalments. */
const scheduleInstalments = asyncHandler(async (req, res) => {
  const instalments = await financeService.scheduleInstalments({
    user: req.user,
    invoiceId: req.params.id,
    ...req.validated.body,
    req,
  });

  return sendCreated(res, {
    message: `Scheduled into ${instalments.length} instalments`,
    data: { instalments },
  });
});

/** GET /api/v1/invoices/:id/schedule */
const getSchedule = asyncHandler(async (req, res) => {
  const schedule = await financeService.getSchedule({ invoiceId: req.params.id });
  return sendSuccess(res, { message: "Schedule retrieved", data: schedule });
});

/** PATCH /api/v1/invoices/:id/penalty-policy */
const setPenaltyPolicy = asyncHandler(async (req, res) => {
  const penalty = await financeService.setPenaltyPolicy({
    user: req.user,
    invoiceId: req.params.id,
    policy: req.validated.body,
    req,
  });

  return sendSuccess(res, { message: "Penalty policy updated", data: { penalty } });
});

/**
 * POST /api/v1/invoices/penalty-sweep
 *
 * Declared before `/:id` routes so the literal segment is never captured as an
 * invoice id. Defaults to a dry run: a sweep that silently charges forty
 * students 2% each should be opt-in, not the default.
 */
const sweepPenalties = asyncHandler(async (req, res) => {
  const result = await financeService.sweepPenalties({
    user: req.user,
    invoiceIds: req.validated.body.invoiceIds,
    dryRun: req.validated.body.dryRun,
    req,
  });

  return sendSuccess(res, {
    message: result.dryRun
      ? `Would charge ${result.charged.length} invoice(s); nothing was written`
      : `Charged ${result.charged.length} invoice(s)`,
    data: result,
  });
});

/** GET /api/v1/tax-profile — null when none is set up. */
const getTaxProfile = asyncHandler(async (req, res) => {
  const profile = await taxProfileService.get();
  return sendSuccess(res, {
    message: profile ? "GST profile retrieved" : "No GST profile is set up",
    data: { profile },
  });
});

/** PUT /api/v1/tax-profile — create or replace. */
const saveTaxProfile = asyncHandler(async (req, res) => {
  const profile = await taxProfileService.save({
    user: req.user,
    payload: req.validated.body,
  });
  return sendSuccess(res, { message: "GST profile saved", data: { profile } });
});

/** DELETE /api/v1/tax-profile */
const deleteTaxProfile = asyncHandler(async (req, res) => {
  await taxProfileService.remove({ user: req.user });
  return sendSuccess(res, { message: "GST profile removed", data: { removed: true } });
});

module.exports = {
  createInvoice,
  listInvoices,
  getInvoice,
  createOrder,
  confirmPayment,
  listPayments,
  reconcile,
  verifyPayment,
  verifyPending,
  requestRefund,
  approveRefund,
  rejectRefund,
  listRefunds,
  getRefund,
  refundableForPayment,
  getReceipt,

  scheduleInstalments,
  getSchedule,
  setPenaltyPolicy,
  sweepPenalties,

  getTaxProfile,
  saveTaxProfile,
  deleteTaxProfile,
};
