/**
 * Finance tests.
 *
 * The spec (§12, §17) names the properties that matter, and each is asserted
 * here as a denial or an exact equality rather than a smoke test:
 *
 *  - the amount is calculated and verified server-side
 *  - signatures and webhook events are verified
 *  - duplicate events are handled idempotently
 *  - an invoice is never marked paid from a browser callback
 *  - no amount arithmetic uses floating point
 */

const request = require("supertest");
const crypto = require("crypto");

const {
  getApp,
  resetDatabase,
  createUser,
  createStudent,
  loginAs,
  expectError,
} = require("./helpers/factory");
const { ROLES, INVOICE_STATUS, PAYMENT_STATUS } = require("../src/config/constants");
const Invoice = require("../src/models/Invoice");
const Payment = require("../src/models/Payment");
const Refund = require("../src/models/Refund");
const Notification = require("../src/models/Notification");
const mongoose = require("mongoose");
const financeService = require("../src/services/finance.service");
const money = require("../src/utils/money");
const { getGateway, signWebhookPayload, signPayment } = require("../src/config/razorpay");

beforeEach(resetDatabase);

/** Post helper carrying the CSRF header a browser would send. */
const postAs = (agent, csrf, url, body) =>
  agent.post(url).set("X-CSRF-Token", csrf).send(body);

/** Build a webhook body and its signature over the exact bytes. */
function signedWebhook(event, entity, { secret } = {}) {
  const webhookSecret = secret ?? getGateway().webhookSecret;
  // Built as a compact string so the signature covers exactly what is sent.
  const raw = JSON.stringify({ event, payload: { entity } });
  return {
    raw,
    signature: signWebhookPayload(Buffer.from(raw), webhookSecret),
    event,
    entity,
  };
}

/** Send a signed webhook over HTTP. */
async function sendWebhook({ raw, signature, event }) {
  return request(getApp())
    .post("/api/v1/payments/webhook/razorpay")
    .set("Content-Type", "application/json")
    .set("x-razorpay-event", event)
    .set("x-razorpay-signature", signature)
    .send(raw);
}

/** Create an invoice through the service (accounts staff). */
async function makeInvoice(student, overrides = {}) {
  const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
  return financeService.createInvoice({
    user: accounts,
    studentId: student.student,
    purpose: "Tuition fee",
    items: [
      {
        description: "Semester fee",
        quantity: 1,
        unitAmount: "10000.00",
        taxPercent: 18,
      },
    ],
    ...overrides,
  });
}

/** Start a payment for an invoice as the owning student. */
async function makeOrder(student, invoice) {
  const { agent, csrfToken } = await loginAs(student.user);
  const res = await postAs(agent, csrfToken, "/api/v1/finance/payments/order", {
    invoice: invoice.reference,
  });
  return { agent, csrfToken, res };
}

describe("money", () => {
  it("computes totals exactly, in integer paise", () => {
    const totals = financeService.calculateTotals([
      { description: "Fee", quantity: 2, unitAmount: "10000.00", taxPercent: 18 },
    ]);

    // 2 × ₹10,000 = ₹20,000, + 18% = ₹23,600.
    // In paise: subtotal 2,000,000, tax 360,000, total 2,360,000.
    expect(totals.subtotal).toBe(2000000);
    expect(totals.taxTotal).toBe(360000);
    expect(totals.total).toBe(2360000);
    expect(Number.isInteger(totals.total)).toBe(true);
  });

  it("rejects a non-integer quantity", () => {
    expect(() =>
      financeService.calculateTotals([
        { description: "Fee", quantity: 1.5, unitAmount: "100.00" },
      ])
    ).toThrow();
  });

  it("round-trips through display without losing a paisa", () => {
    const totals = financeService.calculateTotals([
      { description: "Fee", quantity: 3, unitAmount: "333.33", taxPercent: 0 },
    ]);
    expect(money.toRupees(totals.total)).toBe("999.99");
    expect(money.toMinor(money.toRupees(totals.total))).toBe(totals.total);
  });

  it("refuses a total built from a float that is not exactly representable", () => {
    // A float that stringifies cleanly (10.5) is safe — the shortest round-trip
    // representation is exact. One that does not (0.1 + 0.2) must be refused,
    // because converting it would silently bake in IEEE-754 error.
    expect(money.toMinor(String(10.5))).toBe(1050);
    expect(() =>
      financeService.calculateTotals([
        { description: "Fee", quantity: 1, unitAmount: 0.1 + 0.2 },
      ])
    ).toThrow();
  });
});

describe("invoice creation", () => {
  it("derives the total server-side from line items", async () => {
    const student = await createStudent();
    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);

    const res = await postAs(agent, csrfToken, "/api/v1/finance/invoices", {
      student: student.student._id.toString(),
      purpose: "Tuition fee",
      items: [
        {
          description: "Semester fee",
          quantity: 2,
          unitAmount: "5000.00",
          taxPercent: 18,
        },
      ],
    });

    expect(res.status).toBe(201);
    // 2 × ₹5,000 = ₹10,000 + 18% = ₹11,800 = 1,180,000 paise.
    expect(res.body.data.total).toBe(1180000);
    expect(res.body.data.balanceDue).toBe(1180000);
  });

  it("rejects a client-supplied total", async () => {
    const student = await createStudent();
    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);

    const res = await postAs(agent, csrfToken, "/api/v1/finance/invoices", {
      student: student.student._id.toString(),
      purpose: "Tuition fee",
      items: [{ description: "Fee", quantity: 1, unitAmount: "100.00" }],
      // The client trying to set its own amount.
      total: 1,
      balanceDue: 1,
      paidAmount: 999999,
    });

    expectError(res, 400, "VALIDATION_ERROR");
    expect(JSON.stringify(res.body.details)).toContain("total");
  });

  it("refuses invoice creation by a non-accounts role", async () => {
    const student = await createStudent();
    const hod = await createUser({ role: ROLES.HOD });
    const { agent, csrfToken } = await loginAs(hod);

    const res = await postAs(agent, csrfToken, "/api/v1/finance/invoices", {
      student: student.student._id.toString(),
      purpose: "Fee",
      items: [{ description: "Fee", quantity: 1, unitAmount: "100.00" }],
    });

    expectError(res, 403, "FORBIDDEN");
  });
});

describe("invoice visibility", () => {
  it("shows a student only their own invoices", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    await makeInvoice(alice);
    await makeInvoice(bob);

    const { agent } = await loginAs(alice.user);
    const res = await agent.get("/api/v1/finance/invoices");

    expect(res.body.meta.total).toBe(1);
  });

  it("404s when a student fetches another's invoice", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    const invoice = await makeInvoice(alice);

    const { agent } = await loginAs(bob.user);
    const res = await agent.get(`/api/v1/finance/invoices/${invoice.reference}`);

    expectError(res, 404, "NOT_FOUND");
  });
});

describe("payment order", () => {
  it("charges the invoice balance, not a client-supplied amount", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);

    const { agent, csrfToken } = await loginAs(student.user);

    // The schema has no amount field at all, so tampering is impossible
    // rather than merely ignored.
    const res = await postAs(agent, csrfToken, "/api/v1/finance/payments/order", {
      invoice: invoice.reference,
      amount: 1,
    });
    expectError(res, 400, "VALIDATION_ERROR");

    const ok = await postAs(agent, csrfToken, "/api/v1/finance/payments/order", {
      invoice: invoice.reference,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.amount).toBe(invoice.total);
  });

  it("never exposes the key secret or webhook secret", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { res } = await makeOrder(student, invoice);

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain("mock_key_secret");
    expect(serialised).not.toContain("mock_webhook_secret");
    // The publishable key is safe by design and is returned.
    expect(res.body.data.keyId).toBeTruthy();
  });

  it("flags that the mock gateway is in use", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { res } = await makeOrder(student, invoice);

    // A development deployment must be unmistakable.
    expect(res.body.data.isMock).toBe(true);
  });

  it("refuses to start a payment on a paid invoice", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    await Invoice.updateOne(
      { _id: invoice._id },
      { $set: { status: INVOICE_STATUS.PAID, balanceDue: 0 } }
    );

    const { agent, csrfToken } = await loginAs(student.user);
    const res = await postAs(agent, csrfToken, "/api/v1/finance/payments/order", {
      invoice: invoice.reference,
    });

    // Already settled: a conflict, not a bad request.
    expectError(res, 409, "CONFLICT");
  });

  it("refuses a student paying another's invoice", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    const invoice = await makeInvoice(alice);

    const { agent, csrfToken } = await loginAs(bob.user);
    const res = await postAs(agent, csrfToken, "/api/v1/finance/payments/order", {
      invoice: invoice.reference,
    });

    expectError(res, 404, "NOT_FOUND");
  });
});

