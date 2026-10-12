/**
 * Live drill: settle a payment, fetch the receipt, then refund it.
 * Run against a live dev server: node scripts/refund-drill.js
 */
const BASE = "http://localhost:5000/api/v1";
const { signWebhookPayload, getGateway } = require("../src/config/razorpay");

const jars = {};
const RUN = Date.now().toString(36).toUpperCase();
const PAYMENT_ID = `pay_DRILL${RUN}`;
const csrf = {};

async function login(who, email) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Demo@Campus123" }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`login ${email}: ${body.message}`);
  const jar = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  jars[who] = jar;
  csrf[who] = (jar.match(/cos_ct=([^;]*)/) || [])[1];
  return body.data.user;
}

const call = async (who, method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Cookie: jars[who],
      ...(method === "POST" ? { "X-CSRF-Token": csrf[who] } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null), res };
};

const ok = (label, cond, detail = "") =>
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);

(async () => {
  const student = await login("student", "demo.student.democs001@campusos.local");
  await login("accounts", "demo.accounts@campusos.local");
  console.log(`\nSigned in as ${student.email}  (run ${RUN})\n`);

  const me = await call("student", "GET", "/auth/me");
  const sid = me.body.data.student.id;

  // ---- 1. Invoice ----
  const inv = await call("accounts", "POST", "/finance/invoices", {
    student: sid,
    purpose: "Refund drill",
    items: [
      { description: "Lab fee", quantity: 1, unitAmount: "5000.00", taxPercent: 18 },
    ],
  });
  const invoice = inv.body.data;
  console.log("1. INVOICE");
  ok(
    "created server-side total",
    invoice.total === 590000,
    `₹${invoice.totalFormatted} (${invoice.total} paise)`
  );
  ok("status ISSUED", invoice.status === "ISSUED");

  // ---- 2. Order ----
  const ord = await call("student", "POST", "/finance/payments/order", {
    invoice: invoice.reference,
  });
  const order = ord.body.data;
  console.log("\n2. PAYMENT ORDER");
  ok("charged the invoice balance", order.amount === 590000, `₹${order.amountFormatted}`);
  ok("mock gateway flagged", order.isMock === true, `mode=${order.mode}`);

  // ---- 3. Browser callback must NOT settle ----
  const confirm = await call("student", "POST", "/finance/payments/confirm", {
    razorpayPaymentId: PAYMENT_ID,
    razorpayOrderId: order.razorpayOrderId,
    razorpaySignature: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  });
  const afterConfirm = await call(
    "accounts",
    "GET",
    `/finance/invoices/${invoice.reference}`
  );
  console.log("\n3. BROWSER CALLBACK (forged signature)");
  ok(
    "invoice NOT settled by the browser",
    afterConfirm.body.data.status === "ISSUED",
    `status ${afterConfirm.body.data.status}`
  );
  void confirm;

  // ---- 4. Signed webhook settles ----
  const raw = JSON.stringify({
    event: "payment.captured",
    payload: {
      entity: {
        id: PAYMENT_ID,
        order_id: order.razorpayOrderId,
        amount: 590000,
        status: "captured",
        method: "upi",
      },
    },
  });
  const sig = signWebhookPayload(Buffer.from(raw), getGateway().webhookSecret);
  const hook = async (body, signature, event = "payment.captured") => {
    const r = await fetch(`${BASE}/payments/webhook/razorpay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-event": event,
        "x-razorpay-signature": signature,
      },
      body,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const settled = await hook(raw, sig);
  const afterHook = await call(
    "accounts",
    "GET",
    `/finance/invoices/${invoice.reference}`
  );
  console.log("\n4. SIGNED WEBHOOK");
  ok("applied", settled.body?.data?.applied === true);
  ok(
    "invoice now PAID",
    afterHook.body.data.status === "PAID",
    `balance ${afterHook.body.data.balanceDue}`
  );

  // ---- 5. Duplicate ----
  const dup = await hook(raw, sig);
  const afterDup = await call(
    "accounts",
    "GET",
    `/finance/invoices/${invoice.reference}`
  );
  console.log("\n5. DUPLICATE DELIVERY");
  ok(
    "not re-applied",
    dup.body?.data?.applied === false && dup.body?.data?.reason === "duplicate_event"
  );
  ok("balance unchanged", afterDup.body.data.balanceDue === 0);

  // ---- 6. Receipt ----
  const paymentId = order.paymentId;
  const r1 = await fetch(`${BASE}/finance/payments/${paymentId}/receipt`, {
    headers: { Cookie: jars.student },
  });
  const buf = Buffer.from(await r1.arrayBuffer());
  console.log("\n6. RECEIPT");
  ok("student can download", r1.status === 200, `${buf.length} bytes`);
  ok("is a real PDF", buf.subarray(0, 4).toString() === "%PDF");

  const other = await login("other", "demo.student.democs002@campusos.local");
  const r2 = await fetch(`${BASE}/finance/payments/${paymentId}/receipt`, {
    headers: { Cookie: jars.other },
  });
  ok("another student gets 404", r2.status === 404, `(${other.email})`);
  const r3 = await fetch(`${BASE}/finance/payments/${paymentId}/receipt`, {
    headers: { Cookie: jars.accounts },
  });
  ok("accounts staff can download", r3.status === 200);

  // ---- 7. Refund request ----
  const req1 = await call("student", "POST", "/finance/refunds", {
    payment: paymentId,
    amount: "900.00",
    reason: "Lab fee charged twice for the same practical session",
  });
  console.log("\n7. REFUND REQUEST");
  ok(
    "created",
    req1.status === 201,
    `${req1.body?.data?.refund?.reference} ₹${req1.body?.data?.refund?.refundAmountFormatted}`
  );
  const stillPaid = await call(
    "accounts",
    "GET",
    `/finance/invoices/${invoice.reference}`
  );
  ok("no money moved yet", stillPaid.body.data.status === "PAID");

  const tooMuch = await call("student", "POST", "/finance/refunds", {
    payment: paymentId,
    amount: "99999.00",
    reason: "Attempting to refund far more than was ever charged",
  });
  ok("over-amount refused", tooMuch.status === 400, `"${tooMuch.body?.message}"`);

  const selfApprove = await call(
    "student",
    "POST",
    `/finance/refunds/${req1.body.data.refund.reference}/approve`,
    {}
  );
  ok("student cannot approve their own refund", selfApprove.status === 403);

  // ---- 8. Partial approval ----
  const appr = await call(
    "accounts",
    "POST",
    `/finance/refunds/${req1.body.data.refund.reference}/approve`,
    {
      note: "Confirmed duplicate with the lab supervisor",
    }
  );
  const afterPartial = await call(
    "accounts",
    "GET",
    `/finance/invoices/${invoice.reference}`
  );
  console.log("\n8. PARTIAL REFUND APPROVED");
  ok(
    "processed",
    appr.body?.data?.refund?.status === "PROCESSED",
    appr.body?.data?.refund?.razorpayRefundId
  );
  ok(
    "invoice stays PAID after a partial refund",
    afterPartial.body.data.status === "PAID"
  );

  const refundable = await call(
    "student",
    "GET",
    `/finance/payments/${paymentId}/refundable`
  );
  ok(
    "remainder is bounded",
    refundable.body.data.refundableAmount === 590000 - 90000,
    refundable.body.data.refundableFormatted
  );

  // ---- 9. Full remainder ----
  const req2 = await call("student", "POST", "/finance/refunds", {
    payment: paymentId,
    reason: "The remainder of the fee is not payable after withdrawal",
  });
  const appr2 = await call(
    "accounts",
    "POST",
    `/finance/refunds/${req2.body.data.refund.reference}/approve`,
    {}
  );
  const afterFull = await call(
    "accounts",
    "GET",
    `/finance/invoices/${invoice.reference}`
  );
  console.log("\n9. FULL REFUND");
  ok("processed", appr2.body?.data?.refund?.status === "PROCESSED");
  ok(
    "invoice reopened",
    afterFull.body.data.status === "ISSUED",
    `balance ${afterFull.body.data.balanceDue} (₹${afterFull.body.data.balanceDueFormatted})`
  );

  const twice = await call(
    "accounts",
    "POST",
    `/finance/refunds/${req1.body.data.refund.reference}/approve`,
    {}
  );
  ok("cannot re-approve the same refund", twice.status === 409);

  const pays = await call("student", "GET", "/finance/payments");
  const settledPayment = pays.body.data.find(
    (p) => String(p._id ?? p.id) === String(paymentId)
  );
  console.log("\n10. LEDGER");
  ok("payment recorded", Boolean(settledPayment));
  ok(
    "captured and refunded recorded",
    (settledPayment?.capturedAmount ?? 0) === 590000 &&
      (settledPayment?.refundedAmount ?? 0) === 590000,
    `captured ${settledPayment?.capturedAmount} / refunded ${settledPayment?.refundedAmount} paise`
  );
  ok(
    "receipt was issued on settlement",
    Boolean(settledPayment?.receiptNumber),
    settledPayment?.receiptNumber
  );
  console.log("");
})().catch((e) => {
  console.error("DRILL FAILED:", e.message);
  process.exit(1);
});
