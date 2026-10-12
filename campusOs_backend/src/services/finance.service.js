/**
 * Finance service.
 *
 * ## Where the amount comes from
 *
 * `createOrder()` takes an **invoice id**, never an amount. The amount charged
 * is `invoice.balanceDue`, read from the database. A client-supplied amount is
 * not merely ignored — there is no parameter to accept one, so the failure mode
 * is a compile error rather than a tampered transaction.
 *
 * ## Where the payment becomes real
 *
 * Three separate events, and only the last one moves money:
 *
 *  1. `createOrder`     — creates a gateway order and a CREATED payment.
 *  2. `confirmPayment`  — the browser callback. Records that the client said
 *     success and whether its signature verified. **Never** marks paid.
 *  3. `applyWebhookEvent` — a signed webhook. This, and only this, sets PAID.
 *
 * A student who closes the browser after paying still gets their receipt,
 * because the webhook arrives independently of any browser.
 */

const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const Student = require("../models/Student");
const Counter = require("../models/Counter");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { userHasPermission, P } = require("../utils/permissions");
const {
  ROLES,
  INVOICE_STATUS,
  PAYMENT_STATUS,
  AUDIT_ACTION,
} = require("../config/constants");
const { getGateway, verifyPaymentSignature } = require("../config/razorpay");
const money = require("../utils/money");
const { logger } = require("../config/logger");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");

const { counterKey, formatReference } = Counter;

/** Generate a sequential reference for an entity in a given year. */
async function nextReference(namespace, prefix, year = new Date().getFullYear()) {
  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey(namespace, year) },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return formatReference(prefix, year, counter.seq);
}

/**
 * Compute invoice totals from line items.
 *
 * This is the only place an invoice total is produced. It is pure, so it can be
 * unit-tested directly, and it rounds each line's tax exactly once — rounding a
 * summed tax total instead would drift from the sum of the printed line taxes.
 *
 * @param {Array<object>} items
 * @returns {{items: object[], subtotal: number, taxTotal: number, total: number}}
 */
function calculateTotals(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest("An invoice requires at least one line item");
  }

  const pricedLines = items.map((item) => {
    const quantity = money.assertInRange ? item.quantity : item.quantity;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw ApiError.badRequest(
        `Quantity for "${item.description}" must be a whole number`
      );
    }

    const unitAmount = money.toMinor(String(item.unitAmount ?? 0));
    const amount = money.multiply(unitAmount, quantity);

    if (amount === 0 && (unitAmount !== 0 || quantity === 0)) {
      // A zero-priced line is legitimate (a waiver); nothing to assert.
    }

    const taxPercent = item.taxPercent ?? 0;
    const taxAmount = money.percentageOf(amount, taxPercent);

    return {
      description: String(item.description).trim(),
      quantity,
      unitAmount,
      amount,
      taxPercent,
      taxAmount,
    };
  });

  const subtotal = pricedLines.reduce((sum, line) => money.add(sum, line.amount), 0);
  const taxTotal = pricedLines.reduce((sum, line) => money.add(sum, line.taxAmount), 0);
  const total = money.add(subtotal, taxTotal);

  return { items: pricedLines, subtotal, taxTotal, total };
}

/**
 * Create an invoice.
 *
 * The caller supplies line *descriptions and prices from the institution's fee
 * structure*; the arithmetic is done here. `total` is never accepted.
 */
async function createInvoice({
  user,
  studentId,
  purpose,
  items,
  request,
  dueAt,
  notes,
  req,
}) {
  if (!userHasPermission(user, P.INVOICE_MANAGE)) {
    throw ApiError.forbidden("You do not have permission to create invoices");
  }

  const student = await Student.findById(studentId);
  if (!student) {
    throw ApiError.notFound("Student not found");
  }

  const totals = calculateTotals(items);

  if (totals.total <= 0) {
    throw ApiError.badRequest("An invoice must total more than zero");
  }

  const now = new Date();
  const reference = await nextReference("invoice", "INV", now.getFullYear());

  const invoice = await Invoice.create({
    reference,
    student: student._id,
    purpose: purpose.trim(),
    request: request ?? null,
    items: totals.items,
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    discount: 0,
    balanceDue: totals.total,
    status: INVOICE_STATUS.ISSUED,
    issuedAt: now,
    dueAt: dueAt ?? new Date(now.getTime() + 14 * 86_400_000),
    issuedBy: user._id,
    notes,
  });

  await auditService.record({
    action: AUDIT_ACTION.CREATE,
    entity: "Invoice",
    entityId: invoice._id,
    entityRef: invoice.reference,
    // Amounts are recorded; the spec permits this, and finance staff need it.
    metadata: {
      total: invoice.total,
      currency: invoice.currency,
      itemCount: invoice.items.length,
    },
    actor: user,
    req,
  });

  return invoice;
}

