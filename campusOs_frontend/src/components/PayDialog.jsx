import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";

import { apiPost } from "../api/client";
import { formatMoney } from "../lib/format";
import Button from "./ui/Button";

/**
 * Pay an invoice through Razorpay Checkout.
 *
 * ## The amount is never sent from here
 *
 * `createOrder` is called with an invoice reference and nothing else. There is
 * no amount parameter in this file to tamper with, and no total computed in the
 * browser that could be altered in the console. The charge is whatever the
 * server says the outstanding balance is.
 *
 * ## The browser callback settles nothing
 *
 * Razorpay's handler reports the payment to the server, which records it and
 * verifies Razorpay's signature. It does not mark the invoice paid — only a
 * verified webhook does that, and this deployment has no webhook URL, so the
 * dialog then asks the server to check with Razorpay directly.
 *
 * So the flow here is: report, then ask the server to verify. Both are server
 * calls; the browser's own view of whether it succeeded changes nothing.
 *
 * ## The mock gateway is labelled, not hidden
 *
 * With no Razorpay keys the server uses its mock gateway, and the server says
 * so on the order. This dialog shows that plainly rather than opening a checkout
 * that looks real and moves no money.
 */
export default function PayDialog({ invoice, onClose, onVerified }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("starting"); // starting | ready | verifying | done
  const closeRef = useRef(null);

  const queryClient = useQueryClient();

  const createOrder = useMutation({
    mutationFn: () =>
      apiPost("/finance/payments/order", { invoice: invoice.reference }),
  });

  const confirm = useMutation({
    mutationFn: (payload) => apiPost("/finance/payments/confirm", payload),
  });

  const verify = useMutation({
    mutationFn: (paymentId) => apiPost(`/finance/payments/${paymentId}/verify`),
  });

  // Start the order the moment the dialog opens: the amount shown is the one the
  // server has just charged to its ledger, not a figure calculated here.
  useEffect(() => {
    let cancelled = false;

    createOrder.mutate(undefined, {
      onSuccess: (response) => {
        if (cancelled) return;
        setOrder(response.data);
        setPhase("ready");
      },
      onError: (failure) => {
        if (cancelled) return;
        setError(failure.message);
      },
    });

    return () => {
      cancelled = true;
    };
    // Intentionally once per dialog: a new order per open, never on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move focus into the dialog so keyboard users are not left behind it.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /**
   * Open Razorpay's checkout.
   *
   * The script is loaded from Razorpay's CDN, which is the one origin outside
   * this app that the CSP has to permit for payments to work at all. It is only
   * requested when a payment is actually started, not on every page load.
   */
  const openCheckout = async () => {
    if (!order) return;

    setError(null);

    if (order.mode === "MOCK") {
      // No keys configured. Walk the same path with a simulated gateway result
      // so the flow is exercisable locally without pretending money moved.
      setPhase("verifying");
      confirm.mutate(
        {
          razorpayOrderId: order.razorpayOrderId,
          razorpayPaymentId: `pay_MOCK_${order.paymentId}`,
          razorpaySignature: "mock-signature",
        },
        { onSuccess: () => finishVerification(order.paymentId) },
      );
      return;
    }

    try {
      await loadRazorpayScript();
    } catch {
      setError(
        "Could not reach Razorpay's checkout. Check your connection and try again.",
      );
      return;
    }

    const checkout = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: "CampusOS",
      description: invoice.purpose,
      order_id: order.razorpayOrderId,
      handler: async (response) => {
        // Reports to the server. Settles nothing.
        setPhase("verifying");
        confirm.mutate(response, {
          onSuccess: () => finishVerification(order.paymentId),
        });
      },
      modal: {
        ondismiss: () => setPhase("ready"),
      },
    });

    checkout.open();
  };

  /**
   * Ask the server to confirm with Razorpay, then report what it found.
   *
   * The answer is the server's, not ours. A decline is shown as a decline.
   */
  const finishVerification = async (paymentId) => {
    const result = await verify.mutateAsync(paymentId);
    const outcome = result.data;

    if (outcome.applied) {
      setPhase("done");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      onVerified();
      return;
    }

    setPhase("ready");
    setError(
      outcome.reason === "not_yet_captured"
        ? "Razorpay has not confirmed this payment yet. It will appear in your history once it does."
        : outcome.reason === "payment_failed"
          ? "The payment did not go through. Nothing was charged."
          : "This payment is already recorded.",
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pay-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-surface p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="pay-title" className="text-lg font-semibold text-ink-900 dark:text-ink-100">
              Pay {invoice.purpose}
            </h2>
            <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
              {invoice.reference}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-200/50"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 rounded-xl bg-ink-50 dark:bg-ink-100/40 px-4 py-4 text-center">
          <p className="text-xs tracking-wide text-ink-500 dark:text-ink-400 dark:text-ink-500 uppercase">
            Amount due
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900 dark:text-ink-100">
            {invoice.balanceDueFormatted ??
              formatMoney(invoice.balanceDue ?? invoice.total)}
          </p>
        </div>

        {order?.mode === "MOCK" && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/12 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle
              className="mt-0.5 size-3.5 shrink-0"
              aria-hidden="true"
            />
            No Razorpay keys are configured, so this uses the mock gateway. No
            money moves and no receipt is issued.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-700 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Close
          </Button>
          <Button
            className="flex-1"
            onClick={openCheckout}
            loading={phase === "starting" || phase === "verifying"}
            disabled={!order || phase === "done"}
          >
            {phase === "verifying" ? "Confirming…" : "Pay securely"}
          </Button>
        </div>

        {phase === "verifying" && (
          <p className="mt-3 flex items-center justify-center gap-2 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Asking Razorpay whether the money arrived
          </p>
        )}

        {phase === "done" && (
          <p className="mt-3 flex items-center justify-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            Payment confirmed and a receipt issued
          </p>
        )}

        <p className="mt-4 text-center text-[11px] text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500">
          This browser never decides that money was paid. The server checks with
          Razorpay first.
        </p>
      </div>
    </div>
  );
}

/** Load Razorpay's checkout script once, reusing it if already present. */
function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Razorpay checkout failed to load"));
    document.body.appendChild(script);
  });
}
