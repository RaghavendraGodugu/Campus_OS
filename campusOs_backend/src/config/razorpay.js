/**
 * Razorpay gateway.
 *
 * ## Why an interface
 *
 * Razorpay credentials are not available during development, and the payment
 * logic that matters — signature verification, idempotency, invoice settlement —
 * is the same whether the money moves on a sandbox or in production. Splitting
 * the *transport* from the *logic* means the real code paths are exercised in
 * tests rather than mocked out of existence.
 *
 * ## Signature verification lives here, not in the service
 *
 * Both Razorpay signature schemes are HMAC-SHA256 and are implemented once, here,
 * so a call site cannot accidentally verify with the wrong secret or the wrong
 * payload order:
 *
 *  - Payment: `HMAC(order_id + "|" + razorpay_payment_id, KEY_SECRET)`
 *  - Webhook: `HMAC(raw_body, WEBHOOK_SECRET)`
 *
 * Both are verified with `timingSafeEqual`.
 *
 * ## The mock cannot run in production
 *
 * `getGateway()` throws if the mock would be selected while `NODE_ENV` is
 * production. A misconfigured deployment therefore fails at the first payment
 * attempt with a clear message, rather than silently marking invoices paid
 * without any money changing hands.
 */

const crypto = require("crypto");

const { getEnv } = require("./env");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { logger } = require("./logger");

/** Constant-time string comparison that tolerates length mismatch. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify a checkout signature returned by the browser.
 *
 * This is a *defence in depth* check, not the source of truth: the spec (§12)
 * says an invoice must never be marked paid from a browser callback. The
 * signature proves the response came from Razorpay; the webhook proves the
 * money actually settled.
 *
 * @param {object} params
 * @param {string} params.orderId         Our order id (`order_...`).
 * @param {string} params.razorpayPaymentId
 * @param {string} params.razorpaySignature
 * @param {string} params.keySecret
 * @returns {boolean}
 */