/**
 * Fetch an invoice the caller may see.
 *
 * Students see their own; accounts staff see institution-wide. Unauthorised
 * callers get 404, matching the convention elsewhere.
 */
async function getInvoice({ invoiceId, user }) {
  const invoice = await Invoice.findOne(
    /^[a-f\d]{24}$/i.test(String(invoiceId))
      ? { _id: invoiceId }
      : { reference: String(invoiceId) }
  ).populate("student", "rollNumber fullName");

  if (!invoice) {
    throw ApiError.notFound("Invoice not found");
  }

  if (!canReadInvoice(invoice, user)) {
    throw ApiError.notFound("Invoice not found");
  }

  return invoice;
}

function canReadInvoice(invoice, user) {
  if (user.role === ROLES.STUDENT) {
    return invoice.student?._id?.toString() === user.student?.toString();
  }
  return userHasPermission(user, P.INVOICE_READ_INSTITUTION);
}

/** List invoices visible to the caller. */
async function listInvoices({ user, filters = {}, page = 1, limit = 20 }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);

  const query =
    user.role === ROLES.STUDENT
      ? { student: user.student }
      : userHasPermission(user, P.INVOICE_READ_INSTITUTION)
        ? {}
        : { _id: null };

  if (filters.status) query.status = filters.status;
  if (filters.outstanding === "true") query.balanceDue = { $gt: 0 };

  const [items, total] = await Promise.all([
    Invoice.find(query)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("student", "rollNumber")
      .lean(),
    Invoice.countDocuments(query),
  ]);

  return { items, total, page: safePage, limit: safeLimit };
}

/**
 * Begin a payment.
 *
 * Takes an invoice, not an amount. The amount charged is the invoice's
 * `balanceDue` as read here, so a tampered client cannot influence it.
 */
async function createOrder({ user, invoiceId, req }) {
  if (user.role !== ROLES.STUDENT) {
    throw ApiError.forbidden(
      "Only students can initiate payments against their own invoices"
    );
  }

  const invoice = await getInvoice({ invoiceId, user });

  if (invoice.status === INVOICE_STATUS.PAID) {
    throw ApiError.conflict("This invoice is already paid");
  }
  if (invoice.status === INVOICE_STATUS.CANCELLED) {
    throw ApiError.badRequest("This invoice has been cancelled");
  }

  const amountDue = invoice.balanceDue;

  if (!money.isPayableAmount(amountDue)) {
    throw ApiError.badRequest("This invoice has no payable balance");
  }

  const gateway = getGateway();

  const order = await gateway.createOrder({
    // Minor units — exactly what Razorpay expects, so no conversion happens.
    amount: amountDue,
    currency: invoice.currency,
    receipt: invoice.reference,
    notes: { invoice: invoice.reference, student: invoice.student?.toString() },
  });

  const payment = await Payment.create({
    invoice: invoice._id,
    student: invoice.student,
    amount: amountDue,
    currency: invoice.currency,
    razorpayOrderId: order.orderId,
    status: PAYMENT_STATUS.CREATED,
    // Recorded on the payment so the receipt can state plainly whether it
    // documents a live payment, a Razorpay test payment, or a local mock.
    mode: gateway.isMock ? "MOCK" : (gateway.mode ?? "LIVE"),
    notes: gateway.isMock ? "Created against the MOCK gateway" : undefined,
  });

  await auditService.record({
    action: AUDIT_ACTION.PAYMENT_INITIATED,
    entity: "Payment",
    entityId: payment._id,
    metadata: {
      amount: amountDue,
      invoice: invoice.reference,
      gateway: gateway.name,
      // Recording that the mock was used is how a non-production deployment is
      // identifiable later.
      mock: gateway.isMock,
    },
    actor: user,
    req,
  });

  return {
    payment,
    order: {
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
    },
    // The publishable key is public by design; the secret never leaves the server.
    keyId: gateway.publishableKey,
    isMock: gateway.isMock,
    mode: payment.mode,
  };
}

