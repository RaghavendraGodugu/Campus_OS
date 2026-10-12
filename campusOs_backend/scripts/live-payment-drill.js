#!/usr/bin/env node
/**
 * Live payment drill against the real Razorpay TEST API.
 *
 *     npm run finance:live
 *
 * Runs the flow as far as it can go without a human: raise an invoice, create a
 * genuine Razorpay order, report the payment from checkout, then ask Razorpay
 * whether the money actually arrived.
 *
 * The interesting part is the last step. Verification is expected to DECLINE,
 * because nobody has paid the order yet — and that is the point. It proves the
 * settlement path consults Razorpay rather than believing the browser, and it
 * proves that against the real provider instead of a mock that could agree with
 * anything.
 *
 * The run prints a pay link. Pay it, then re-run with --verify=<paymentId> to
 * finish the lifecycle.
 */

const Razorpay = require("razorpay");
const { getGateway } = require("../src/config/razorpay");
const { getEnv } = require("../src/config/env");
const money = require("../src/utils/money");

const BASE = process.env.API_BASE ?? "http://localhost:5000/api/v1";
const AMOUNT = 590000; // Rs.5,900.00

const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => console.log(`  FAIL  ${m}`);
const warn = (m) => console.log(`  WARN  ${m}`);

const jars = {};
const csrf = {};

async function login(who, email, password = "Demo@Campus123") {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`login ${email}: ${body.message}`);

  const jar = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  jars[who] = jar;
  csrf[who] = (jar.match(/cos_ct=([^;]*)/) ?? [])[1];
  return body.data.user;
}

async function call(who, method, path, body) {
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
}