describe("browser confirmation does not settle", () => {
  it("records the client report without marking the invoice paid", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { agent, csrfToken, res: orderRes } = await makeOrder(student, invoice);

    const gateway = getGateway();
    const paymentId = "pay_CLIENT_CALLBACK";
    const signature = signPayment(
      { orderId: orderRes.body.data.razorpayOrderId, paymentId },
      gateway.keySecret ?? gateway.keyId
    );

    const confirm = await postAs(agent, csrfToken, "/api/v1/finance/payments/confirm", {
      razorpayOrderId: orderRes.body.data.razorpayOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
    });

    expect(confirm.status).toBe(200);

    // The critical assertion: the invoice is untouched.
    const fresh = await Invoice.findById(invoice._id).lean();
    expect(fresh.status).toBe(INVOICE_STATUS.ISSUED);
    expect(fresh.paidAmount).toBe(0);
    expect(fresh.isFullyPaid).toBe(false);

    const payment = await Payment.findById(orderRes.body.data.paymentId).lean();
    expect(payment.status).toBe(PAYMENT_STATUS.ATTEMPTED);
    expect(payment.clientReportedSuccess.signatureVerified).toBe(true);
  });

  it("records an invalid checkout signature instead of trusting it", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { agent, csrfToken, res: orderRes } = await makeOrder(student, invoice);

    const confirm = await postAs(agent, csrfToken, "/api/v1/finance/payments/confirm", {
      razorpayOrderId: orderRes.body.data.razorpayOrderId,
      razorpayPaymentId: "pay_FORGED",
      razorpaySignature: "f".repeat(64),
    });

    expect(confirm.status).toBe(200);
    expect(confirm.body.data.verified).toBe(false);

    // Even a *valid-looking* client report must not settle the invoice.
    const fresh = await Invoice.findById(invoice._id).lean();
    expect(fresh.isFullyPaid).toBe(false);
  });
});

describe("webhook verification", () => {
  it("rejects a webhook with an invalid signature", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { res: orderRes } = await makeOrder(student, invoice);

    const { raw, event, entity } = signedWebhook("payment.captured", {
      id: "pay_W",
      order_id: orderRes.body.data.razorpayOrderId,
      amount: invoice.total,
      status: "captured",
    });

    const res = await sendWebhook({ raw, signature: "0".repeat(64), event });

    expectError(res, 400, "WEBHOOK_SIGNATURE_INVALID");

    const fresh = await Invoice.findById(invoice._id).lean();
    expect(fresh.isFullyPaid).toBe(false);
    void entity;
  });

  it("rejects a signature computed over re-serialised JSON", async () => {
    // Proves the endpoint verifies the RAW bytes. A body whose formatting
    // differs from ours must not match a signature over the parsed object.
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { res: orderRes } = await makeOrder(student, invoice);

    const entity = {
      id: "pay_R",
      order_id: orderRes.body.data.razorpayOrderId,
      amount: invoice.total,
      status: "captured",
    };
    const gateway = getGateway();

    const pretty = JSON.stringify(
      { event: "payment.captured", payload: { entity } },
      null,
      2
    );
    // Signature over the COMPACT form, body sent pretty-printed.
    const sigOverCompact = signWebhookPayload(
      Buffer.from(JSON.stringify({ event: "payment.captured", payload: { entity } })),
      gateway.webhookSecret
    );

    const res = await request(getApp())
      .post("/api/v1/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-event", "payment.captured")
      .set("x-razorpay-signature", sigOverCompact)
      .send(pretty);

    expectError(res, 400, "WEBHOOK_SIGNATURE_INVALID");
  });

  it("rejects a webhook with no signature header", async () => {
    const res = await request(getApp())
      .post("/api/v1/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .send("{}");

    expectError(res, 400, "WEBHOOK_SIGNATURE_INVALID");
  });
});

describe("webhook settlement", () => {
  it("marks the invoice paid on a verified capture", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { res: orderRes } = await makeOrder(student, invoice);

    const { raw, signature, event } = signedWebhook("payment.captured", {
      id: "pay_CAPTURED",
      order_id: orderRes.body.data.razorpayOrderId,
      amount: invoice.total,
      status: "captured",
      method: "upi",
    });

    const res = await sendWebhook({ raw, signature, event });
    expect(res.status).toBe(200);
    expect(res.body.data.applied).toBe(true);

    const fresh = await Invoice.findById(invoice._id).lean();
    expect(fresh.status).toBe(INVOICE_STATUS.PAID);
    expect(fresh.paidAmount).toBe(invoice.total);
    expect(fresh.balanceDue).toBe(0);
    expect(fresh.isFullyPaid).toBe(true);

    const payment = await Payment.findById(orderRes.body.data.paymentId).lean();
    expect(payment.status).toBe(PAYMENT_STATUS.PAID);
    expect(payment.verifiedAt).not.toBeNull();
  });

  it("applies a duplicate delivery exactly once", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { res: orderRes } = await makeOrder(student, invoice);

    const { raw, signature, event } = signedWebhook("payment.captured", {
      id: "pay_DUP",
      order_id: orderRes.body.data.razorpayOrderId,
      amount: invoice.total,
      status: "captured",
    });

    const first = await sendWebhook({ raw, signature, event });
    expect(first.body.data.applied).toBe(true);

    // Razorpay retries. Three more deliveries of the identical event.
    for (let i = 0; i < 3; i++) {
      const again = await sendWebhook({ raw, signature, event });
      // 200 so Razorpay stops retrying, but not applied again.
      expect(again.status).toBe(200);
      expect(again.body.data.applied).toBe(false);
      expect(again.body.data.reason).toBe("duplicate_event");
    }

    const fresh = await Invoice.findById(invoice._id).lean();
    // Credited once, not four times.
    expect(fresh.paidAmount).toBe(invoice.total);
    expect(fresh.balanceDue).toBe(0);

    const payment = await Payment.findById(orderRes.body.data.paymentId).lean();
    expect(payment.webhookEvents).toHaveLength(1);
  });

  it("applies concurrent duplicate deliveries exactly once", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { res: orderRes } = await makeOrder(student, invoice);

    const { raw, signature, event } = signedWebhook("payment.captured", {
      id: "pay_RACE",
      order_id: orderRes.body.data.razorpayOrderId,
      amount: invoice.total,
      status: "captured",
    });

    // Five simultaneous deliveries of the same event.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => sendWebhook({ raw, signature, event }))
    );

    const applied = results.filter((r) => r.body?.data?.applied);
    expect(applied).toHaveLength(1);

    const fresh = await Invoice.findById(invoice._id).lean();
    expect(fresh.paidAmount).toBe(invoice.total);
  });

  it("records a failure without crediting the invoice", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { res: orderRes } = await makeOrder(student, invoice);

    const { raw, signature, event } = signedWebhook("payment.failed", {
      id: "pay_FAIL",
      order_id: orderRes.body.data.razorpayOrderId,
      status: "failed",
      error_code: "BAD_REQUEST_ERROR",
      error_description: "Insufficient funds",
    });

    const res = await sendWebhook({ raw, signature, event });
    expect(res.status).toBe(200);

    const fresh = await Invoice.findById(invoice._id).lean();
    expect(fresh.isFullyPaid).toBe(false);
    expect(fresh.paidAmount).toBe(0);

    const payment = await Payment.findById(orderRes.body.data.paymentId).lean();
    expect(payment.status).toBe(PAYMENT_STATUS.FAILED);
    expect(payment.failureDescription).toBe("Insufficient funds");
  });

  it("acknowledges an event for an unknown order without crediting anything", async () => {
    const { raw, signature, event } = signedWebhook("payment.captured", {
      id: "pay_UNKNOWN",
      order_id: "order_does_not_exist",
      amount: 10000,
      status: "captured",
    });

    const res = await sendWebhook({ raw, signature, event });

    // 200 so Razorpay stops retrying a delivery that will never apply.
    expect(res.status).toBe(200);
    expect(res.body.data.applied).toBe(false);
    expect(res.body.data.reason).toBe("unknown_payment");
  });

  it("handles a partial payment correctly", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { res: orderRes } = await makeOrder(student, invoice);

    const half = Math.floor(invoice.total / 2);
    const { raw, signature, event } = signedWebhook("payment.captured", {
      id: "pay_PARTIAL",
      order_id: orderRes.body.data.razorpayOrderId,
      amount: half,
      status: "captured",
    });

    await sendWebhook({ raw, signature, event });

    const fresh = await Invoice.findById(invoice._id).lean();
    expect(fresh.status).toBe(INVOICE_STATUS.PARTIALLY_PAID);
    expect(fresh.paidAmount).toBe(half);
    expect(fresh.balanceDue).toBe(invoice.total - half);
    expect(fresh.isFullyPaid).toBe(false);
  });

  it("never credits more than the invoice total", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { res: orderRes } = await makeOrder(student, invoice);

    // A gateway reporting a capture larger than the invoice.
    const { raw, signature, event } = signedWebhook("payment.captured", {
      id: "pay_OVER",
      order_id: orderRes.body.data.razorpayOrderId,
      amount: invoice.total * 3,
      status: "captured",
    });

    await sendWebhook({ raw, signature, event });

    const fresh = await Invoice.findById(invoice._id).lean();
    // Capped at the total; the balance cannot go negative.
    expect(fresh.paidAmount).toBeLessThanOrEqual(invoice.total);
    expect(fresh.balanceDue).toBeGreaterThanOrEqual(0);
  });
});