/**
 * Record the browser's checkout callback.
 *
 * **This never marks an invoice paid.** It verifies the checkout signature and
 * stores the outcome for audit, because a failed signature here is worth
 * investigating even though it has no financial effect.
 */
/**
 * Settle a payment by asking Razorpay directly, for deployments with no webhook.
 *
 * ## Why this is not "trusting the browser"
 *
 * The rule this module exists to enforce is that an invoice is never marked
 * paid on the word of the client. This function keeps that rule intact. The
 * browser still only supplies an id; the *decision* comes from Razorpay's own
 * authenticated response, reached with the key secret over the server's own
 * connection. A student who invents a payment id gets a 400 from Razorpay and
 * settles nothing.
 *
 * Webhooks and this path differ only in who initiates the conversation. Both
 * rely on the same trust anchor — Razorpay's key secret — and both ignore what
 * the browser claims. A webhook is preferable because it is push and cannot be
 * forgotten, but it requires a publicly reachable URL, which a project under
 * development does not have. This is the honest fallback, not a weaker door.
 *
 * ## Every cross-check the webhook gets, it gets here too
 *
 * The payment must belong to the order we created, must actually be captured,
 * and must not report more than we ever asked for. Amount and status come from
 * Razorpay; nothing is taken from the request.
 *
 * ## Idempotent, and idempotent *with* the webhook
 *
 * Verification only proceeds from a payment that is not already settled, and
 * crediting is guarded on the invoice balance, so running it after a real
 * webhook is a no-op rather than a double credit.
 *
 * @param {object} params
 * @param {object} params.user    Owner (student) or accounts staff.
 * @param {string} params.paymentId
 * @param {object} [params.req]
 */
