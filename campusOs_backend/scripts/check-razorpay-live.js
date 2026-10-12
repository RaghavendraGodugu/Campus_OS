#!/usr/bin/env node
/**
 * Exercise the real Razorpay TEST API.
 *
 *     npm run razorpay:live
 *
 * Creates a genuine test-mode order through the gateway — the same call the
 * student checkout uses — and then reads it back with the SDK directly, as an
 * independent oracle rather than trusting our own gateway's return value.
 *
 * No money moves: Razorpay test mode never takes or refunds real funds. An
 * order is created and left unpaid.
 *
 * What this CANNOT verify, and says so:
 *   - a capture, because that needs a human at Razorpay's hosted checkout
 *   - a webhook, because the project has no public URL to receive one on
 *   - a refund, because a refund needs a captured payment first
 */

const Razorpay = require("razorpay");

const { getGateway } = require("../src/config/razorpay");
const { getEnv } = require("../src/config/env");
const money = require("../src/utils/money");

const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => console.log(`  FAIL  ${m}`);
const warn = (m) => console.log(`  WARN  ${m}`);

(async () => {
  const env = getEnv();
  const gateway = getGateway();

  console.log("\nRazorpay live test-API check\n");

  if (gateway.isMock) {
    warn("No Razorpay credentials configured — the mock gateway is in use.");
    console.log("       Add rzp_test_ keys to .env and re-run.");
    process.exit(1);
  }

  if (gateway.mode === "LIVE") {
    warn(
      "The configured key is a LIVE key. Stopping rather than creating orders on a live account."
    );
    process.exit(1);
  }

  pass(`test-mode credentials accepted (key ${mask(env.RAZORPAY_KEY_ID)})`);

  // ===== 1. Create a real order through the production gateway path =====
  const amount = 590000; // Rs.5,900.00 in paise
  const receipt = `LIVE-CHECK-${Date.now().toString(36).toUpperCase()}`;

  const order = await gateway.createOrder({
    amount,
    currency: "INR",
    receipt,
    notes: { purpose: "CampusOS connectivity check" },
  });

  if (!order.orderId) {
    fail("createOrder returned no order id");
    process.exit(1);
  }
  pass(`created a real Razorpay order ${order.orderId}`);

  // ===== 2. Read it back independently =====
  // Deliberately NOT via the gateway: this is an oracle. If the gateway
  // mangled the amount on the way out, only Razorpay's own record shows it.
  const client = new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });

  const fetched = await client.orders.fetch(order.orderId);

  pass("read the order back from Razorpay's API");

  // ===== 3. Prove no minor-unit confusion =====
  // The single most damaging mistake available here is sending rupees where
  // paise are expected — a Rs.5,900 charge would become Rs.59.
  const storedAmount = Number(fetched.amount);

  if (storedAmount === amount) {
    pass(
      `amount stored exactly as sent: ${storedAmount} paise (${money.format(storedAmount)})`
    );
  } else {
    fail(`amount mismatch: sent ${amount} paise, Razorpay stored ${storedAmount}`);
  }

  if (fetched.currency === "INR") {
    pass("currency stored as INR");
  } else {
    fail(`currency mismatch: expected INR, Razorpay stored ${fetched.currency}`);
  }

  if (fetched.receipt === receipt) {
    pass("receipt echoed back intact");
  } else {
    fail(`receipt mismatch: sent ${receipt}, got ${fetched.receipt}`);
  }

  // ===== 4. The cross-check the verification path depends on =====
  // A payment is only credited if Razorpay reports it against the order we
  // created. Confirm the two halves of that agree before relying on it.
  if (fetched.id === order.orderId && fetched.status === "created") {
    pass(`order is live and awaiting payment (status "${fetched.status}")`);
  } else {
    warn(`unexpected order state: id=${fetched.id} status=${fetched.status}`);
  }

  // ===== 5. Prove a real payment id is rejected, not invented =====
  try {
    await gateway.fetchPayment("pay_thisDoesNotExistOnRazorpay");
    fail("a nonexistent payment id was accepted — verification would trust anything");
  } catch (error) {
    const description = error?.error?.description ?? error?.description ?? "";
    if (/does not exist|not found/i.test(description)) {
      pass(`an invented payment id is rejected by Razorpay ("${description}")`);
    } else {
      warn(`unexpected rejection: ${description || JSON.stringify(error).slice(0, 120)}`);
    }
  }

  // ===== What this does not cover =====
  console.log("\n  Not verified by this check:");
  console.log("    - capture, and the receipt it issues");
  console.log("    - webhook signature verification (no public URL to receive one)");
  console.log("    - a real refund through payments.refund()");
  console.log("");
  console.log("  The order above is left unpaid and expires on its own.");
  console.log("  To finish the lifecycle, pay it at:");
  console.log(`    https://rzp.io/l/${order.orderId}`);
  console.log("  then run POST /api/v1/finance/payments/:id/verify");
  console.log("");
})().catch((error) => {
  const description = error?.error?.description ?? error?.description ?? error?.message;
  fail(`unexpected failure: ${description ?? JSON.stringify(error).slice(0, 200)}`);
  process.exit(1);
});

function mask(value) {
  return value.length <= 10 ? "********" : `${value.slice(0, 8)}...${value.slice(-4)}`;
}