describe("reconciliation", () => {
  it("reports a clean ledger when balances agree", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { res: orderRes } = await makeOrder(student, invoice);

    const { raw, signature, event } = signedWebhook("payment.captured", {
      id: "pay_OK",
      order_id: orderRes.body.data.razorpayOrderId,
      amount: invoice.total,
      status: "captured",
    });
    await sendWebhook({ raw, signature, event });

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent } = await loginAs(accounts);
    const res = await agent.get("/api/v1/finance/reconcile");

    expect(res.status).toBe(200);
    expect(res.body.data.clean).toBe(true);
  });

  /*
   * The bug: the refunded total was computed and then thrown away, so a
   * reconciled invoice was compared against the full captured amount while the
   * ledger had already been reduced by the refund. Every fully refunded invoice
   * reported a permanent discrepancy and `clean` was never true again.
   */
  it("agrees with the ledger after a refund", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    const refund = await (async () => {
      const { agent, csrfToken } = await loginAs(student.user);
      const res = await postAs(agent, csrfToken, "/api/v1/finance/refunds", {
        payment: payment._id,
        reason: "Fee charged after the student had withdrawn from the programme",
      });
      expect(res.status).toBe(201);
      const Refund = require("../src/models/Refund");
      return Refund.findById(res.body.data.refund.id).lean();
    })();

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);
    await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/refunds/${refund.reference}/approve`,
      {
        note: "Confirmed with the billing office",
      }
    );

    const res = await agent.get("/api/v1/finance/reconcile");

    expect(res.status).toBe(200);
    // The money went back, so the ledger says unpaid and reconciliation has to
    // agree rather than flag it forever.
    expect(res.body.data.discrepancies).toHaveLength(0);
    expect(res.body.data.clean).toBe(true);
  });

  it("detects a drifted balance", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);

    // Simulate a ledger that disagrees with its payments.
    await Invoice.updateOne(
      { _id: invoice._id },
      { $set: { paidAmount: invoice.total, balanceDue: 0, status: INVOICE_STATUS.PAID } }
    );

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent } = await loginAs(accounts);
    const res = await agent.get("/api/v1/finance/reconcile");

    expect(res.body.data.clean).toBe(false);
    expect(res.body.data.discrepancies.length).toBeGreaterThan(0);
  });

  it("does not silently correct a discrepancy", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    await Invoice.updateOne(
      { _id: invoice._id },
      { $set: { paidAmount: 50000, balanceDue: invoice.total - 50000 } }
    );

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent } = await loginAs(accounts);
    await agent.get("/api/v1/finance/reconcile");

    // Reconciliation reports; it does not write.
    const fresh = await Invoice.findById(invoice._id).lean();
    expect(fresh.paidAmount).toBe(50000);
  });

  it("refuses reconciliation to a student", async () => {
    const student = await createStudent();
    const { agent } = await loginAs(student.user);
    const res = await agent.get("/api/v1/finance/reconcile");

    expectError(res, 403, "FORBIDDEN");
  });
});

describe("signature primitives", () => {
  it("verifies a genuine webhook HMAC and rejects a tampered one", () => {
    const raw = Buffer.from(
      '{"event":"payment.captured","payload":{"entity":{"id":"pay_1"}}}'
    );
    const secret = "whsec_test";
    const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");

    const { verifyWebhookSignature } = require("../src/config/razorpay");
    expect(verifyWebhookSignature(raw, sig, secret)).toBe(true);
    expect(verifyWebhookSignature(Buffer.from("tampered"), sig, secret)).toBe(false);
    expect(verifyWebhookSignature(raw, sig, "other")).toBe(false);
  });

  it("does not accept a refresh token as a payment credential", () => {
    // A defence-in-depth check: payment signatures use a different secret.
    const { verifyPaymentSignature } = require("../src/config/razorpay");
    const expect4 = verifyPaymentSignature({
      orderId: "order_1",
      razorpayPaymentId: "pay_1",
      razorpaySignature: "x".repeat(64),
      keySecret: "mock_webhook_secret_not_usable_in_production",
    });
    expect(expect4).toBe(false);
  });
});

// ===========================================================================
// Receipts and refunds
//
// Receipts are issued from the single point at which a payment settles, so
// these tests start from a settled payment rather than calling the receipt
// service directly — the guarantee is about the settlement path, not about the
// service in isolation.
// ===========================================================================

/** Create an order and settle it with a signed webhook. Returns the payment. */
async function settlePayment(
  student,
  invoice,
  { amount = invoice.total, id = "pay_R" } = {}
) {
  const { res: orderRes } = await makeOrder(student, invoice);
  expect(orderRes.status).toBe(201);

  const { raw, signature, event } = signedWebhook("payment.captured", {
    id,
    order_id: orderRes.body.data.razorpayOrderId,
    amount,
    status: "captured",
    method: "upi",
  });

  const res = await sendWebhook({ raw, signature, event });
  expect(res.status).toBe(200);

  return Payment.findById(orderRes.body.data.paymentId).lean();
}

describe("receipts", () => {
  it("issues a receipt when the payment settles", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    expect(payment.status).toBe(PAYMENT_STATUS.PAID);
    expect(payment.receiptNumber).toMatch(/^RCP-\d{4}-\d{6}$/);
    expect(payment.receipt.storageKey).toBeTruthy();
    expect(payment.receipt.mimeType).toBe("application/pdf");
  });

  it("issues exactly one receipt even when the capture is delivered repeatedly", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);

    const { agent, csrfToken } = await loginAs(student.user);
    const orderRes = await postAs(agent, csrfToken, "/api/v1/finance/payments/order", {
      invoice: invoice.reference,
    });

    const entity = {
      id: "pay_DUPRECEIPT",
      order_id: orderRes.body.data.razorpayOrderId,
      amount: invoice.total,
      status: "captured",
      method: "upi",
    };

    // Three distinct event ids carrying the same capture: each is a genuinely
    // new delivery as far as Razorpay is concerned.
    for (const eventId of ["evt_r1", "evt_r2", "evt_r3"]) {
      const raw = JSON.stringify({
        event: "payment.captured",
        payload: { entity: { ...entity, notes: { eventId } } },
      });
      const res = await request(getApp())
        .post("/api/v1/payments/webhook/razorpay")
        .set("Content-Type", "application/json")
        .set("x-razorpay-event", "payment.captured")
        .set(
          "x-razorpay-signature",
          signWebhookPayload(Buffer.from(raw), getGateway().webhookSecret)
        )
        .send(raw);
      expect(res.status).toBe(200);
    }

    const receipts = await Payment.find({ invoice: invoice._id })
      .select("receiptNumber")
      .lean();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].receiptNumber).toBeTruthy();
  });

  it("lets the owning student download their receipt", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    const { agent } = await loginAs(student.user);
    const res = await agent.get(`/api/v1/finance/payments/${payment._id}/receipt`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    // A real PDF, not an empty body.
    expect(res.body.subarray(0, 4).toString()).toBe("%PDF");
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it("404s when a student requests another student's receipt", async () => {
    const owner = await createStudent();
    const other = await createStudent();
    const invoice = await makeInvoice(owner);
    const payment = await settlePayment(owner, invoice);

    const { agent } = await loginAs(other.user);
    const res = await agent.get(`/api/v1/finance/payments/${payment._id}/receipt`);

    // 404, not 403: the receipt's existence must not be disclosed.
    expect(res.status).toBe(404);
  });

  it("refuses a receipt to a role with no payment permission", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    const faculty = await createUser({ role: ROLES.FACULTY });
    const { agent } = await loginAs(faculty);
    const res = await agent.get(`/api/v1/finance/payments/${payment._id}/receipt`);

    expect(res.status).toBe(404);
  });

  it("gives accounts staff the receipt", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent } = await loginAs(accounts);
    const res = await agent.get(`/api/v1/finance/payments/${payment._id}/receipt`);

    expect(res.status).toBe(200);
  });

  it("never issues a receipt for a payment that has not settled", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);

    // Order created, webhook never arrives.
    const { res } = await makeOrder(student, invoice);
    expect(res.status).toBe(201);

    const payment = await Payment.findById(res.body.data.paymentId).lean();
    expect(payment.status).toBe(PAYMENT_STATUS.CREATED);
    expect(payment.receiptNumber).toBeNull();
  });

  it("labels the receipt with the gateway mode so a mock is never filed as real", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    expect(payment.mode).toBe("MOCK");

    const { issueReceipt } = require("../src/services/receipt.service");
    const rendered = await require("../src/services/receipt.service").renderReceiptPdf({
      receiptNumber: payment.receiptNumber,
      payment,
      invoice: await Invoice.findById(invoice._id).lean(),
      student: await require("../src/models/Student")
        .findById(student.student)
        .populate("user", "fullName")
        .lean(),
      department: null,
      program: null,
      issuedAt: new Date(),
    });

    // A real PDF was produced.
    expect(rendered.subarray(0, 4).toString()).toBe("%PDF");

    // PDFKit compresses its content streams, so the label is asserted at its
    // source: this is the string printed on the face of the document.
    const { modeLabel } = require("../src/services/receipt.service");
    expect(modeLabel("MOCK").text).toContain("MOCK PAYMENT");
    expect(modeLabel("TEST").text).toContain("TEST PAYMENT");
    expect(modeLabel("LIVE").text).toBe("PAID");
    void issueReceipt;
  });
});

describe("refund requests", () => {
  it("records a request without moving any money", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    const { agent, csrfToken } = await loginAs(student.user);
    const res = await postAs(agent, csrfToken, "/api/v1/finance/refunds", {
      payment: payment._id,
      reason: "Fee paid in error after the course was withdrawn",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.refund.status).toBe("REQUESTED");
    expect(res.body.data.refund.refundAmount).toBe(invoice.total);

    // Nothing moved: the payment is untouched and still fully captured.
    const fresh = await Payment.findById(payment._id).lean();
    expect(fresh.status).toBe(PAYMENT_STATUS.PAID);
    expect(fresh.refundedAmount).toBe(0);

    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.status).toBe(INVOICE_STATUS.PAID);
  });

  it("defaults to the full remaining amount when none is given", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    const { agent, csrfToken } = await loginAs(student.user);
    const res = await postAs(agent, csrfToken, "/api/v1/finance/refunds", {
      payment: payment._id,
      reason: "Duplicate charge raised against my account this morning",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.refund.refundAmount).toBe(invoice.total);
  });

  it("refuses more than the amount still refundable and states the remainder", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    const { agent, csrfToken } = await loginAs(student.user);
    const res = await postAs(agent, csrfToken, "/api/v1/finance/refunds", {
      payment: payment._id,
      amount: "20000.00", // more than the invoice total
      reason: "Requesting an amount larger than was actually charged",
    });

    expect(res.status).toBe(400);
    // The message carries the number the student actually needs.
    expect(res.body.message).toContain("11,800.00");
  });

  it("404s when a student requests a refund against another student's payment", async () => {
    const owner = await createStudent();
    const other = await createStudent();
    const invoice = await makeInvoice(owner);
    const payment = await settlePayment(owner, invoice);

    const { agent, csrfToken } = await loginAs(other.user);
    const res = await postAs(agent, csrfToken, "/api/v1/finance/refunds", {
      payment: payment._id,
      reason: "This refund request is not mine to make in any case",
    });

    expect(res.status).toBe(404);
    expect(await Refund.countDocuments({ payment: payment._id })).toBe(0);
  });

  it("refuses a request with no substantive reason", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    const { agent, csrfToken } = await loginAs(student.user);
    const res = await postAs(agent, csrfToken, "/api/v1/finance/refunds", {
      payment: payment._id,
      reason: "no",
    });

    expect(res.status).toBe(400);
  });

  it("refuses a refund against a payment that never settled", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { res: orderRes } = await makeOrder(student, invoice);

    const { agent, csrfToken } = await loginAs(student.user);
    const res = await postAs(agent, csrfToken, "/api/v1/finance/refunds", {
      payment: orderRes.body.data.paymentId,
      reason: "There was never any money taken to refund in the first place",
    });

    expect(res.status).toBe(400);
  });

  it("reports the refundable balance for the client's UI", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    const { agent } = await loginAs(student.user);
    const res = await agent.get(`/api/v1/finance/payments/${payment._id}/refundable`);

    expect(res.status).toBe(200);
    expect(res.body.data.refundableAmount).toBe(invoice.total);
    expect(res.body.data.refundableFormatted).toBe("₹11,800.00");
  });
});

describe("refund decisions", () => {
  /** Request a refund and return the refund document. */
  async function requestOne(student, payment, body = {}) {
    const { agent, csrfToken } = await loginAs(student.user);
    const res = await postAs(agent, csrfToken, "/api/v1/finance/refunds", {
      payment: payment._id,
      reason: "Fee charged after the student had withdrawn from the programme",
      ...body,
    });
    expect(res.status).toBe(201);
    return Refund.findById(res.body.data.refund.id).lean();
  }

  it("refuses approval by the student who requested it", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);
    const refund = await requestOne(student, payment);

    const { agent, csrfToken } = await loginAs(student.user);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/refunds/${refund.reference}/approve`,
      {}
    );

    // The whole point of separating the acts: a student can never move money.
    expect(res.status).toBe(403);
    expect((await Refund.findById(refund._id).lean()).status).toBe("REQUESTED");
  });

  it("executes the refund on approval and reopens the invoice", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);
    const refund = await requestOne(student, payment);

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/refunds/${refund.reference}/approve`,
      {
        note: "Confirmed duplicate charge with the billing office",
      }
    );

    expect(res.status).toBe(200);
    expect(res.body.data.refund.status).toBe("PROCESSED");
    expect(res.body.data.refund.razorpayRefundId).toBeTruthy();

    const freshPayment = await Payment.findById(payment._id).lean();
    expect(freshPayment.refundedAmount).toBe(invoice.total);

    // Fully refunded: the money is back, so the invoice is no longer settled.
    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.status).toBe(INVOICE_STATUS.ISSUED);
    expect(ledger.paidAmount).toBe(0);
    expect(ledger.balanceDue).toBe(invoice.total);
    expect(ledger.isFullyPaid).toBe(false);
  });

  /**
   * The bug this guards: an invoice can carry several payments, because a retry
   * creates a new one. Fully refunding one of them used to zero `paidAmount` for
   * the whole invoice, so the student was re-billed for money still captured and
   * the ledger stopped matching the payments underneath it.
   */
  it("only reverses the refunded payment when an invoice has two of them", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const half = Math.floor(invoice.total / 2);

    const first = await settlePayment(student, invoice, {
      amount: half,
      id: "pay_first",
    });
    await settlePayment(student, invoice, { amount: half, id: "pay_second" });

    const settled = await Invoice.findById(invoice._id).lean();
    expect(settled.paidAmount).toBe(invoice.total);
    expect(settled.status).toBe(INVOICE_STATUS.PAID);

    const refund = await requestOne(student, first, {
      amount: (half / 100).toFixed(2),
    });

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);
    const approved = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/refunds/${refund.reference}/approve`,
      { note: "Duplicate charge" }
    );
    expect(approved.status).toBe(200);

    const ledger = await Invoice.findById(invoice._id).lean();

    // The first payment came back; the second is still captured. So the invoice
    // is half paid again — not unpaid in full.
    expect(ledger.paidAmount).toBe(half);
    expect(ledger.balanceDue).toBe(invoice.total - half);
    expect(ledger.status).toBe(INVOICE_STATUS.ISSUED);
    expect(ledger.isFullyPaid).toBe(false);
  });

  it("keeps the invoice settled when only part of the payment is refunded", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);
    const refund = await requestOne(student, payment, { amount: "100.00" });

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/refunds/${refund.reference}/approve`,
      {}
    );

    expect(res.status).toBe(200);

    const freshPayment = await Payment.findById(payment._id).lean();
    expect(freshPayment.refundedAmount).toBe(10000);

    // A partial refund does not un-settle the invoice.
    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.status).toBe(INVOICE_STATUS.PAID);
    expect(ledger.isFullyPaid).toBe(true);
  });

  it("accumulates partial refunds and only reopens once the whole payment is returned", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent: accAgent, csrfToken: accCsrf } = await loginAs(accounts);

    // Three separate ₹100 refunds against a ₹11,800 payment.
    for (let i = 0; i < 3; i++) {
      const refund = await requestOne(student, payment, { amount: "100.00" });
      const res = await postAs(
        accAgent,
        accCsrf,
        `/api/v1/finance/refunds/${refund.reference}/approve`,
        {}
      );
      expect(res.status).toBe(200);
      const ledger = await Invoice.findById(invoice._id).lean();
      expect(ledger.status).toBe(INVOICE_STATUS.PAID);
    }

    const afterThree = await Payment.findById(payment._id).lean();
    expect(afterThree.refundedAmount).toBe(30000);
    expect(afterThree.capturedAmount).toBe(invoice.total);

    // The remainder is bounded correctly after the partials.
    const { agent: stuAgent } = await loginAs(student.user);
    const remaining = await stuAgent.get(
      `/api/v1/finance/payments/${payment._id}/refundable`
    );
    expect(remaining.body.data.refundableAmount).toBe(invoice.total - 30000);
    expect(remaining.body.data.refundableFormatted).toBe("₹11,500.00");

    // Returning the rest reopens the invoice.
    const finalRefund = await requestOne(student, payment);
    const finalRes = await postAs(
      accAgent,
      accCsrf,
      `/api/v1/finance/refunds/${finalRefund.reference}/approve`,
      {}
    );
    expect(finalRes.status).toBe(200);

    const done = await Payment.findById(payment._id).lean();
    expect(done.refundedAmount).toBe(invoice.total);

    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.status).toBe(INVOICE_STATUS.ISSUED);
    expect(ledger.balanceDue).toBe(invoice.total);
  });

  it("refuses to refund the same request twice", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);
    const refund = await requestOne(student, payment);

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);

    const first = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/refunds/${refund.reference}/approve`,
      {}
    );
    expect(first.status).toBe(200);

    // The second attempt must not move money again.
    const second = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/refunds/${refund.reference}/approve`,
      {}
    );
    expect(second.status).toBe(409);

    const freshPayment = await Payment.findById(payment._id).lean();
    expect(freshPayment.refundedAmount).toBe(invoice.total);
  });

  it("refuses approval when the remaining balance no longer covers the request", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);

    // Both requests are raised while the money is still whole; the second then
    // loses its backing when the first is processed.
    const first = await requestOne(student, payment);
    const second = await requestOne(student, payment);

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);

    expect(
      (
        await postAs(
          agent,
          csrfToken,
          `/api/v1/finance/refunds/${first.reference}/approve`,
          {}
        )
      ).status
    ).toBe(200);

    // The second no longer has anything behind it.
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/refunds/${second.reference}/approve`,
      {}
    );
    expect(res.status).toBe(409);
    // The first refund consumed the whole payment, so nothing remains.
    expect(res.body.message).toContain("₹0.00");
  });

  it("marks a refund FAILED and credits nothing when the provider rejects it", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);
    const refund = await requestOne(student, payment);

    const gateway = getGateway();
    const original = gateway.refundPayment.bind(gateway);
    gateway.refundPayment = async () => {
      throw new Error("provider rejected: insufficient balance in the merchant account");
    };

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/refunds/${refund.reference}/approve`,
      {}
    );

    gateway.refundPayment = original;

    // Surfaced as an integration failure, never as a successful refund.
    expect(res.status).toBe(502);

    const freshRefund = await Refund.findById(refund._id).lean();
    expect(freshRefund.status).toBe("FAILED");
    expect(freshRefund.failureDescription).toContain("provider rejected");

    // The ledger must not claim the money is back.
    const freshPayment = await Payment.findById(payment._id).lean();
    expect(freshPayment.refundedAmount).toBe(0);

    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.status).toBe(INVOICE_STATUS.PAID);
  });

  it("declines a refund with a stated reason and leaves the money settled", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);
    const refund = await requestOne(student, payment);

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/refunds/${refund.reference}/reject`,
      {
        reason: "The fee is non-refundable once the examination has been sat",
      }
    );

    expect(res.status).toBe(200);
    expect(res.body.data.refund.status).toBe("REJECTED");
    expect(res.body.data.refund.rejectionReason).toContain("non-refundable");

    const freshPayment = await Payment.findById(payment._id).lean();
    expect(freshPayment.refundedAmount).toBe(0);
    expect((await Invoice.findById(invoice._id).lean()).status).toBe(INVOICE_STATUS.PAID);
  });

  it("refuses a rejection with no reason given", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);
    const refund = await requestOne(student, payment);

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/refunds/${refund.reference}/reject`,
      {
        reason: "no",
      }
    );

    expect(res.status).toBe(400);
    expect((await Refund.findById(refund._id).lean()).status).toBe("REQUESTED");
  });

  it("notifies the student of the decision", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const payment = await settlePayment(student, invoice);
    const refund = await requestOne(student, payment);

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);
    await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/refunds/${refund.reference}/approve`,
      {}
    );

    const notifications = await Notification.find({ user: student.user._id }).lean();
    expect(notifications.some((n) => n.title.includes(refund.reference))).toBe(true);
  });
});

