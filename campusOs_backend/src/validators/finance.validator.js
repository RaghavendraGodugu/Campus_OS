/**
 * Finance validators.
 *
 * No schema accepts `total`, `paidAmount` or `balanceDue` — those are derived
 * from line items by `calculateTotals()` and by settled payments. A client
 * sending them gets a 400 naming the field, which is the clearest possible
 * signal that the amount is not client-controlled.
 */

const { z } = require("zod");
const mongoose = require("mongoose");

const {
  PAYMENT_STATUS,
  REFUND_STATUS,
  REFUND_STATUS_VALUES,
} = require("../config/constants");

const objectId = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "Must be a valid identifier",
});

const invoiceIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (value) =>
      mongoose.Types.ObjectId.isValid(value) || /^[A-Z]+-\d{4}-\d{4,}$/.test(value),
    { message: "Must be an invoice id or reference" }
  );

/**
 * A price in major units, as a string.
 *
 * A string rather than a number so Zod never coerces "12.50" into the float
 * 12.5 — `utils/money` converts to integer paise from the string form.
 */
const priceString = z
  .string()
  .trim()
  .regex(
    /^\d+(\.\d{1,2})?$/,
    "Amount must be a positive amount with at most 2 decimal places"
  );

/** A whole-number quantity, so quantity × unit price stays exact. */
const quantity = z.coerce.number().int().min(1).max(999);

/** POST /finance/invoices */
const createInvoiceSchema = z
  .object({
    student: objectId,
    purpose: z.string().trim().min(3).max(300),
    request: objectId.optional(),
    items: z
      .array(
        z
          .object({
            description: z.string().trim().min(2).max(300),
            quantity: quantity.default(1),
            unitAmount: priceString,
            taxPercent: z.coerce.number().min(0).max(100).default(0),
          })
          .strict()
      )
      .min(1, "At least one line item is required")
      .max(50, "An invoice cannot have more than 50 line items"),
    dueAt: z.coerce.date().optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

/** GET /finance/invoices */
const listInvoicesSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z
      .enum([
        "DRAFT",
        "ISSUED",
        "PAID",
        "PARTIALLY_PAID",
        "OVERDUE",
        "CANCELLED",
        "REFUNDED",
      ])
      .optional(),
    outstanding: z.enum(["true", "false"]).optional(),
  })
  .strict();

/** GET /finance/invoices/:id */
const getInvoiceSchema = z.object({ id: invoiceIdentifier }).strict();

/**
 * POST /finance/payments/order
 *
 * An invoice id only. There is deliberately no `amount` field: the amount is
 * read from the invoice's balance, so a client cannot influence it.
 */
const createOrderSchema = z
  .object({
    invoice: invoiceIdentifier,
  })
  .strict();

/**
 * POST /finance/payments/confirm
 *
 * The browser's checkout callback. Recorded, but never sufficient to mark an
 * invoice paid.
 */
const confirmPaymentSchema = z
  .object({
    razorpayOrderId: z.string().trim().min(1).max(100),
    razorpayPaymentId: z.string().trim().min(1).max(100),
    razorpaySignature: z.string().trim().min(16).max(200),
  })
  .strict();

/** GET /finance/payments */
const listPaymentsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(PAYMENT_STATUS).optional(),
  })
  .strict();

/** POST /finance/refunds */
const createRefundSchema = z
  .object({
    payment: objectId,
    /** Omit for a full refund of the remaining captured amount. */
    amount: priceString.optional(),
    reason: z
      .string()
      .trim()
      .min(10, "A refund request requires a reason of at least 10 characters")
      .max(1000),
  })
  .strict();

/** POST /finance/refunds/:id/approve and /reject */
const refundDecisionSchema = z
  .object({
    note: z.string().trim().max(1000).optional(),
    reason: z
      .string()
      .trim()
      .min(10, "A rejection requires a stated reason")
      .max(1000)
      .optional(),
  })
  .strict();

/**
 * GET /finance/refunds
 *
 * Carries paging as well as the status filter. It previously accepted only
 * `status`, while `listRefunds` has always paginated — so any request naming a
 * page or a limit was rejected outright and the list could only ever be read
 * whole. Found when the refund page sent `?page=1&limit=20` and got a 400.
 */
const refundStatusSchema = z
  .object({
    status: z.enum(REFUND_STATUS_VALUES).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

module.exports = {
  createInvoiceSchema,
  listInvoicesSchema,
  getInvoiceSchema,
  createOrderSchema,
  confirmPaymentSchema,
  listPaymentsSchema,
  createRefundSchema,
  refundDecisionSchema,
  refundStatusSchema,
  invoiceIdentifier,
  objectId,
  REFUND_STATUS,
};
