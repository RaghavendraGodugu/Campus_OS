#!/usr/bin/env node
/**
 * Check the configured Razorpay gateway.
 *
 *     npm run razorpay:check
 *
 * Reports which gateway is active and, when real keys are configured, calls the
 * API to confirm they work. It never creates an order and never moves money:
 * the check is a read, so it is safe to run against live keys too.
 *
 * It deliberately reports what it could NOT verify. A green result here means
 * the credentials work — it does not mean webhooks work, which needs a real
 * delivery and a local tunnel.
 */

const { getGateway, paymentModeForKey } = require("../src/config/razorpay");
const { getEnv } = require("../src/config/env");

const pass = (m) => console.log(`  PASS  ${m}`);
const warn = (m) => console.log(`  WARN  ${m}`);
const fail = (m) => console.log(`  FAIL  ${m}`);

(async () => {
  const env = getEnv();
  const gateway = getGateway();

  console.log("\nRazorpay configuration\n");

  console.log(`  environment : ${env.NODE_ENV}`);
  console.log(`  gateway     : ${gateway.name}`);
  console.log(`  mode        : ${gateway.mode ?? "unknown"}`);
  console.log(
    `  key id      : ${env.RAZORPAY_KEY_ID ? mask(env.RAZORPAY_KEY_ID) : "(not set)"}`
  );
  console.log(`  key secret  : ${env.RAZORPAY_KEY_SECRET ? "set" : "(not set)"}`);
  console.log(`  webhook sec : ${env.RAZORPAY_WEBHOOK_SECRET ? "set" : "(NOT SET)"}`);
  console.log("");

  if (gateway.isMock) {
    warn("Mock gateway active — no real API calls are made and no money moves.");
    console.log("");
    console.log("  To use the Razorpay test API:");
    console.log("    1. Dashboard > Settings > API Keys > Test Mode");
    console.log("    2. Put rzp_test_... into RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET");
    console.log("    3. Re-run: npm run razorpay:check");
    console.log("");
    process.exit(0);
  }

  // --- Real credentials configured: prove they authenticate. ---
  pass(`Real gateway active in ${gateway.mode} mode`);

  const expected = paymentModeForKey(env.RAZORPAY_KEY_ID);
  if (expected === gateway.mode) {
    pass(`key prefix confirms ${gateway.mode} mode`);
  } else {
    fail(`key prefix indicates ${expected} but the gateway reports ${gateway.mode}`);
  }

  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    warn("No webhook secret — every incoming webhook will be rejected with 400.");
    console.log(
      "       Create one at Dashboard > Webhooks and set RAZORPAY_WEBHOOK_SECRET."
    );
  } else {
    pass("webhook secret present (deliveries will be signature-verified)");
  }

  // A read against the API: proves the key id and secret authenticate.
  // A read against the API: proves the key id and secret authenticate.
  await probeCredentials(gateway);

  console.log("");
  console.log("  Still unverified until you send a real payment:");
  console.log("    - webhook signature verification against live bytes");
  console.log("    - capture settling an invoice, and duplicates being absorbed");
  console.log("    - a real refund through payments.refund()");
  console.log("");
  console.log("  Run the full lifecycle drill once that is set up:");
  console.log("    npm run finance:drill");
  console.log("");
})().catch((error) => {
  fail(`unexpected: ${error.message}`);
  process.exit(1);
});

/**
 * Confirm the credentials authenticate, using a payment id that cannot exist.
 *
 * Razorpay authenticates the request before it looks the id up, so a
 * "not found" reply is the success signal: the keys were accepted and only the
 * id was refused.
 *
 * The SDK rejects with a plain object — `{ statusCode, error }` — not an Error,
 * so unwrapping it is necessary rather than cosmetic. Unhandled, that object
 * stringifies to "[object Object]" and a genuine auth failure looks like an
 * unexplained crash.
 */
async function probeCredentials(gateway) {
  try {
    await gateway.fetchPayment("pay_nonexistent_probe");
    pass("credentials accepted by the Razorpay API");
    return;
  } catch (error) {
    const description = error?.error?.description ?? error?.description ?? "";
    const code = error?.error?.code ?? "";
    const status = error?.statusCode ?? "";

    if (/api key|authentication|unauthor/i.test(`${description} ${code}`)) {
      fail(
        `credentials rejected by Razorpay (${code || status}) — check the key id and secret`
      );
      return;
    }

    if (/does not exist|not found/i.test(description) || status === 404) {
      // Exactly what a working key produces for a payment that never existed.
      pass("credentials accepted by the Razorpay API");
      return;
    }

    fail(
      `API call failed (${code || status || "?"}): ${description || "no description"}`
    );
  }
}

function mask(value) {
  if (value.length <= 10) return "********";
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}