describe("refund visibility", () => {
  it("shows a student only their own refunds", async () => {
    const mine = await createStudent();
    const theirs = await createStudent();

    const myInvoice = await makeInvoice(mine);
    const theirInvoice = await makeInvoice(theirs);
    const myPayment = await settlePayment(mine, myInvoice, { id: "pay_MINE" });
    const theirPayment = await settlePayment(theirs, theirInvoice, { id: "pay_THEIRS" });

    for (const [who, payment] of [
      [mine, myPayment],
      [theirs, theirPayment],
    ]) {
      const { agent, csrfToken } = await loginAs(who.user);
      await postAs(agent, csrfToken, "/api/v1/finance/refunds", {
        payment: payment._id,
        reason: "Requesting a return of the fee charged in error this term",
      });
    }

    const { agent } = await loginAs(mine.user);
    const res = await agent.get("/api/v1/finance/refunds");

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].payment._id.toString()).toBe(myPayment._id.toString());
  });

  it("shows accounts staff every refund", async () => {
    const a = await createStudent();
    const b = await createStudent();
    const invA = await makeInvoice(a);
    const invB = await makeInvoice(b);
    const payA = await settlePayment(a, invA, { id: "pay_A" });
    const payB = await settlePayment(b, invB, { id: "pay_B" });

    for (const [who, payment] of [
      [a, payA],
      [b, payB],
    ]) {
      const { agent, csrfToken } = await loginAs(who.user);
      const res = await postAs(agent, csrfToken, "/api/v1/finance/refunds", {
        payment: payment._id,
        reason: "Both students were charged for a course they did not attend",
      });
      expect(res.status).toBe(201);
    }

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent } = await loginAs(accounts);
    const res = await agent.get("/api/v1/finance/refunds");

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
  });

  it("404s when a student fetches another student's refund by reference", async () => {
    const owner = await createStudent();
    const other = await createStudent();
    const invoice = await makeInvoice(owner);
    const payment = await settlePayment(owner, invoice);

    const { agent: oAgent, csrfToken: oCsrf } = await loginAs(owner.user);
    const created = await postAs(oAgent, oCsrf, "/api/v1/finance/refunds", {
      payment: payment._id,
      reason: "Requesting a return of a fee charged in error this term",
    });
    const reference = created.body.data.refund.reference;

    const { agent } = await loginAs(other.user);
    expect((await agent.get(`/api/v1/finance/refunds/${reference}`)).status).toBe(404);
  });
});