async function verifyPaymentWithGateway({ user, paymentId, req }) {
  const payment = await Payment.findById(paymentId);

  if (!payment) {
    throw ApiError.notFound("Payment not found");
  }

  const isOwner = payment.student?.toString() === user.student?.toString();
  const isStaff = userHasPermission(user, P.PAYMENT_READ_INSTITUTION);

  if (!isOwner && !isStaff) {
    throw ApiError.notFound("Payment not found");
  }

  // Already settled — by a webhook or an earlier verification. Settling twice
  // must be impossible, whichever path got here first.
  if (payment.status === PAYMENT_STATUS.PAID) {
    return {
      applied: false,
      reason: "already_settled",
      status: payment.status,
      invoice: payment.invoice,
    };
  }

  if (!payment.razorpayPaymentId) {
    throw ApiError.badRequest(
      "This payment has no gateway reference yet. Report the payment from checkout first."
    );
  }

  const gateway = getGateway();

  // ===== The authoritative step: ask Razorpay. =====
  let observed;
  try {
    // The expected order is passed as context. Razorpay reports the order
    // itself and ignores it; a local mock needs it to answer consistently.
    observed = await gateway.fetchPayment(payment.razorpayPaymentId, {
      orderId: payment.razorpayOrderId,
    });
  } catch (error) {
    const description =
      error?.error?.description ?? error?.description ?? error?.message ?? "";

    logger.warn(
      { paymentId: payment._id, description },
      "Could not retrieve the payment from the gateway"
    );

    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          status: PAYMENT_STATUS.ATTEMPTED,
          gatewayLookup: {
            attemptedAt: new Date(),
            succeeded: false,
            description: String(description).slice(0, 300),
          },
        },
      }
    );

    // A lookup failure is never a failure of the payment — Razorpay may simply
    // not have propagated it yet. It stays ATTEMPTED so a later sweep can retry.
    throw new ApiError(
      ERROR_CODE.INTEGRATION_ERROR,
      `The payment provider could not confirm this payment yet: ${description || "no reason given"}. It remains unpaid until confirmed.`
    );
  }

  // ===== Cross-check what Razorpay said against what we created. =====

  if (observed.orderId !== payment.razorpayOrderId) {
    logger.error(
      {
        paymentId: payment._id,
        reportedOrder: observed.orderId,
        expectedOrder: payment.razorpayOrderId,
      },
      "Gateway reported a payment against a different order"
    );

    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          status: PAYMENT_STATUS.FAILED,
          gatewayLookup: {
            attemptedAt: new Date(),
            succeeded: false,
            description: "Order mismatch",
          },
        },
      }
    );

    throw ApiError.conflict(
      "The payment does not belong to this order. Nothing has been charged to your account."
    );
  }

  if (observed.status !== "captured") {
    // Not captured yet: failed, authorized, created, or still in flight.
    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          status:
            observed.status === "failed"
              ? PAYMENT_STATUS.FAILED
              : PAYMENT_STATUS.ATTEMPTED,
          gatewayLookup: {
            attemptedAt: new Date(),
            succeeded: true,
            gatewayStatus: observed.status,
          },
        },
      }
    );

    await notifyPaymentOutcome(
      payment,
      observed.status === "failed" ? "failed" : "pending"
    );

    return {
      applied: false,
      reason: observed.status === "failed" ? "payment_failed" : "not_yet_captured",
      gatewayStatus: observed.status,
      status:
        observed.status === "failed" ? PAYMENT_STATUS.FAILED : PAYMENT_STATUS.ATTEMPTED,
    };
  }

  const reportedAmount = Number(observed.amount);

  // Razorpay reporting more than we ever ordered is not a partial capture; it
  // is a mismatch, and crediting it would inflate the ledger.
  if (reportedAmount > payment.amount) {
    logger.error(
      { paymentId: payment._id, reportedAmount, ordered: payment.amount },
      "Gateway reported a captured amount larger than the order"
    );

    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          status: PAYMENT_STATUS.FAILED,
          gatewayLookup: {
            attemptedAt: new Date(),
            succeeded: true,
            description: "Amount exceeds order",
          },
        },
      }
    );

    throw ApiError.conflict(
      "The payment provider reported an amount larger than the order. This has been flagged for review."
    );
  }

  // ===== Settle. Crediting remains guarded on the invoice balance. =====
  const settled = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: PAYMENT_STATUS.PAID } },
    {
      $set: {
        status: PAYMENT_STATUS.PAID,
        capturedAmount: reportedAmount,
        verifiedAt: new Date(),
        verifiedVia: "gateway_api",
        gatewayLookup: {
          attemptedAt: new Date(),
          succeeded: true,
          gatewayStatus: observed.status,
        },
      },
    },
    { new: true }
  );

  if (!settled) {
    // A webhook won the race. Its credit stands; this call changes nothing.
    logger.info(
      { paymentId: payment._id },
      "Payment settled concurrently by another path"
    );
    return { applied: false, reason: "already_settled", status: PAYMENT_STATUS.PAID };
  }

  await creditInvoice(settled);

  await auditService.record({
    action: AUDIT_ACTION.PAYMENT_VERIFIED,
    entity: "Payment",
    entityId: settled._id,
    entityRef: settled.razorpayPaymentId,
    metadata: {
      amount: reportedAmount,
      method: observed.method,
      verifiedVia: "gateway_api",
      // Recorded so an auditor can tell a polled settlement from a pushed one.
      gatewayStatus: observed.status,
    },
    actor: user,
    req,
  });

  logger.info(
    { paymentId: settled._id, amount: reportedAmount },
    "Payment settled by direct gateway verification"
  );

  return {
    applied: true,
    reason: "captured",
    status: PAYMENT_STATUS.PAID,
    capturedAmount: reportedAmount,
    invoice: settled.invoice,
  };
}

/**
 * Settle every still-unsettled payment that has a gateway reference.
 *
 * The counterpart to webhooks for a deployment that cannot receive them: a
 * student who closed the browser after paying would otherwise stay ATTEMPTED
 * forever. Accounts staff run this; it only reads from the gateway and settles
 * what Razorpay confirms.
 */
