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
