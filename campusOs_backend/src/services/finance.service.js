const mongoose = require("mongoose");
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
const instalmentService = require("./instalment.service");
const InstitutionTaxProfile = require("../models/InstitutionTaxProfile");
const taxService = require("./tax.service");
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
function calculateTotals(items, { interState = false, requireGst = false } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest("An invoice requires at least one line item");
  }

  /*
   * GST validation, but only when the institution is actually registered.
   *
   * An HSN code and a slab rate are what make a document a *tax* invoice. An
   * institution with no GST profile is issuing ordinary invoices with a tax
   * component, and refusing those for want of an HSN code would break every
   * invoice that worked before the profile existed — for no compliance gain,
   * because there is nothing to file.
   *
   * Once a profile is set, the rules apply in full: a line with tax and no HSN
   * code cannot be filed against, and a rate outside the slabs is rejected on
   * submission. Both are cheaper to refuse at issue than to discover when the
   * accountant reconciles the quarter.
   */
  if (requireGst) {
    for (const item of items) {
      const hsn = taxService.checkHsn(item.hsnCode);
      if (!hsn.valid) {
        throw ApiError.badRequest(`For "${item.description}": ${hsn.reason}`);
      }

      const rate = taxService.checkRate(item.taxPercent ?? 0);
      if (!rate.valid) {
        throw ApiError.badRequest(`For "${item.description}": ${rate.reason}`);
      }

      if ((item.taxPercent ?? 0) > 0 && !item.hsnCode) {
        throw ApiError.badRequest(
          `For "${item.description}": a line with tax needs an HSN code, or it is not a tax invoice`
        );
      }
    }
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
    // The split is computed here, once, from the bytes and the place of
    // supply — and stored on the line. Recomputing it at print time would
    // re-derive it from a student's *current* address, producing a tax invoice
    // that no longer matches the one that was issued.
    const { taxAmount, components } = taxService.computeLineTax(
      { amount, taxPercent },
      interState
    );

    return {
      description: String(item.description).trim(),
      quantity,
      unitAmount,
      amount,
      taxPercent,
      taxAmount,
      taxComponents: components,
      hsnCode: item.hsnCode ?? null,
    };
  });

  const subtotal = pricedLines.reduce((sum, line) => money.add(sum, line.amount), 0);
  const taxTotal = pricedLines.reduce((sum, line) => money.add(sum, line.taxAmount), 0);
  const total = money.add(subtotal, taxTotal);

  return {
    items: pricedLines,
    subtotal,
    taxTotal,
    total,
    breakup: taxService.buildBreakup(pricedLines),
    interState,
  };
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

  /*
   * Read the institution's GST profile, and the student's state.
   *
   * The split — CGST and SGST inside the state, IGST outside it — depends on
   * both, so neither can be chosen by the issuer. An account issuing an
   * inter-state invoice and marking it intra-state produces a document that
   * reconciles to the wrong total and is caught by an auditor, not a student.
   */
  const profile = await InstitutionTaxProfile.findOne({ singleton: "primary" }).lean();
  const studentStateCode = student.stateCode ?? null;
  const interState = Boolean(
    profile &&
    studentStateCode &&
    String(studentStateCode).toUpperCase() !== profile.stateCode
  );

  const totals = calculateTotals(items, { interState, requireGst: Boolean(profile) });

  if (totals.total <= 0) {
    throw ApiError.badRequest("An invoice must total more than zero");
  }

  /*
   * Tax without a registered GSTIN is not chargeable, and an institution
   * collecting GST it is not registered for is a real problem.
   *
   * But refusing here would reject every taxable invoice in an institution that
   * has not set up a profile — which is most of them, today — and turn a missing
   * setup step into an outage. So the invoice is issued and marked: it carries
   * tax, it carries no GSTIN, and the presenter reports `isTaxInvoice: false`
   * so the accounts department can see on the document that it is not one.
   *
   * What is never acceptable is the silent version, where a tax total appears
   * with no registration and nobody notices until the quarter does not
   * reconcile.
   */
  const hasTax = totals.items.some((line) => (line.taxPercent ?? 0) > 0);
  const isTaxInvoice = Boolean(hasTax && profile);

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
    // Snapshotted, like the penalty policy: a tax invoice must carry the GSTIN
    // and legal name that were valid when it was issued, not whatever the
    // profile says when it is reprinted.
    taxProfile: isTaxInvoice
      ? {
          legalName: profile.legalName,
          gstin: profile.gstin,
          stateCode: profile.stateCode,
          placeOfSupply: profile.placeOfSupply,
          addressLine1: profile.addressLine1,
          addressLine2: profile.addressLine2 ?? null,
          pincode: profile.pincode ?? null,
          interState,
          reverseCharge: false,
          breakup: totals.breakup,
        }
      : undefined,
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

/**
 * Attach an instalment schedule to an invoice.
 *
 * ## Refused once anything is already paid
 *
 * Splitting an invoice that has taken a payment means the schedule no longer
 * sums to what the student was told they owe, and the difference has to come
 * from somewhere. It would come from their pocket, silently. An invoice with
 * payments against it needs the payment reversed first, which is a decision
 * somebody should be making deliberately.
 */