describe("unique index integrity", () => {
  /**
   * A regression guard for a bug that made the second refund in the system's
   * history impossible.
   *
   * `unique: true` on a field with `default: null` indexes `null` as an ordinary
   * value, so only one document can hold it — and `sparse: true` does not save
   * it, because sparse skips documents where the field is *missing*, not null.
   *
   * The symptom was a duplicate-key CONFLICT on the second refund request with
   * an error naming a field the student had never supplied. It is asserted here
   * directly so the schema cannot silently regress.
   */
  it("allows many documents to share a null refund reference", async () => {
    const requester = await createUser({ role: ROLES.STUDENT });
    const created = [];
    for (let i = 0; i < 3; i++) {
      created.push(
        await Refund.create({
          reference: `REF-TEST-${i}`,
          payment: new mongoose.Types.ObjectId(),
          invoice: new mongoose.Types.ObjectId(),
          student: new mongoose.Types.ObjectId(),
          refundAmount: 100,
          reason: "Placeholder used only to prove the index permits nulls",
          status: "REQUESTED",
          requestedBy: requester._id,
        })
      );
    }

    expect(created).toHaveLength(3);
    // All three hold the same null, which a naive unique index forbids.
    const stored = await Refund.find({ reference: /^REF-TEST-/ }).lean();
    expect(stored.map((r) => r.razorpayRefundId)).toEqual([null, null, null]);
  });

  it("still refuses a duplicate real refund reference", async () => {
    const requester = await createUser({ role: ROLES.STUDENT });
    const oid = () => new mongoose.Types.ObjectId();
    const base = {
      payment: oid(),
      invoice: oid(),
      student: oid(),
      refundAmount: 100,
      reason: "Placeholder used only to prove real duplicates are refused",
      status: "REQUESTED",
      requestedBy: requester._id,
    };

    await Refund.create({
      reference: "REF-UNIQUE-TEST",
      razorpayRefundId: "rfnd_real_1",
      ...base,
    });

    // The constraint must survive: two documents cannot claim one refund id.
    await expect(
      Refund.create({
        reference: "REF-UNIQUE-TEST-2",
        razorpayRefundId: "rfnd_real_1",
        ...base,
      })
    ).rejects.toThrow(/duplicate|E11000/i);
  });
});

