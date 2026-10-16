import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";

import { apiGet, apiPost, fetchDocument } from "../api/client";
import { formatDate, formatDateTime, formatMoney } from "../lib/format";
import { Card } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import InstalmentPanel from "../components/InstalmentPanel";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";
import PayDialog from "../components/PayDialog";
import { ErrorState } from "../components/ui/States";
import {
  SkeletonHeading,
  SkeletonPanel,
  SkeletonRegion,
} from "../components/ui/Skeleton";

/**
 * One invoice.
 *
 * ## The amount is never taken from this page
 *
 * Paying opens a dialog that asks the server for an order against the invoice
 * and nothing else. There is no amount parameter anywhere in this flow and no
 * total computed in the browser, so there is nothing here to alter.
 *
 * ## Refundable is shown, because it is the number the student needs
 *
 * The remaining refundable amount comes from the server. Asking for more than
 * that is refused there, with the real figure in the message — this page shows
 * the same number so the student is not left guessing.
 */
export default function InvoiceDetail() {
  const { reference } = useParams();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [paying, setPaying] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [actionError, setActionError] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["invoice", reference],
    queryFn: () => apiGet(`/finance/invoices/${reference}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["invoice", reference] });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    queryClient.invalidateQueries({ queryKey: ["payments"] });
  };

  const verify = useMutation({
    mutationFn: (paymentId) => apiPost(`/finance/payments/${paymentId}/verify`),
    onSuccess: invalidate,
    onError: (failure) => setActionError(failure.message),
  });

  const requestRefund = useMutation({
    mutationFn: () =>
      apiPost("/finance/refunds", {
        payment: data.data.paidPayment?._id ?? data.data.latestPayment?._id,
        ...(refundAmount ? { amount: refundAmount } : {}),
        reason: refundReason,
      }),
    onSuccess: () => {
      setRefundAmount("");
      setRefundReason("");
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["refunds"] });
    },
    onError: (failure) => setActionError(failure.message),
  });

  const downloadReceipt = async (paymentId) => {
    try {
      setActionError(null);
      const url = await fetchDocument(`/finance/payments/${paymentId}/receipt`);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (failure) {
      setActionError(failure.message);
    }
  };

  if (isLoading)
    return (
      <SkeletonRegion label="Loading invoice">
        <div className="space-y-6">
          <SkeletonHeading />
          <div className="grid gap-4 sm:grid-cols-2">
            <SkeletonPanel lines={3} />
            <SkeletonPanel lines={3} />
          </div>
          <SkeletonPanel lines={5} />
        </div>
      </SkeletonRegion>
    );
  if (isError) {
    return (
      <ErrorState
        title="Invoice not available"
        message={error?.message}
        onRetry={() => refetch()}
      />
    );
  }

  const invoice = data.data;
  const payments = invoice.payments ?? [];
  /*
   * Hiding the controls is convenience, not authorisation — the API refuses a
   * student regardless. But showing a finance officer a "split into
   * instalments" button that always 403s would be worse than hiding it.
   */
  const canManage = can("invoice:manage:institution");
  const settled = payments.filter((p) => p.status === "PAID");
  const outstanding = invoice.balanceDue ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        to="/finance/invoices"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 dark:text-ink-400 hover:text-ink-800"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All invoices
      </Link>

      <header className="rounded-xl bg-white dark:bg-surface px-6 py-5 shadow-sm ring-1 ring-ink-200/70 dark:ring-ink-600">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-ink-900">
              {invoice.purpose}
            </h1>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
              {invoice.reference}
            </p>
          </div>
          <Badge status={invoice.status} />
        </div>

        <div className="mt-5 grid gap-4 border-t border-ink-100 dark:border-ink-700/50 pt-4 sm:grid-cols-3">
          <Figure
            label="Total"
            value={invoice.totalFormatted ?? formatMoney(invoice.total)}
          />
          <Figure
            label="Paid"
            value={
              invoice.paidAmountFormatted ?? formatMoney(invoice.paidAmount)
            }
            tone="good"
          />
          <Figure
            label="Outstanding"
            value={invoice.balanceDueFormatted ?? formatMoney(outstanding)}
            tone={outstanding > 0 ? "warn" : "good"}
          />
        </div>

        {invoice.dueAt && (
          <p className="mt-4 text-xs text-ink-500 dark:text-ink-400">
            Due {formatDate(invoice.dueAt)}
          </p>
        )}
      </header>

      <Card
        title="Instalments and penalties"
        description="How this can be paid, and what happens if it is late."
      >
        <InstalmentPanel
          invoiceId={invoice.id ?? invoice._id}
          total={invoice.total ?? outstanding}
          paidAmount={invoice.paidAmount ?? 0}
          canManage={canManage}
        />
      </Card>

      {/* ===== Line items, as the server calculated them ===== */}
      {Array.isArray(invoice.items) && invoice.items.length > 0 && (
        <Card title="Items">
          <ul className="divide-y divide-ink-100">
            {invoice.items.map((item, index) => (
              <li
                key={item._id ?? index}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink-800">{item.description}</p>
                  <p className="text-xs text-ink-500 dark:text-ink-400">
                    {item.quantity} ×{" "}
                    {formatMoney(item.unitAmount, { showSymbol: false })}
                    {item.taxPercent > 0 &&
                      ` · ${item.taxPercent}% tax (${formatMoney(item.taxAmount, { showSymbol: false })})`}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-medium tabular-nums text-ink-900">
                  {formatMoney(item.amount)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ===== Payments ===== */}
      {payments.length > 0 && (
        <Card title="Payments" description="Recorded against this invoice.">
          <ul className="divide-y divide-ink-100">
            {payments.map((payment) => (
              <li
                key={payment._id}
                className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">
                    {formatMoney(payment.capturedAmount ?? payment.amount)}
                    {payment.refundedAmount > 0 && (
                      <span className="ml-2 text-xs font-normal text-ink-500 dark:text-ink-400">
                        {formatMoney(payment.refundedAmount)} refunded
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                    {payment.verifiedAt
                      ? `Confirmed ${formatDateTime(payment.verifiedAt)}`
                      : "Awaiting confirmation"}
                    {payment.mode && ` · ${payment.mode}`}
                  </p>
                </div>

                <Badge status={payment.status} />

                {/* Confirming is a server-side check with Razorpay, not a
                    client-side assumption that paying worked. */}
                {payment.status === "ATTEMPTED" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={verify.isPending}
                    onClick={() => verify.mutate(payment._id)}
                  >
                    Check with Razorpay
                  </Button>
                )}

                {payment.receiptNumber && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => downloadReceipt(payment._id)}
                  >
                    <Download className="size-3.5" aria-hidden="true" />
                    Receipt
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {actionError && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          {actionError}
        </p>
      )}

      {outstanding > 0 && (
        <Card title="Pay this invoice">
          <Button onClick={() => setPaying(true)}>Pay securely</Button>
        </Card>
      )}

      {/* ===== Refund ===== */}
      {settled.length > 0 && (
        <Card
          title="Request a refund"
          description="Accounts staff review it and approve or decline with a reason. Money only moves on approval."
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              requestRefund.mutate();
            }}
            className="space-y-4"
          >
            <Field
              label="Amount"
              htmlFor="refund-amount"
              hint="Leave blank to request everything still refundable."
            >
              <input
                id="refund-amount"
                value={refundAmount}
                onChange={(event) => setRefundAmount(event.target.value)}
                placeholder="e.g. 900.00"
                inputMode="decimal"
                className={inputClass}
              />
            </Field>

            <Field label="Reason" htmlFor="refund-reason" required>
              <textarea
                id="refund-reason"
                rows={3}
                value={refundReason}
                maxLength={1000}
                onChange={(event) => setRefundReason(event.target.value)}
                className={inputClass}
              />
            </Field>

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="secondary"
                loading={requestRefund.isPending}
                disabled={refundReason.trim().length < 10}
              >
                Request refund
              </Button>
            </div>
          </form>
        </Card>
      )}

      {paying && (
        <PayDialog
          invoice={{
            ...invoice,
            balanceDue: outstanding,
            balanceDueFormatted: invoice.balanceDueFormatted,
          }}
          onClose={() => setPaying(false)}
          onVerified={() => {
            setPaying(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function Figure({ label, value, tone = "default" }) {
  const tones = {
    default: "text-ink-900",
    good: "text-emerald-700 dark:text-emerald-300",
    warn: "text-amber-700 dark:text-amber-300",
  };
  return (
    <div>
      <p className="text-xs tracking-wide text-ink-500 dark:text-ink-400 uppercase">
        {label}
      </p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tones[tone]}`}>
        {value}
      </p>
    </div>
  );
}