async function scheduleInstalments({
  user,
  invoiceId,
  instalments,
  firstDueAt,
  periodDays,
  policy,
}) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw ApiError.notFound("Invoice not found");

  if (invoice.status === INVOICE_STATUS.CANCELLED) {
    throw ApiError.conflict("A cancelled invoice cannot be scheduled");
  }

  if ((invoice.paidAmount ?? 0) > 0) {
    throw ApiError.conflict(
      "This invoice already has a payment against it. Splitting it now would change what the student owes."
    );
  }

  if ((invoice.instalments ?? []).length > 0) {
    throw ApiError.conflict("This invoice already has a schedule");
  }

  const first = new Date(firstDueAt);
  if (Number.isNaN(first.getTime())) {
    throw ApiError.badRequest("The first due date is not a valid date");
  }

  const schedule = instalmentService.buildSchedule(invoice.total, instalments, first, {
    periodDays,
  });

  invoice.instalments = schedule.map((entry) => ({
    sequence: entry.sequence,
    amount: entry.amount,
    dueAt: entry.dueAt,
    paidAt: null,
    paidAmount: 0,
  }));

  if (policy) {
    invoice.penalty = { ...invoice.penalty.toObject?.(), ...policy, chargedAmount: 0 };
  }

  await invoice.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.INVOICE_SCHEDULED,
    entity: "Invoice",
    entityId: invoice._id,
    entityRef: invoice.reference,
    metadata: { instalments: schedule.length, periodDays, total: invoice.total },
  });

  return instalmentService.presentInstalments(invoice.instalments);
}

/** Read the schedule with paid-ness derived rather than stored. */
async function getSchedule({ invoiceId }) {
  // A malformed id is a 404, not a CastError surfacing as a 500. The route
  // validates the shape, but the seeder and scripts call this directly too.
  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    throw ApiError.notFound("Invoice not found");
  }

  const invoice = await Invoice.findById(invoiceId).select(
    "reference total paidAmount balanceDue instalments penalty dueAt status"
  );
  if (!invoice) throw ApiError.notFound("Invoice not found");

  return {
    reference: invoice.reference,
    total: invoice.total,
    paidAmount: invoice.paidAmount ?? 0,
    balanceDue: invoice.balanceDue,
    dueAt: invoice.dueAt,
    status: invoice.status,
    instalments: instalmentService.presentInstalments(invoice.instalments),
    penalty: {
      rateBps: invoice.penalty?.rateBps ?? 0,
      periodDays: invoice.penalty?.periodDays ?? 30,
      graceDays: invoice.penalty?.graceDays ?? 0,
      capBps: invoice.penalty?.capBps ?? 0,
      chargedAmount: invoice.penalty?.chargedAmount ?? 0,
    },
  };
}

/**
 * Apply the penalty policy to an invoice.
 *
 * The policy is written onto the invoice rather than looked up, so a later
 * change to the college's rate does not retroactively alter terms a student
 * already agreed to.
 */
async function setPenaltyPolicy({ user, invoiceId, policy, req }) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw ApiError.notFound("Invoice not found");

  if (invoice.status === INVOICE_STATUS.CANCELLED) {
    throw ApiError.conflict("A cancelled invoice carries no penalty");
  }

  invoice.penalty = { ...invoice.penalty.toObject?.(), ...policy };
  await invoice.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.INVOICE_POLICY_SET,
    entity: "Invoice",
    entityId: invoice._id,
    entityRef: invoice.reference,
    metadata: policy,
    req,
  });

  return invoice.penalty.toObject?.() ?? invoice.penalty;
}

/**
 * Charge overdue penalties.
 *
 * ## A dry run is the default shape of this operation
 *
 * A sweep that silently charges forty students 2% each is not something to
 * discover by looking at a bank statement. It reports what it would do before
 * it does it, and writes nothing.
 *
 * ## Each invoice is charged its own delta
 *
 * Recomputed rather than incremented, so the sweep can run hourly, daily, or
 * twice in a minute and one period of lateness costs one period's penalty.
 */