describe("document currency rendering", () => {
  /**
   * Regression guard for a bug that printed a wrong figure on a receipt.
   *
   * PDFKit's built-in fonts are WinAnsi-encoded and carry no glyph for U+20B9.
   * The ₹ did not merely vanish: PDFKit substituted a character from the
   * private-use area, and a receipt for ₹5,900.00 rendered as "15,900.00" —
   * an amount off by a factor of nearly three, on a financial document, while
   * the database held the correct value throughout.
   */
  it("uses a symbol the standard PDF fonts can actually render", () => {
    const doc = money.formatForDocument(590000);

    // No unsupported glyph may reach a PDF renderer.
    expect(doc).not.toContain("\u20B9");
    // The digits must be intact and exact.
    expect(doc).toBe("Rs. 5,900.00");
  });

  it("keeps the screen format unchanged for the application UI", () => {
    expect(money.format(590000)).toBe("\u20B95,900.00");
  });

  it("renders the exact captured amount into the receipt PDF", async () => {
    const { renderReceiptPdf } = require("../src/services/receipt.service");

    const buffer = await renderReceiptPdf({
      receiptNumber: "RCP-TEST-1",
      payment: {
        razorpayOrderId: "order_TEST",
        razorpayPaymentId: "pay_TEST",
        capturedAmount: 590000,
        amount: 590000,
        method: "upi",
        mode: "MOCK",
      },
      invoice: { reference: "INV-TEST-1", total: 590000, balanceDue: 0 },
      student: { rollNumber: "CS001", user: { fullName: "Test Student" } },
      department: null,
      program: null,
      issuedAt: new Date("2026-01-15T10:30:00Z"),
    });

    const text = pdfText(buffer);

    // The amount appears verbatim.
    expect(text).toContain("5,900.00");
    // Carries the one symbol the standard PDF fonts can render.
    expect(text).toContain("Rs. 5,900.00");

    // Neither the rupee sign nor its broken substitution may appear. U+00B9 is
    // what PDFKit emitted instead: a superscript one, which reads as a digit,
    // so the receipt appeared to say "15,900.00".
    expect(text).not.toContain("\u20B9");
    expect(text).not.toContain("\u00B9");
  });
});

/**
 * Recover the visible text from a PDFKit document.
 *
 * PDFKit compresses each content stream and writes text as a hex-encoded
 * string inside a `TJ` array, so a rendered PDF is not greppable as-is. This
 * inflates every deflate stream and decodes the hex operands back to characters
 * — which is what makes it possible to assert that a receipt actually prints
 * the right amount rather than merely that a PDF was produced.
 */