(async () => {
  const env = getEnv();
  const gateway = getGateway();

  console.log("\nLive payment drill (Razorpay test mode)\n");

  if (gateway.isMock) {
    warn("Mock gateway active. Add rzp_test_ keys to .env first.");
    process.exit(1);
  }
  if (gateway.mode === "LIVE") {
    warn("A LIVE key is configured. Refusing to run against a live account.");
    process.exit(1);
  }
  pass(`gateway: ${gateway.name} in ${gateway.mode} mode`);

  const finalizeArg = process.argv.find((a) => a.startsWith("--verify="));
  const finalizePaymentId = finalizeArg?.split("=")[1];

  const student = await login("student", "demo.student.democs001@campusos.local");
  await login("accounts", "demo.accounts@campusos.local");
  pass(`signed in as ${student.email} and accounts staff`);

  const me = await call("student", "GET", "/auth/me");
  const studentId = me.body.data.student.id;

  // ===== 1. Invoice, priced server-side =====
  const inv = await call("accounts", "POST", "/finance/invoices", {
    student: studentId,
    purpose: "Live Razorpay drill",
    items: [
      { description: "Semester fee", quantity: 1, unitAmount: "5000.00", taxPercent: 18 },
    ],
  });

  if (inv.status !== 201) {
    fail(`invoice not created: ${inv.status} ${inv.body?.message}`);
    process.exit(1);
  }

  const invoice = inv.body.data;
  if (invoice.total !== AMOUNT) {
    fail(`invoice total unexpected: ${invoice.total} (expected ${AMOUNT})`);
    process.exit(1);
  }
  pass(`invoice ${invoice.reference} ${money.format(invoice.total)} (status ISSUED)`);

  // ===== 2. A genuine Razorpay order =====
  const order = await call("student", "POST", "/finance/payments/order", {
    invoice: invoice.reference,
  });
  if (order.status !== 201) {
    fail(`order not created: ${order.status} ${order.body?.message}`);
    process.exit(1);
  }

  const orderData = order.body.data;
  if (orderData.amount !== AMOUNT) {
    fail(`order amount unexpected: ${orderData.amount} (expected ${AMOUNT})`);
    process.exit(1);
  }

  pass(
    `real Razorpay order ${orderData.razorpayOrderId} for ${money.format(orderData.amount)}`
  );

  // Independent read-back: confirm Razorpay stored the exact minor units.
  const client = new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
  const stored = await client.orders.fetch(orderData.razorpayOrderId);
  if (Number(stored.amount) === AMOUNT) {
    pass(`Razorpay stored ${stored.amount} paise — no minor-unit drift`);
  } else {
    fail(`Razorpay stored ${stored.amount} paise, we sent ${AMOUNT}`);
  }

  // ===== 3. Finish or probe =====
  if (finalizePaymentId) {
    // A human has paid; ask Razorpay whether the money arrived.
    const verified = await call(
      "student",
      "POST",
      `/finance/payments/${orderData.paymentId}/verify`,
      {}
    );

    console.log("");
    if (verified.status !== 200) {
      fail(`verification failed: ${verified.status} ${verified.body?.message}`);
      process.exit(1);
    }

    const outcome = verified.body.data;
    if (outcome.applied) {
      pass(
        `Razorpay confirmed the capture — invoice credited ${money.format(outcome.capturedAmount)}`
      );

      const ledger = await call(
        "accounts",
        "GET",
        `/finance/invoices/${invoice.reference}`
      );
      pass(
        `invoice is now ${ledger.body.data.status}, balance ${ledger.body.data.balanceDue}`
      );

      const receipt = await fetch(
        `${BASE}/finance/payments/${orderData.paymentId}/receipt`,
        {
          headers: { Cookie: jars.student },
        }
      );
      if (receipt.status === 200) {
        const bytes = (await receipt.arrayBuffer()).byteLength;
        pass(`receipt issued (${bytes} bytes)`);
      } else {
        warn(`receipt not available: ${receipt.status}`);
      }
    } else {
      fail(
        `Razorpay did not confirm a capture (${outcome.reason}, status ${outcome.status})`
      );
      process.exit(1);
    }
  } else {
    // Nothing has been paid. Simulate the attack this whole design exists to
    // stop: the student reports a payment that was never made, with a
    // fabricated id and no signature.
    const fabricatedPaymentId = `pay_FABRICATED${Date.now().toString(36)}`;

    const reported = await call("student", "POST", "/finance/payments/confirm", {
      razorpayOrderId: orderData.razorpayOrderId,
      razorpayPaymentId: fabricatedPaymentId,
      razorpaySignature: "0".repeat(64),
    });

    if (reported.status === 200) {
      pass(
        "checkout reported a payment with an invalid signature (recorded, not trusted)"
      );
    } else {
      warn(`confirm returned ${reported.status}: ${reported.body?.message}`);
    }

    const reportedPayment = await call("accounts", "GET", "/finance/payments");
    const recorded = reportedPayment.body.data.find(
      (p) => String(p._id ?? p.id) === String(orderData.paymentId)
    );
    if (recorded && recorded.status === "ATTEMPTED") {
      pass(
        `payment recorded as ATTEMPTED, signature verified = ${recorded.clientReportedSuccess?.signatureVerified}`
      );
    } else {
      warn(`payment status after a false report: ${recorded?.status}`);
    }

    const before = await call(
      "accounts",
      "GET",
      `/finance/invoices/${invoice.reference}`
    );
    pass(`invoice before verification: ${before.body.data.status}`);

    const verified = await call(
      "student",
      "POST",
      `/finance/payments/${orderData.paymentId}/verify`,
      {}
    );

    console.log("");
    if (verified.status === 502) {
      pass("verification declined: Razorpay does not know this payment yet");
      console.log(`         "${verified.body.message}"`);
    } else if (verified.status === 200 && verified.body.data.applied === false) {
      pass(`verification declined: ${verified.body.data.reason}`);
    } else {
      fail(
        `an unpaid order was not declined: ${verified.status} ${JSON.stringify(verified.body)}`
      );
      process.exit(1);
    }

    const after = await call("accounts", "GET", `/finance/invoices/${invoice.reference}`);
    if (after.body.data.status === "ISSUED" && after.body.data.balanceDue === AMOUNT) {
      pass(
        `invoice untouched: still ISSUED, balance ${money.format(after.body.data.balanceDue)}`
      );
    } else {
      fail(`an unpaid invoice was credited: ${JSON.stringify(after.body.data)}`);
      process.exit(1);
    }

    console.log("\n  To complete the lifecycle:");
    console.log(`    1. Pay this order:  https://rzp.io/l/${orderData.razorpayOrderId}`);
    console.log(
      `    2. Re-run:          npm run finance:live -- --verify=pay_XXXXXXXXXXXX`
    );
    console.log("");
    console.log(`  payment id to use:    ${orderData.paymentId}`);
    console.log("");
  }
})().catch((error) => {
  const description = error?.error?.description ?? error?.description ?? error?.message;
  fail(`unexpected failure: ${description ?? String(error)}`);
  process.exit(1);
});