async function verifyPendingPayments({ user, limit = 25, req }) {
  if (!userHasPermission(user, P.PAYMENT_MANAGE)) {
    throw ApiError.forbidden("You do not have permission to verify payments");
  }

  const candidates = await Payment.find({
    status: PAYMENT_STATUS.ATTEMPTED,
    razorpayPaymentId: { $ne: null },
  })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(1, Number(limit) || 25), 100))
    .select("_id status")
    .lean();

  const results = { checked: 0, settled: 0, failed: 0, stillPending: 0, errors: 0 };

  for (const candidate of candidates) {
    results.checked += 1;
    try {
      const outcome = await verifyPaymentWithGateway({
        user,
        paymentId: candidate._id.toString(),
        req,
      });

      if (outcome.applied) results.settled += 1;
      else if (outcome.reason === "payment_failed") results.failed += 1;
      else if (outcome.reason === "not_yet_captured") results.stillPending += 1;
    } catch (error) {
      // One unreachable payment must not abandon the rest of the sweep.
      results.errors += 1;
      logger.warn(
        { paymentId: candidate._id, message: error.message },
        "Payment verification failed during sweep"
      );
    }
  }

  logger.info({ results }, "Pending payment sweep complete");
  return results;
}

async function confirmPayment({
  user,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  req,
}) {
  const payment = await Payment.findOne({ razorpayOrderId });
  if (!payment) {
    throw ApiError.notFound("Payment not found");
  }

  if (payment.student.toString() !== user.student?.toString()) {
    throw ApiError.notFound("Payment not found");
  }

  const gateway = getGateway();
  const verified = verifyPaymentSignature({
    orderId: razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    keySecret: gateway.keySecret ?? gateway.keyId,
  });

  await Payment.updateOne(
    { _id: payment._id },
    {
      $set: {
        status: PAYMENT_STATUS.ATTEMPTED,
        razorpayPaymentId,
        clientReportedSuccess: {
          reportedAt: new Date(),
          signatureVerified: verified,
        },
      },
    }
  );

  if (!verified) {
    // Recorded, not silently ignored: someone reported success for an order with
    // an invalid signature, which is worth an administrator's attention.
    logger.warn(
      { paymentId: payment._id, orderId: razorpayOrderId, verified },
      "Client reported payment success with an invalid signature — awaiting webhook"
    );
    await auditService.record({
      action: AUDIT_ACTION.ACCESS_DENIED,
      entity: "Payment",
      entityId: payment._id,
      metadata: { event: "CHECKOUT_SIGNATURE_INVALID", verified },
      actor: user,
      req,
    });
  }

  // The client is told to wait for confirmation. The webhook decides.
  return {
    verified,
    status: PAYMENT_STATUS.ATTEMPTED,
    message: verified
      ? "Payment reported. Waiting for bank confirmation."
      : "Payment could not be verified. It will not be accepted until confirmed.",
  };
}

/**
 * Apply a verified webhook event.
 *
 * ## Idempotency
 *
 * The event is claimed with a conditional update that requires the event id to
 * be absent. MongoDB re-evaluates a single-document predicate under the
 * document lock, so two concurrent deliveries of the same event cannot both
 * succeed — exactly one applies it, the other sees `applied: false`.
 *
 * ## Only verified events reach here
 *
 * The route verifies the HMAC over the raw body before calling this. This
 * function assumes the signature was checked and does not re-verify, because
 * re-serialising would not reproduce the same bytes.
 *
 * @param {object} params
 * @param {string} params.eventId   Dedup key. Derived from event + entity id.
 * @param {string} params.event     e.g. "payment.captured".
 * @param {object} params.payload   Parsed webhook entity.
 * @returns {Promise<{applied: boolean, reason?: string}>}
 */