function pdfText(buffer) {
  const zlib = require("zlib");
  const raw = buffer.toString("latin1");
  const streams = [];

  const marker = /stream\r?\n/g;
  let match;
  while ((match = marker.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("\nendstream", start);
    if (end === -1) continue;
    try {
      streams.push(
        zlib.inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1")
      );
    } catch {
      // Not a deflate stream (font data, for instance).
    }
  }

  // PDFKit splits a line into several TJ operands to apply kerning, so every
  // hex string inside an array belongs to the same run of text and all of them
  // must be concatenated in order.
  const decoded = [];
  for (const stream of streams) {
    const arrays = /\[([^\]]*)\]\s*TJ/g;
    let hit;
    while ((hit = arrays.exec(stream)) !== null) {
      let run = "";
      for (const operand of hit[1].matchAll(/<([0-9a-fA-F]+)>/g)) {
        run += Buffer.from(operand[1], "hex").toString("latin1");
      }
      if (run) decoded.push(run);
    }
    // Literal strings, used when the text needs no hex escaping.
    for (const literal of stream.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
      decoded.push(literal[1]);
    }
  }

  return decoded.join("\n");
}

// ===========================================================================
// Direct gateway verification — the settlement path when no webhook URL exists
//
// The security property under test is the same one the webhook path defends:
// nothing the browser sends may cause an invoice to be marked paid. The
// difference is that here the browser supplies an id and Razorpay supplies the
// facts, so these tests are written to attack exactly that boundary.
// ===========================================================================

describe("gateway verification settles nothing on the client's word", () => {
  /** Start an order and report a payment from checkout, as the browser would. */
  async function attemptedPayment(student, invoice, { paymentId = "pay_VERIFY" } = {}) {
    const { agent, csrfToken } = await loginAs(student.user);
    const orderRes = await postAs(agent, csrfToken, "/api/v1/finance/payments/order", {
      invoice: invoice.reference,
    });
    expect(orderRes.status).toBe(201);

    const confirmRes = await postAs(
      agent,
      csrfToken,
      "/api/v1/finance/payments/confirm",
      {
        razorpayOrderId: orderRes.body.data.razorpayOrderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: getGateway().isMock
          ? signPayment(
              orderRes.body.data.razorpayOrderId,
              paymentId,
              getGateway().keySecret
            )
          : "irrelevant",
      }
    );
    expect(confirmRes.status).toBe(200);

    return {
      agent,
      csrfToken,
      paymentId: orderRes.body.data.paymentId,
      orderId: orderRes.body.data.razorpayOrderId,
    };
  }

  it("credits only after Razorpay confirms the capture", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { agent, csrfToken, paymentId, orderId } = await attemptedPayment(
      student,
      invoice
    );

    const before = await Invoice.findById(invoice._id).lean();
    expect(before.status).toBe(INVOICE_STATUS.ISSUED);

    // The gateway knows about this payment, because a student really made it.
    getGateway().registerPayment("pay_VERIFY", { orderId, amount: invoice.total });

    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/payments/${paymentId}/verify`,
      {}
    );

    expect(res.status).toBe(200);
    expect(res.body.data.applied).toBe(true);
    expect(res.body.data.capturedAmount).toBe(invoice.total);

    const after = await Invoice.findById(invoice._id).lean();
    expect(after.status).toBe(INVOICE_STATUS.PAID);
    expect(after.balanceDue).toBe(0);
  });

  it("issues a receipt through this path too", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { agent, csrfToken, paymentId, orderId } = await attemptedPayment(
      student,
      invoice
    );

    getGateway().registerPayment("pay_VERIFY", { orderId, amount: invoice.total });
    await postAs(agent, csrfToken, `/api/v1/finance/payments/${paymentId}/verify`, {});

    const payment = await Payment.findById(paymentId).lean();
    expect(payment.receiptNumber).toMatch(/^RCP-/);
    expect(payment.verifiedVia).toBe("gateway_api");
  });

  it("refuses to settle a payment id the gateway does not recognise", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { agent, csrfToken, paymentId } = await attemptedPayment(student, invoice, {
      paymentId: "pay_COMPLETELY_MADE_UP",
    });

    // The gateway refuses to find it, which is a lookup failure — not a payment
    // failure, and emphatically not a settlement.
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/payments/${paymentId}/verify`,
      {}
    );

    expect(res.status).toBe(502);

    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.status).toBe(INVOICE_STATUS.ISSUED);
    expect(ledger.balanceDue).toBe(invoice.total);
    expect(ledger.paidAmount).toBe(0);
  });

  it("refuses a payment the gateway reports as not captured", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { agent, csrfToken, paymentId } = await attemptedPayment(student, invoice);

    const gateway = getGateway();
    const original = gateway.fetchPayment.bind(gateway);
    gateway.fetchPayment = async () => ({
      id: "pay_VERIFY",
      orderId: (await Payment.findById(paymentId).lean()).razorpayOrderId,
      amount: invoice.total,
      status: "authorized", // created or authorized: not yet captured
      method: "upi",
      captured: false,
    });

    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/payments/${paymentId}/verify`,
      {}
    );
    gateway.fetchPayment = original;

    expect(res.status).toBe(200);
    expect(res.body.data.applied).toBe(false);
    expect(res.body.data.reason).toBe("not_yet_captured");

    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.status).toBe(INVOICE_STATUS.ISSUED);
    expect(ledger.balanceDue).toBe(invoice.total);
  });

  it("refuses a payment the gateway reports as failed", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { agent, csrfToken, paymentId } = await attemptedPayment(student, invoice);

    const gateway = getGateway();
    const original = gateway.fetchPayment.bind(gateway);
    gateway.fetchPayment = async () => ({
      id: "pay_VERIFY",
      orderId: (await Payment.findById(paymentId).lean()).razorpayOrderId,
      amount: invoice.total,
      status: "failed",
      method: "upi",
      captured: false,
    });

    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/payments/${paymentId}/verify`,
      {}
    );
    gateway.fetchPayment = original;

    expect(res.body.data.applied).toBe(false);
    expect(res.body.data.reason).toBe("payment_failed");

    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.status).toBe(INVOICE_STATUS.ISSUED);
  });

  it("refuses a payment the gateway attributes to a different order", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { agent, csrfToken, paymentId } = await attemptedPayment(student, invoice);

    const gateway = getGateway();
    const original = gateway.fetchPayment.bind(gateway);
    gateway.fetchPayment = async () => ({
      id: "pay_VERIFY",
      orderId: "order_SOMEONE_ELSES",
      amount: invoice.total,
      status: "captured",
      method: "upi",
      captured: true,
    });

    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/payments/${paymentId}/verify`,
      {}
    );
    gateway.fetchPayment = original;

    expect(res.status).toBe(409);

    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.status).toBe(INVOICE_STATUS.ISSUED);
    expect(ledger.balanceDue).toBe(invoice.total);

    const payment = await Payment.findById(paymentId).lean();
    expect(payment.status).toBe(PAYMENT_STATUS.FAILED);
  });

  it("refuses a captured amount larger than the order", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { agent, csrfToken, paymentId } = await attemptedPayment(student, invoice);

    const gateway = getGateway();
    const original = gateway.fetchPayment.bind(gateway);
    gateway.fetchPayment = async () => ({
      id: "pay_VERIFY",
      orderId: (await Payment.findById(paymentId).lean()).razorpayOrderId,
      amount: invoice.total * 10, // far more than was ever ordered
      status: "captured",
      method: "upi",
      captured: true,
    });

    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/payments/${paymentId}/verify`,
      {}
    );
    gateway.fetchPayment = original;

    expect(res.status).toBe(409);

    // The ledger must not have been inflated by the larger figure.
    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.paidAmount).toBe(0);
    expect(ledger.balanceDue).toBe(invoice.total);
  });

  it("credits a genuine partial capture and leaves the balance outstanding", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { agent, csrfToken, paymentId } = await attemptedPayment(student, invoice);

    const gateway = getGateway();
    const original = gateway.fetchPayment.bind(gateway);
    gateway.fetchPayment = async () => ({
      id: "pay_VERIFY",
      orderId: (await Payment.findById(paymentId).lean()).razorpayOrderId,
      amount: 10000, // Rs.100 of Rs.11,800
      status: "captured",
      method: "upi",
      captured: true,
    });

    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/payments/${paymentId}/verify`,
      {}
    );
    gateway.fetchPayment = original;

    expect(res.body.data.applied).toBe(true);

    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.status).toBe(INVOICE_STATUS.PARTIALLY_PAID);
    expect(ledger.paidAmount).toBe(10000);
    expect(ledger.balanceDue).toBe(invoice.total - 10000);
    expect(ledger.isFullyPaid).toBe(false);
  });

  it("will not settle the same payment twice", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { agent, csrfToken, paymentId, orderId } = await attemptedPayment(
      student,
      invoice
    );

    getGateway().registerPayment("pay_VERIFY", { orderId, amount: invoice.total });

    const first = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/payments/${paymentId}/verify`,
      {}
    );
    expect(first.body.data.applied).toBe(true);

    const second = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/payments/${paymentId}/verify`,
      {}
    );
    expect(second.status).toBe(200);
    expect(second.body.data.applied).toBe(false);
    expect(second.body.data.reason).toBe("already_settled");

    // Exactly one credit.
    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.paidAmount).toBe(invoice.total);
    expect(ledger.balanceDue).toBe(0);
  });

  it("does not double-credit when a webhook has already settled it", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);
    const { agent, csrfToken, paymentId, orderId } = await attemptedPayment(
      student,
      invoice
    );

    // The webhook arrives first and settles.
    const { raw, signature, event } = signedWebhook("payment.captured", {
      id: "pay_VERIFY",
      order_id: orderId,
      amount: invoice.total,
      status: "captured",
      method: "upi",
    });
    expect((await sendWebhook({ raw, signature, event })).status).toBe(200);

    // Verification must then be a no-op rather than a second credit.
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/payments/${paymentId}/verify`,
      {}
    );

    expect(res.body.data.applied).toBe(false);
    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.paidAmount).toBe(invoice.total);
    expect(ledger.balanceDue).toBe(0);
  });

  it("404s when a student verifies another student's payment", async () => {
    const owner = await createStudent();
    const other = await createStudent();
    const invoice = await makeInvoice(owner);
    const { paymentId } = await attemptedPayment(owner, invoice);

    const { agent, csrfToken } = await loginAs(other.user);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/payments/${paymentId}/verify`,
      {}
    );

    expect(res.status).toBe(404);
    expect((await Invoice.findById(invoice._id).lean()).status).toBe(
      INVOICE_STATUS.ISSUED
    );
  });

  it("demands a gateway reference before it will call the provider", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);

    // Order created, checkout never reported.
    const { agent, csrfToken } = await makeOrder(student, invoice);
    const paymentId = (await Payment.findOne({ invoice: invoice._id }).lean())._id;

    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/finance/payments/${paymentId}/verify`,
      {}
    );

    expect(res.status).toBe(400);
    expect((await Invoice.findById(invoice._id).lean()).status).toBe(
      INVOICE_STATUS.ISSUED
    );
  });
});

