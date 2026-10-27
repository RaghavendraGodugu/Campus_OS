/**
 * Real-gateway contract tests.
 *
 * Every other finance test runs against the mock gateway, so nothing here would
 * notice if the real adapter called the Razorpay SDK wrongly. That is not
 * hypothetical: `refundPayment` called `client.refunds.create()`, which does not
 * exist on the SDK. Every mock-based test passed, and the error would have
 * surfaced only on the first real refund — a TypeError, with no money moved and
 * a refund stuck in FAILED.
 *
 * These tests assert the *shape of the call* against a stubbed client, so the
 * real path is exercised without a network call or any credentials.
 */

const { RazorpayGateway, paymentModeForKey } = require("../src/config/razorpay");

/** A gateway wired to test keys, with the SDK client replaced by a spy. */
function gatewayWithStubbedClient(overrides = {}) {
  const gateway = new RazorpayGateway();

  const calls = [];
  const record =
    (name, result) =>
    (...args) => {
      calls.push({ name, args });
      return typeof result === "function" ? result(...args) : Promise.resolve(result);
    };

  // `client` is a lazy getter that builds the SDK instance from the keys. The
  // backing field is what gets injected, so no real SDK object is ever built.
  gateway._client = {
    orders: {
      create: record("orders.create", {
        id: "order_test",
        amount: 100,
        currency: "INR",
        status: "created",
      }),
    },
    payments: {
      fetch: record("payments.fetch", {
        id: "pay_test",
        order_id: "order_test",
        amount: 100,
        currency: "INR",
        status: "captured",
        method: "upi",
        captured: true,
      }),
      refund: record("payments.refund", {
        id: "rfnd_test",
        payment_id: "pay_test",
        amount: 100,
        status: "processed",
      }),
    },
    refunds: {
      // Deliberately no `create`. If the adapter calls it, the test fails with
      // exactly the TypeError production would have produced.
      fetch: record("refunds.fetch", {
        id: "rfnd_test",
        payment_id: "pay_test",
        amount: 100,
        status: "processed",
      }),
    },
  };

  gateway.keyId = overrides.keyId ?? "rzp_test_ABCDEF";
  gateway.keySecret = overrides.keySecret ?? "test_secret";

  return { gateway, calls };
}

describe("real Razorpay gateway — order", () => {
  it("creates an order through the SDK with minor units", async () => {
    const { gateway, calls } = gatewayWithStubbedClient();

    const order = await gateway.createOrder({
      amount: 590000,
      currency: "INR",
      receipt: "INV-2026-000001",
      notes: { invoice: "INV-2026-000001" },
    });

    expect(calls[0].name).toBe("orders.create");
    // Minor units, never a rupee decimal — the single most damaging mistake
    // available to this call site.
    expect(calls[0].args[0].amount).toBe(590000);
    expect(calls[0].args[0].currency).toBe("INR");
    expect(order.orderId).toBe("order_test");
  });

  it("fetches a payment through the SDK", async () => {
    const { gateway, calls } = gatewayWithStubbedClient();

    const payment = await gateway.fetchPayment("pay_test");

    expect(calls[0].name).toBe("payments.fetch");
    expect(calls[0].args[0]).toBe("pay_test");
    expect(payment.captured).toBe(true);
  });
});

describe("real Razorpay gateway — refund", () => {
  /**
   * The regression guard. `refunds.create` does not exist on the SDK; refunds
   * are created by `payments.refund(paymentId, options)`.
   */
  it("refunds through payments.refund, not refunds.create", async () => {
    const { gateway, calls } = gatewayWithStubbedClient();

    const refund = await gateway.refundPayment({
      paymentId: "pay_test",
      amount: 90000,
      reason: "Duplicate charge",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("payments.refund");

    // The payment id is a positional argument, not a field in the options.
    expect(calls[0].args[0]).toBe("pay_test");
    expect(calls[0].args[1].amount).toBe(90000);
    expect(refund.id).toBe("rfnd_test");
  });

  it("omits the amount for a full refund so Razorpay refunds everything", async () => {
    const { gateway, calls } = gatewayWithStubbedClient();

    await gateway.refundPayment({ paymentId: "pay_test", reason: "Full return" });

    // Razorpay treats a present `amount` literally and a missing one as
    // "everything", so including a zero would silently refund nothing.
    expect(calls[0].args[1]).not.toHaveProperty("amount");
  });

  it("refuses a refund with no payment id rather than calling the SDK", async () => {
    const { gateway, calls } = gatewayWithStubbedClient();

    await expect(
      gateway.refundPayment({ amount: 100, reason: "No payment" })
    ).rejects.toThrow(/payment id/i);
    expect(calls).toHaveLength(0);
  });

  it("fetches a refund status through the SDK", async () => {
    const { gateway, calls } = gatewayWithStubbedClient();

    const refund = await gateway.fetchRefund("rfnd_test");

    expect(calls[0].name).toBe("refunds.fetch");
    expect(refund.status).toBe("processed");
  });
});

describe("real Razorpay gateway — key handling", () => {
  it("never exposes the key secret on the publishable key", () => {
    const { gateway } = gatewayWithStubbedClient({ keySecret: "super_secret_value" });

    // The publishable key goes to the browser; the secret must never ride along.
    expect(gateway.publishableKey).toBe("rzp_test_ABCDEF");
    expect(gateway.publishableKey).not.toContain("super_secret_value");
  });

  it("derives the payment mode from the key itself", () => {
    // The mode is what a receipt prints, so it must follow the actual key
    // rather than any setting the operator might forget to change.
    expect(paymentModeForKey("rzp_test_ABCDEF")).toBe("TEST");
    expect(paymentModeForKey("rzp_live_ABCDEF")).toBe("LIVE");

    // Anything unrecognised must not be assumed safe.
    expect(paymentModeForKey("")).toBe("UNKNOWN");
    expect(paymentModeForKey(null)).toBe("UNKNOWN");
    expect(paymentModeForKey("some_other_key")).toBe("UNKNOWN");
  });

  it("is never treated as a mock", () => {
    const { gateway } = gatewayWithStubbedClient();
    expect(gateway.isMock).toBe(false);
  });
});
