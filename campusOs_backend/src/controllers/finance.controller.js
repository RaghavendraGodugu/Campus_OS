/**
 * Finance controller.
 *
 * HTTP layer only. Amounts are computed in `finance.service`; nothing here
 * accepts or forwards a client-supplied total.
 */

const financeService = require("../services/finance.service");
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

  const { redirect, buffer } = await receiptService.readReceiptBytes({
    storageKey: resolved.storageKey,
  });

  if (redirect) {
    return res.redirect(302, redirect);
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${resolved.filename}"`);
  // A receipt is a private financial document: never cached by a shared proxy.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  return res.send(buffer);
});

module.exports = {
  createInvoice,
  listInvoices,
  getInvoice,
  createOrder,
  confirmPayment,
  listPayments,
  reconcile,
  requestRefund,
  approveRefund,
  rejectRefund,
  listRefunds,
  getRefund,
  refundableForPayment,
  getReceipt,
};
