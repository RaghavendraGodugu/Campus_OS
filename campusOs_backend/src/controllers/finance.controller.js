/**
 * Finance controller.
 *
 * HTTP layer only. Amounts are computed in `finance.service`; nothing here
 * accepts or forwards a client-supplied total.
 */

const financeService = require("../services/finance.service");
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

module.exports = {
  createInvoice,
  listInvoices,
  getInvoice,
  createOrder,
  confirmPayment,
  listPayments,
  reconcile,
};