function verifyPaymentSignature({
  orderId,
  razorpayPaymentId,
  razorpaySignature,
  keySecret,
}) {
  if (!orderId || !razorpayPaymentId || !razorpaySignature || !keySecret) return false;

  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${razorpayPaymentId}`)
    .digest("hex");

  return safeEqual(expected, razorpaySignature);
}

/**
 * Verify a webhook signature over the RAW request body.
 *
 * The raw bytes are essential: re-serialising parsed JSON can change key order
 * or spacing, and the signature would then never match — or, worse, a naive
 * implementation that re-signs the parsed object would accept a body it had
 * itself reformatted.
 *
 * @param {Buffer|string} rawBody    Exact bytes received.
 * @param {string} signature         `x-razorpay-signature` header.
 * @param {string} webhookSecret
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature, webhookSecret) {
  if (!rawBody || !signature || !webhookSecret) return false;

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  return safeEqual(expected, signature);
}

/** Sign a body the way Razorpay would — used only by the mock and by tests. */
function signWebhookPayload(rawBody, webhookSecret) {
  return crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
}

/** Sign a checkout the way Razorpay would — mock and tests only. */
function signPayment({ orderId, paymentId }, keySecret) {
  return crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

/**
 * Real Razorpay transport.
 *
 * The SDK is required lazily so a development install without the dependency
 * still boots, and so the key secret is never loaded into a module that an
 * import graph could reach accidentally.
 */
class RazorpayGateway {
  constructor() {
    const env = getEnv();
    this.name = "razorpay";
    this.keyId = env.RAZORPAY_KEY_ID;
    this.keySecret = env.RAZORPAY_KEY_SECRET;
    this.webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
  }

  get client() {
    const Razorpay = require("razorpay");
    if (!this._client) {
      this._client = new Razorpay({ key_id: this.keyId, key_secret: this.keySecret });
    }
    return this._client;
  }

  /**
   * Create an order.
   *
   * `amount` is already in the smallest currency unit, which is exactly what
   * Razorpay expects, so no conversion happens here or anywhere downstream.
   *
   * @param {object} params
   * @param {number} params.amount   Minor units (paise).
   * @param {string} params.currency
   * @param {string} params.receipt  Our invoice reference.
   * @param {object} [params.notes]
   */
  async createOrder({ amount, currency = "INR", receipt, notes }) {
    const order = await this.client.orders.create({
      amount,
      currency,
      receipt,
      notes: { ...notes, receipt },
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
    };
  }

  async fetchPayment(paymentId) {
    const payment = await this.client.payments.fetch(paymentId);
    return {
      id: payment.id,
      orderId: payment.order_id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      email: payment.email,
      contact: payment.contact,
      captured: payment.captured === true,
      errorCode: payment.error_code ?? null,
      errorDescription: payment.error_description ?? null,
      createdAt: payment.created_at,
    };
  }

  async refundPayment({ paymentId, amount, reason, notes }) {
    const refund = await this.client.refunds.create({
      payment_id: paymentId,
      // A full refund omits `amount`; Razorpay then refunds everything.
      ...(amount ? { amount } : {}),
      speed: "normal",
      notes: { ...notes, reason },
    });

    return {
      id: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      status: refund.status,
      reason: reason ?? null,
    };
  }

  async fetchRefund(refundId) {
    const refund = await this.client.refunds.fetch(refundId);
    return {
      id: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      status: refund.status,
    };
  }

  /** Publishable key, safe to send to the browser. The secret never is. */
  get publishableKey() {
    return this.keyId;
  }

  get isMock() {
    return false;
  }
}

/**
 * Local mock gateway.
 *
 * Reproduces Razorpay's shapes closely enough that the real verification and
 * idempotency code runs unchanged: ids have the `order_`/`pay_` prefixes, and
 * signatures are genuine HMACs over the same payload strings.
 *
 * `MOCK_PAYMENT_OUTCOME` (set by tests or the developer) decides whether a
 * payment succeeds or fails, which is how the failure paths are exercised
 * without a live gateway.
 */
class MockRazorpayGateway {
  constructor() {
    this.name = "mock";
    this.keyId = "rzp_test_MOCKKEY";
    this.keySecret = "mock_key_secret_not_usable_in_production";
    this.webhookSecret = "mock_webhook_secret_not_usable_in_production";
    this._counter = 0;
  }

  nextId(prefix) {
    this._counter += 1;
    return `${prefix}_mock${String(this._counter).padStart(12, "0")}`;
  }

  async createOrder({ amount, currency = "INR", receipt, notes }) {
    return {
      orderId: this.nextId("order"),
      amount,
      currency,
      status: "created",
      receipt,
      notes,
    };
  }

  async fetchPayment(paymentId) {
    const outcome = process.env.MOCK_PAYMENT_OUTCOME ?? "captured";
    const captured = outcome === "captured";

    return {
      id: paymentId,
      orderId: `order_from_${paymentId}`,
      amount: Number(process.env.MOCK_PAYMENT_AMOUNT ?? 0),
      currency: "INR",
      status: captured ? "captured" : "failed",
      method: "upi",
      email: "mock@campusos.local",
      contact: "+910000000000",
      captured,
      errorCode: captured ? null : "BAD_REQUEST_ERROR",
      errorDescription: captured
        ? null
        : "Mock failure configured by MOCK_PAYMENT_OUTCOME",
      createdAt: Math.floor(Date.now() / 1000),
    };
  }

  async refundPayment({ paymentId, amount, reason }) {
    return {
      id: this.nextId("rfnd"),
      paymentId,
      amount: amount ?? 0,
      status: "processed",
      reason: reason ?? null,
    };
  }

  async fetchRefund(refundId) {
    return { id: refundId, paymentId: "pay_mock", amount: 0, status: "processed" };
  }

  get publishableKey() {
    return this.keyId;
  }

  get isMock() {
    return true;
  }
}

let cachedGateway = null;

/**
 * Resolve the gateway for this environment.
 *
 * @returns {RazorpayGateway|MockRazorpayGateway}
 * @throws When the mock would be selected in production.
 */
function getGateway() {
  if (cachedGateway) return cachedGateway;

  const env = getEnv();
  const configured = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

  if (configured) {
    cachedGateway = new RazorpayGateway();
    return cachedGateway;
  }

  if (env.NODE_ENV === "production") {
    // config/env.js already rejects production without these; this is the
    // belt-and-braces check for the case where they are present but blank.
    throw new ApiError(
      ERROR_CODE.INTEGRATION_ERROR,
      "Razorpay credentials are required in production. The mock gateway cannot process real payments."
    );
  }

  logger.warn(
    { keyId: env.RAZORPAY_KEY_ID ?? null },
    "Razorpay credentials not configured — using the MOCK gateway. " +
      "No real money moves. This must never happen in production."
  );

  cachedGateway = new MockRazorpayGateway();
  return cachedGateway;
}

/** Reset the cached gateway. Tests only. */
function resetGateway() {
  cachedGateway = null;
}

module.exports = {
  getGateway,
  resetGateway,
  verifyPaymentSignature,
  verifyWebhookSignature,
  signWebhookPayload,
  signPayment,
  safeEqual,
  RazorpayGateway,
  MockRazorpayGateway,
};
