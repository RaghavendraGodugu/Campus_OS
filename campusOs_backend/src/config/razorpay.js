/**
 * Razorpay gateway.
 *
 * ## Why an interface
 *
 * Razorpay credentials are not available during development, and the payment
 * logic that matters — payment verification, idempotency, invoice settlement —
 * is the same whether the money moves on a sandbox or in production. Splitting
 * the *transport* from the *logic* means the real code paths are exercised in
 * tests rather than mocked out of existence.
 *
 * ## Payment signature verification lives here, not in the service
 *
 * The checkout signature is HMAC-SHA256 over
 * `order_id + "|" + razorpay_payment_id`, verified with `timingSafeEqual`.
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
 * signature proves the response came from Razorpay; settlement is confirmed by
 * an authenticated lookup against Razorpay's API.
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
/**
 * Whether a Razorpay key is live or test.
 *
 * Razorpay prefixes live keys with `rzp_live_` and test keys with `rzp_test_`.
 * Deriving the mode from the key means a receipt can state which it is without
 * the operator keeping a second setting in step — and a mismatch between the
 * two is how a test receipt ends up filed as a real one.
 *
 * @param {string} keyId
 * @returns {"LIVE"|"TEST"|"UNKNOWN"}
 */
function paymentModeForKey(keyId) {
  if (typeof keyId !== "string" || keyId.length === 0) return "UNKNOWN";
  if (keyId.startsWith("rzp_live_")) return "LIVE";
  if (keyId.startsWith("rzp_test_")) return "TEST";
  return "UNKNOWN";
}

class RazorpayGateway {
  constructor() {
    const env = getEnv();
    this.name = "razorpay";
    this.keyId = env.RAZORPAY_KEY_ID;
    this.keySecret = env.RAZORPAY_KEY_SECRET;

    // Derived from the key itself, never from a second setting that could
    // drift out of step with it.
    this.mode = paymentModeForKey(this.keyId);
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
    if (!paymentId) {
      throw ApiError.badRequest("A refund requires the gateway payment id");
    }

    // `payments.refund(paymentId, options)` — NOT `refunds.create()`. The SDK
    // exposes no `create` on the refunds namespace; calling it would have thrown
    // a TypeError on every single real refund, while the mock gateway accepted
    // it happily and every test passed.
    const refund = await this.client.payments.refund(paymentId, {
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
 * A payment must be registered with `registerPayment()` before it can be
 * fetched; an unknown id fails exactly as the real gateway fails, which is what
 * makes the verification path testable rather than always succeeding.
 * payment succeeds or fails, which is how the failure paths are exercised
 * without a live gateway.
 */
class MockRazorpayGateway {
  constructor() {
    this.name = "mock";
    this.keyId = "rzp_test_MOCKKEY";
    this.keySecret = "mock_key_secret_not_usable_in_production";
    this.mode = "MOCK";

    /**
     * A per-process prefix, so identifiers stay unique across restarts.
     *
     * A plain in-memory counter resets to 1 whenever the dev server restarts,
     * so the next order would reuse `order_mock000000000001` and collide with
     * a row already in the database — the unique index would then refuse a
     * perfectly legitimate new payment with a duplicate-key error. Randomising
     * the prefix makes that impossible while keeping ids readable and
     * obviously fake.
     */
    this._runId = crypto.randomBytes(4).toString("hex");
    this._counter = 0;
    this._orders = new Map();
    this._payments = new Map();
  }

  nextId(prefix) {
    this._counter += 1;
    return `${prefix}_mock${this._runId}${String(this._counter).padStart(6, "0")}`;
  }

  async createOrder({ amount, currency = "INR", receipt, notes }) {
    const orderId = this.nextId("order");

    this._orders.set(receipt, { orderId, amount, currency });

    return {
      orderId,
      amount,
      currency,
      status: "created",
      receipt,
      notes,
    };
  }

  /**
   * @param {string} paymentId
   * @param {object} [context]
   * @param {string} [context.orderId] The order this payment is expected to
   *   belong to. The real gateway ignores it — Razorpay reports the order
   *   itself — but a mock that invented its own order id would fail the very
   *   cross-check it exists to exercise, making the verification path
   *   impossible to develop against locally.
   */
  /**
   * Register a payment as existing at the gateway.
   *
   * The mock has no hosted checkout page, so a test declares here the payments
   * a student "made". Anything not registered is treated as not found — which is
   * what the real gateway does, and what makes the verification path testable:
   * a payment id that was never registered must fail exactly as it would in
   * production rather than being invented on demand.
   */
  registerPayment(
    paymentId,
    { orderId, amount, status = "captured", method = "upi" } = {}
  ) {
    this._payments.set(paymentId, { orderId, amount, status, method });
    return paymentId;
  }

  async fetchPayment(paymentId, { orderId } = {}) {
    const registered = this._payments.get(paymentId);

    if (!registered) {
      // The shape Razorpay actually uses: a plain object, not an Error, with
      // the description nested under `error`. Code that only reads `.message`
      // sees "[object Object]" and cannot tell an auth failure from a 404.
      throw {
        statusCode: 400,
        error: {
          code: "BAD_REQUEST_ERROR",
          description: "The id provided does not exist",
          source: "internal",
          reason: "input_validation_failed",
        },
      };
    }

    const captured = registered.status === "captured";

    return {
      id: paymentId,
      orderId: registered.orderId ?? orderId,
      amount: registered.amount,
      currency: "INR",
      status: registered.status,
      method: registered.method,
      email: "mock@campusos.local",
      contact: "+910000000000",
      captured,
      errorCode: captured ? null : "BAD_REQUEST_ERROR",
      errorDescription: captured ? null : "Mock failure configured by registerPayment",
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
  paymentModeForKey,
  getGateway,
  resetGateway,
  verifyPaymentSignature,
  signPayment,
  safeEqual,
  RazorpayGateway,
  MockRazorpayGateway,
};