async function applyWebhookEvent({ eventId, event, payload }) {
  // Accept either the already-unwrapped entity or the full
  // `{ payload: { entity } }` envelope.
  //
  // The webhook route passes the unwrapped entity; a caller replaying a stored
  // payload may pass the whole event. Unwrapping blindly (`payload.entity`)
  // produced `{}` for the route's shape, so every delivery resolved to
  // "unknown_payment" and nothing was ever settled — a failure that returns 200
  // and therefore looks like it worked.
  const candidate = payload?.entity ?? payload;
  const entity = candidate && typeof candidate === "object" ? candidate : {};
  const orderId = entity.order_id;

  const payment = orderId
    ? await Payment.findOne({ razorpayOrderId: orderId })
    : entity.id
      ? await Payment.findOne({ razorpayPaymentId: entity.id })
      : null;

  if (!payment) {
    // An event for an order we do not know may be genuine (a late delivery for a
    // deleted record) or forged. It is logged and acknowledged so Razorpay stops
    // retrying; nothing is credited.
    logger.warn(
      { event, eventId, orderId, entityId: entity.id },
      "Webhook for an unknown payment"
    );
    return { applied: false, reason: "unknown_payment" };
  }

  // ===== Idempotency claim =====
  // Atomic: only a delivery that has not already recorded this event matches.
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, "webhookEvents.eventId": { $ne: eventId } },
    {
      $push: {
        webhookEvents: { eventId, event, appliedAt: new Date() },
      },
      $set: {
        status:
          event === "payment.captured"
            ? PAYMENT_STATUS.PAID
            : event === "payment.failed"
              ? PAYMENT_STATUS.FAILED
              : payment.status,
        ...(event === "payment.captured"
          ? {
              verifiedAt: new Date(),
              capturedAmount: entity.amount,
              method: entity.method,
            }
          : {}),
        ...(event === "payment.failed"
          ? {
              failedAt: new Date(),
              failureCode: entity.error_code ?? null,
              failureDescription: entity.error_description ?? null,
            }
          : {}),
        ...(entity.id && !payment.razorpayPaymentId
          ? { razorpayPaymentId: entity.id }
          : {}),
      },
    },
    { new: true }
  );

  if (!claimed) {
    // Duplicate delivery. Returning success stops Razorpay retrying, and nothing
    // is credited twice.
    return { applied: false, reason: "duplicate_event" };
  }

  if (event === "payment.captured") {
    await creditInvoice(claimed);
  }

  if (event === "payment.failed") {
    await notifyPaymentOutcome(claimed, "failed");
  }

  return { applied: true, status: claimed.status };
}

/**
 * Apply a captured payment to its invoice.
 *
 * The invoice is updated with a conditional write so a concurrent capture of the
 * same payment cannot double-credit it, and so an over-payment cannot push the
 * balance negative.
 */
async function creditInvoice(payment) {
  const invoice = await Invoice.findById(payment.invoice);

  if (!invoice) {
    logger.error({ paymentId: payment._id }, "Captured payment has no invoice");
    return;
  }

  // Never credit more than is outstanding.
  const amountToCredit = Math.min(
    payment.capturedAmount ?? payment.amount,
    invoice.balanceDue
  );

  if (amountToCredit <= 0) {
    logger.warn(
      { paymentId: payment._id, balanceDue: invoice.balanceDue },
      "Captured payment exceeds the outstanding balance — not credited"
    );
  }

  const newPaid = money.add(invoice.paidAmount, amountToCredit);
  const newBalance = money.subtract(invoice.total, newPaid);
  const fullyPaid = newBalance <= 0;

  // Conditional on the balance we read, so two captures racing produce one win.
  const updated = await Invoice.findOneAndUpdate(
    { _id: invoice._id, balanceDue: invoice.balanceDue },
    {
      $set: {
        paidAmount: newPaid,
        balanceDue: Math.max(0, newBalance),
        status: fullyPaid ? INVOICE_STATUS.PAID : INVOICE_STATUS.PARTIALLY_PAID,
        isFullyPaid: fullyPaid,
        paidAt: fullyPaid ? new Date() : invoice.paidAt,
      },
    },
    { new: true }
  );

  if (!updated) {
    // Another capture landed first; it will reconcile the invoice itself.
    logger.warn(
      { invoiceId: invoice._id },
      "Invoice changed during crediting — reconciling later"
    );
    return;
  }

  // Issue the receipt here — the single point at which a payment becomes
  // settled. Issuing it on request instead would mean the document a student
  // downloads today is not the one they were given at the time.
  const receiptService = require("./receipt.service");
  try {
    await receiptService.issueReceipt({ paymentId: payment._id.toString() });
  } catch (error) {
    // A receipt failure must not undo a settled payment. The money has moved;
    // the ledger records the payment regardless, and reconciliation will show a
    // captured payment with no receipt.
    logger.error(
      { err: error, paymentId: payment._id },
      "Payment settled but receipt issuance failed"
    );
  }

  await auditService.record({
    action: AUDIT_ACTION.PAYMENT_VERIFIED,
    entity: "Invoice",
    entityId: invoice._id,
    entityRef: invoice.reference,
    metadata: {
      amount: amountToCredit,
      paymentId: payment._id,
      balanceDue: updated.balanceDue,
      fullyPaid,
    },
  });

  await notificationService.notify({
    userId: await resolveUserId(invoice.student),
    type: fullyPaid ? "PAYMENT_RECEIVED" : "PAYMENT_RECEIVED",
    title: fullyPaid
      ? `Invoice ${invoice.reference} paid in full`
      : `Payment received for invoice ${invoice.reference}`,
    body: `${money.format(amountToCredit)} received. ${
      fullyPaid ? "Thank you." : `${money.format(updated.balanceDue)} still due.`
    }`,
    link: `/student/finance/invoices/${invoice.reference}`,
    dedupeKey: `payment:${payment._id}:credited`,
  });
}

