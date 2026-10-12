/**
 * Finance routes.
 *
 * The Razorpay webhook is NOT here — it lives in `paymentWebhook.routes.js` and
 * is mounted in app.js *above* the JSON body parser, because it needs the raw
 * request bytes to verify its signature. Mounting it here would put it behind
 * `express.json()` and the signature could never be checked.
 *
 * There is no webhook verification route in this file by design.
 */

const express = require("express");

const financeController = require("../controllers/finance.controller");
const { validate } = require("../middleware/validate");
const {
  authenticate,
  requirePermission,
  requireAnyPermission,
} = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { P } = require("../utils/permissions");
const {
  createInvoiceSchema,
  listInvoicesSchema,
  getInvoiceSchema,
  createOrderSchema,
  confirmPaymentSchema,
  listPaymentsSchema,
} = require("../validators/finance.validator");

const router = express.Router();

// ===== Invoices =====

/** POST /api/v1/finance/invoices — accounts administration. */
router.post(
  "/finance/invoices",
  authenticate,
  csrfProtection,
  requirePermission(P.INVOICE_MANAGE),
  validate({ body: createInvoiceSchema }),
  financeController.createInvoice
);

/** GET /api/v1/finance/invoices — a student sees their own. */
router.get(
  "/finance/invoices",
  authenticate,
  validate({ query: listInvoicesSchema }),
  financeController.listInvoices
);

/** GET /api/v1/finance/invoices/:id */
router.get(
  "/finance/invoices/:id",
  authenticate,
  validate({ params: getInvoiceSchema }),
  financeController.getInvoice
);

// ===== Payments =====

/**
 * POST /api/v1/finance/payments/order
 *
 * Takes an invoice, never an amount: the chargeable balance is read from the
 * invoice in the service.
 */
router.post(
  "/finance/payments/order",
  authenticate,
  csrfProtection,
  requirePermission(P.PAYMENT_CREATE_OWN),
  validate({ body: createOrderSchema }),
  financeController.createOrder
);

/**
 * POST /api/v1/finance/payments/confirm
 *
 * Records the browser's report. It does **not** mark an invoice paid; only a
 * verified webhook does. The comment is here because it is the single most
 * important thing to know about this endpoint.
 */
router.post(
  "/finance/payments/confirm",
  authenticate,
  csrfProtection,
  validate({ body: confirmPaymentSchema }),
  financeController.confirmPayment
);

/** GET /api/v1/finance/payments */
router.get(
  "/finance/payments",
  authenticate,
  validate({ query: listPaymentsSchema }),
  financeController.listPayments
);

// ===== Reconciliation =====

/**
 * GET /api/v1/finance/reconcile
 *
 * Read-only: reports invoices whose recorded balances disagree with their
 * settled payments. It never silently corrects anything.
 */
router.get(
  "/finance/reconcile",
  authenticate,
  requireAnyPermission(P.PAYMENT_MANAGE, P.INVOICE_MANAGE),
  financeController.reconcile
);

module.exports = router;