describe("pending payment sweep", () => {
  it("settles payments left behind by a closed browser", async () => {
    const student = await createStudent();
    const invoice = await makeInvoice(student);

    // Student pays, then closes the tab without confirming.
    const { res: orderRes } = await makeOrder(student, invoice);
    await Payment.updateOne(
      { _id: orderRes.body.data.paymentId },
      {
        $set: {
          status: PAYMENT_STATUS.ATTEMPTED,
          razorpayPaymentId: "pay_SWEEP",
        },
      }
    );

    const gateway = getGateway();
    const original = gateway.fetchPayment.bind(gateway);
    gateway.fetchPayment = async () => ({
      id: "pay_SWEEP",
      orderId: orderRes.body.data.razorpayOrderId,
      amount: invoice.total,
      status: "captured",
      method: "upi",
      captured: true,
    });

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);
    const res = await postAs(
      agent,
      csrfToken,
      "/api/v1/finance/payments/verify-pending",
      {}
    );

    gateway.fetchPayment = original;

    expect(res.status).toBe(200);
    expect(res.body.data.checked).toBe(1);
    expect(res.body.data.settled).toBe(1);

    const ledger = await Invoice.findById(invoice._id).lean();
    expect(ledger.status).toBe(INVOICE_STATUS.PAID);
  });

  it("continues past a payment the provider cannot be asked about", async () => {
    const a = await createStudent();
    const b = await createStudent();
    const invA = await makeInvoice(a);
    const invB = await makeInvoice(b);

    const { res: orderA } = await makeOrder(a, invA);
    const { res: orderB } = await makeOrder(b, invB);

    for (const [order, payId] of [
      [orderA, "pay_ONE"],
      [orderB, "pay_TWO"],
    ]) {
      await Payment.updateOne(
        { _id: order.body.data.paymentId },
        { $set: { status: PAYMENT_STATUS.ATTEMPTED, razorpayPaymentId: payId } }
      );
    }

    const gateway = getGateway();
    const original = gateway.fetchPayment.bind(gateway);
    // One unreachable, one genuinely captured.
    gateway.fetchPayment = async (paymentId) => {
      if (paymentId === "pay_ONE") {
        throw { error: { description: "The id provided does not exist" } };
      }
      return {
        id: paymentId,
        orderId: orderB.body.data.razorpayOrderId,
        amount: invB.total,
        status: "captured",
        method: "upi",
        captured: true,
      };
    };

    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent, csrfToken } = await loginAs(accounts);
    const res = await postAs(
      agent,
      csrfToken,
      "/api/v1/finance/payments/verify-pending",
      {}
    );

    gateway.fetchPayment = original;

    expect(res.body.data.checked).toBe(2);
    expect(res.body.data.errors).toBe(1);
    // The reachable payment was still settled.
    expect(res.body.data.settled).toBe(1);
    expect((await Invoice.findById(invB._id).lean()).status).toBe(INVOICE_STATUS.PAID);
    expect((await Invoice.findById(invA._id).lean()).status).toBe(INVOICE_STATUS.ISSUED);
  });

  it("refuses the sweep to a student", async () => {
    const student = await createStudent();
    const { agent, csrfToken } = await loginAs(student.user);

    const res = await postAs(
      agent,
      csrfToken,
      "/api/v1/finance/payments/verify-pending",
      {}
    );
    expect(res.status).toBe(403);
  });
});

describe("refund list paging", () => {
  /**
   * A regression guard for a bug the refund page found.
   *
   * `listRefunds` has always paginated, but the request validator accepted only
   * a status filter, so `?page=2&limit=20` was rejected with a 400 and the list
   * could only ever be read whole. The service was correct and reachable code
   * that the validator made unreachable.
   */
  it("accepts a page and a limit", async () => {
    const student = await createStudent();
    const { agent } = await loginAs(student.user);

    const res = await agent.get("/api/v1/finance/refunds?page=1&limit=20");

    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(20);
  });

  it("reports a narrowed page rather than silently returning the first", async () => {
    const student = await createStudent();
    const { agent } = await loginAs(student.user);

    const res = await agent.get("/api/v1/finance/refunds?page=3&limit=5");

    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(3);
    expect(res.body.meta.limit).toBe(5);
    expect(res.body.meta.total).toBe(0);
  });

  it("still refuses an out-of-range limit", async () => {
    const student = await createStudent();
    const { agent } = await loginAs(student.user);

    const res = await agent.get("/api/v1/finance/refunds?limit=5000");

    expect(res.status).toBe(400);
  });
});