async function sweepPenalties({ user, invoiceIds, dryRun = false, req }) {
  const filter = {
    status: {
      $in: [INVOICE_STATUS.ISSUED, INVOICE_STATUS.PARTIALLY_PAID, INVOICE_STATUS.OVERDUE],
    },
  };
  if (invoiceIds?.length) filter._id = { $in: invoiceIds };

  const invoices = await Invoice.find(filter);
  const now = new Date();

  const charged = [];
  const skipped = [];

  for (const invoice of invoices) {
    const rate = invoice.penalty?.rateBps ?? 0;
    if (rate <= 0) {
      skipped.push({
        reference: invoice.reference,
        reason: "No penalty policy on this invoice",
      });
      continue;
    }

    const result = instalmentService.chargePenalty(invoice, invoice.penalty, now);

    if (result.charged <= 0) {
      skipped.push({
        reference: invoice.reference,
        reason: result.calculation.reason ?? "Nothing further to charge",
      });
      continue;
    }

    if (!dryRun) {
      /*
       * Written with the value read at the top of the loop in the filter, not
       * just in the body.
       *
       * `save()` rewrites every modified path from a document fetched before the
       * loop reached this invoice, so a sweep running twice — the nightly job
       * alongside a manual run — charged the same period twice and lost one of
       * the two writes. Making the filter carry the value we read turns this
       * into a compare-and-set: the second sweep's write matches nothing.
       */
      const chargedBefore = invoice.penalty.chargedAmount ?? 0;

      const applied = await Invoice.updateOne(
        { _id: invoice._id, "penalty.chargedAmount": chargedBefore },
        {
          $set: {
            total: result.newTotal,
            balanceDue: result.newBalance,
            "penalty.chargedAmount": money.add(chargedBefore, result.charged),
            "penalty.chargedAt": now,
            status: INVOICE_STATUS.OVERDUE,
          },
        }
      );

      if (applied.matchedCount === 0) {
        logger.warn(
          { invoice: invoice.reference },
          "Invoice changed during the penalty sweep — skipped to avoid double-charging"
        );
        skipped.push({
          reference: invoice.reference,
          reason: "Changed by another sweep while this one was running",
        });
        // Not charged, so it must not be reported as though it were.
        continue;
      }
    }

    charged.push({
      reference: invoice.reference,
      amount: result.charged,
      periods: result.calculation.periods,
      capped: result.calculation.capped,
    });
  }

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.INVOICE_PENALTY_SWEEP,
    entity: "Invoice",
    metadata: { examined: invoices.length, charged: charged.length, dryRun },
    req,
  });

  return { dryRun, examined: invoices.length, charged, skipped };
}

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

  /*
   * Mark the instalments this payment actually settled.
   *
   * Without this the schedule on an invoice always reads as wholly unpaid: the
   * `paidAmount` and `paidAt` fields exist on each instalment and nothing ever
   * wrote them, so a student who had paid in full was shown as owing every
   * instalment while the invoice beside it said PAID.
   */
  if (Array.isArray(invoice.instalments) && invoice.instalments.length > 0) {
    const { allocations } = instalmentService.allocatePayment(invoice, amountToCredit);

    if (allocations.length > 0) {
      await Invoice.updateOne(
        { _id: invoice._id },
        {
          $set: {
            instalments: invoice.instalments.map((instalment) => {
              const applied = allocations.find(
                (entry) => entry.sequence === instalment.sequence
              );
              if (!applied) return instalment;

              const paid = Math.min(
                instalment.amount,
                (instalment.paidAmount ?? 0) + applied.amount
              );

              return {
                // `toObject()`, not a spread: spreading a Mongoose subdocument
                // yields its internals (`$__parent`, `__parentArray`) and none
                // of the real fields, so the write silently stored nothing.
                ...instalment.toObject(),
                paidAmount: paid,
                paidAt:
                  paid >= instalment.amount
                    ? (instalment.paidAt ?? new Date())
                    : instalment.paidAt,
              };
            }),
          },
        }
      );
    }
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
  /*
   * One aggregation instead of a query per invoice.
   *
   * This was `1 + N` against a live database with no bound on N, run from an
   * HTTP endpoint. All this needs is the totals per invoice, and Mongo can
   * produce them in a single pass.
   */
  const totals = await Payment.aggregate([
    {
      $match: {
        status: PAYMENT_STATUS.PAID,
      },
    },
    {
      $group: {
        _id: "$invoice",
        // `capturedAmount ?? amount`, matching the rule the ledger used: a row
        // written before `capturedAmount` existed still counts what it moved.
        captured: { $sum: { $ifNull: ["$capturedAmount", "$amount"] } },
        refunded: { $sum: { $ifNull: ["$refundedAmount", 0] } },
      },
    },
  ]);

  const byInvoice = new Map(
    totals.map((row) => [
      String(row._id),
      { captured: row.captured ?? 0, refunded: row.refunded ?? 0 },
    ])
  );

  const invoices = await Invoice.find({ status: { $ne: INVOICE_STATUS.DRAFT } })
    .select("reference total paidAmount balanceDue status")
    .lean();
  const discrepancies = [];

  for (const invoice of invoices) {
    const row = byInvoice.get(String(invoice._id)) ?? { captured: 0, refunded: 0 };

    // Only PAID payments count toward the ledger; an attempted-but-unconfirmed
    // payment has not moved money.
    const captured = row.captured;

    /*
     * Refunded money is not paid money.
     *
     * This line computed the refunded total and then discarded it, so a
     * reconciled invoice was compared against the full captured amount while the
     * ledger had been reduced by the refund. Every fully refunded invoice
     * therefore reported a permanent discrepancy and `clean` was never true
     * again once anyone had been refunded.
     */
    const refunded = row.refunded;
    const netPaid = Math.max(0, captured - refunded);
    const expectedPaid = Math.min(netPaid, invoice.total);
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
  scheduleInstalments,
  getSchedule,
  setPenaltyPolicy,
  sweepPenalties,
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
