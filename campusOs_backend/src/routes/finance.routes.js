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
const {
  getInvoiceSchema: invoiceIdentifier,
} = require("../validators/finance.validator");
const { taxProfileSchema } = require("../validators/tax.validator");
const {
  scheduleSchema,
  penaltyPolicySchema,
  penaltySweepSchema,
} = require("../validators/instalment.validator");
const { P } = require("../utils/permissions");
const {
  createInvoiceSchema,
  listInvoicesSchema,
  getInvoiceSchema,
  paymentParamsSchema,
  createOrderSchema,
  confirmPaymentSchema,
  listPaymentsSchema,
  createRefundSchema,
  refundDecisionSchema,
  refundStatusSchema,
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

// ===== Direct gateway verification =====

/**
 * POST /api/v1/finance/payments/verify-pending
 *
 * Declared before `/payments/:id/...` so the literal path is never mistaken
 * for an id. Accounts staff only.
 */
router.post(
  "/finance/payments/verify-pending",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.PAYMENT_MANAGE, P.INVOICE_MANAGE),
  financeController.verifyPending
);

/**
 * POST /api/v1/finance/payments/:id/verify
 *
 * Settlement path for deployments with no public webhook URL. The browser still
 * only supplies an id; Razorpay's authenticated response decides whether money
 * moved. Identical trust anchor to the webhook, different direction.
 */
router.post(
  "/finance/payments/:id/verify",
  authenticate,
  csrfProtection,
  // Validation, like every other `:id` route here: the controller should never
  // be the first thing to see a malformed identifier.
  validate({ params: paymentParamsSchema }),
  financeController.verifyPayment
);

// ===== Receipts =====

/**
 * GET /api/v1/finance/payments/:id/receipt
 *
 * Declared before the refund routes so `payments/:id/receipt` is never read as
 * a refund identifier. Authorization is per-record inside the service: a
 * student receives their own receipts, accounts staff receive all of them, and
 * everyone else gets 404.
 */
router.get(
  "/finance/payments/:id/receipt",
  authenticate,
  validate({ params: paymentParamsSchema }),
  financeController.getReceipt
);

/** GET /api/v1/finance/payments/:id/refundable — drives the student's UI. */
router.get(
  "/finance/payments/:id/refundable",
  authenticate,
  validate({ params: paymentParamsSchema }),
  financeController.refundableForPayment
);

// ===== Refunds =====

/**
 * POST /api/v1/finance/refunds
 *
 * Intent only. No money moves until an authorised officer approves, and the
 * approval is what calls the gateway.
 */
router.post(
  "/finance/refunds",
  authenticate,
  csrfProtection,
  requirePermission(P.REFUND_REQUEST),
  validate({ body: createRefundSchema }),
  financeController.requestRefund
);

/** GET /api/v1/finance/refunds — a student sees only their own. */
router.get(
  "/finance/refunds",
  authenticate,
  validate({ query: refundStatusSchema }),
  financeController.listRefunds
);

/** GET /api/v1/finance/refunds/:id — accepts a reference like REF-2026-000001. */
router.get("/finance/refunds/:id", authenticate, financeController.getRefund);

/**
 * POST /api/v1/finance/refunds/:id/approve
 *
 * Permissioned to REFUND_APPROVE, not merely to being an administrator. Approval
 * calls the provider, so a gateway failure marks the refund FAILED for an
 * operator to retry rather than reporting a refund that never happened.
 */
router.post(
  "/finance/refunds/:id/approve",
  authenticate,
  csrfProtection,
  requirePermission(P.REFUND_APPROVE),
  validate({ body: refundDecisionSchema }),
  financeController.approveRefund
);

/** POST /api/v1/finance/refunds/:id/reject — a reason is mandatory. */
router.post(
  "/finance/refunds/:id/reject",
  authenticate,
  csrfProtection,
  requirePermission(P.REFUND_APPROVE),
  validate({ body: refundDecisionSchema }),
  financeController.rejectRefund
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

/**
 * Instalments and penalties.
 *
 * All institution-scoped. A student can read their own invoice and see a
 * schedule on it, but splitting an invoice into instalments or setting a
 * penalty rate is the accounts department's call alone.
 */
router.post(
  "/invoices/penalty-sweep",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.INVOICE_MANAGE),
  validate({ body: penaltySweepSchema }),
  financeController.sweepPenalties
);

router.post(
  "/invoices/:id/schedule",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.INVOICE_MANAGE),
  validate({ params: invoiceIdentifier, body: scheduleSchema }),
  financeController.scheduleInstalments
);

router.get(
  "/invoices/:id/schedule",
  authenticate,
  requireAnyPermission(P.INVOICE_READ_INSTITUTION, P.INVOICE_READ_OWN),
  validate({ params: invoiceIdentifier }),
  financeController.getSchedule
);

router.patch(
  "/invoices/:id/penalty-policy",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.INVOICE_MANAGE),
  validate({ params: invoiceIdentifier, body: penaltyPolicySchema }),
  financeController.setPenaltyPolicy
);

/**
 * The institution's GST profile.
 *
 * Institution-scoped and separate from the invoice routes: there is one
 * supplier, and its registration is not a thing any single department can
 * change. Reads are open to anyone who can issue an invoice, because creating
 * one needs to know whether the institution is registered at all.
 */
router.get(
  "/tax-profile",
  authenticate,
  requireAnyPermission(P.INVOICE_READ_INSTITUTION, P.INVOICE_READ_OWN),
  financeController.getTaxProfile
);

router.put(
  "/tax-profile",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.INVOICE_MANAGE),
  validate({ body: taxProfileSchema }),
  financeController.saveTaxProfile
);

router.delete(
  "/tax-profile",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.INVOICE_MANAGE),
  financeController.deleteTaxProfile
);

module.exports = router;