async function notifyPaymentOutcome(payment, outcome) {
  await notificationService.notify({
    userId: await resolveUserId(payment.student),
    type: "PAYMENT_FAILED",
    title: `Payment for your invoice did not go through`,
    body:
      outcome === "failed"
        ? "Your payment was not completed. You can try again from your invoices page."
        : "Payment update.",
    dedupeKey: `payment:${payment._id}:failed`,
  });
}

/** Resolve a Student document id to its owning User id. */
async function resolveUserId(studentId) {
  const student = await Student.findById(studentId).select("user").lean();
  return student?.user?.toString() ?? null;
}

/** Payment history for a student, for their billing page. */
async function listPayments({ user, filters = {}, page = 1, limit = 20 }) {
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
    Payment.find(query)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("invoice", "reference status total balanceDue")
      .lean(),
    Payment.countDocuments(query),
  ]);

  return { items, total, page: safePage, limit: safeLimit };
}

/**
 * Reconcile invoices against their payments.
 *
 * Run after a gateway outage or a suspected incident. Compares the recorded
 * payment states with the invoice totals and reports discrepancies rather than
 * silently correcting them.
 */
async function reconcile({ req } = {}) {
  const invoices = await Invoice.find({ status: { $ne: INVOICE_STATUS.DRAFT } }).lean();
  const discrepancies = [];

  for (const invoice of invoices) {
    const payments = await Payment.find({ invoice: invoice._id }).lean();

    // Only PAID payments count toward the ledger; an attempted-but-unconfirmed
    // payment has not moved money.
    const captured = payments
      .filter((p) => p.status === PAYMENT_STATUS.PAID)
      .reduce((sum, p) => sum + (p.capturedAmount ?? p.amount), 0);

    const refunded = payments.reduce((sum, p) => sum + (p.refundedAmount ?? 0), 0);
    const expectedPaid = Math.min(captured, invoice.total);
    const expectedBalance = Math.max(0, invoice.total - expectedPaid);
    const expectedStatus =
      expectedBalance === 0
        ? INVOICE_STATUS.PAID
        : expectedPaid > 0
          ? INVOICE_STATUS.PARTIALLY_PAID
          : INVOICE_STATUS.ISSUED;

    if (
      expectedPaid !== invoice.paidAmount ||
      expectedBalance !== invoice.balanceDue ||
      expectedStatus !== invoice.status
    ) {
      discrepancies.push({
        invoice: invoice.reference,
        recorded: {
          paid: invoice.paidAmount,
          balance: invoice.balanceDue,
          status: invoice.status,
        },
        expected: {
          paid: expectedPaid,
          balance: expectedBalance,
          status: expectedStatus,
        },
      });
    }

    void refunded;
  }

  return {
    checked: invoices.length,
    discrepancies,
    clean: discrepancies.length === 0,
    at: new Date(),
    req,
  };
}

module.exports = {
  createInvoice,
  getInvoice,
  listInvoices,
  canReadInvoice,
  createOrder,
  confirmPayment,
  verifyPaymentWithGateway,
  verifyPendingPayments,
  applyWebhookEvent,
  creditInvoice,
  listPayments,
  reconcile,
  calculateTotals,
  nextReference,
};
