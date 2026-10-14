import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Receipt } from "lucide-react";

import { apiGet } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatMoney } from "../lib/format";
import { Card } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Pagination from "../components/ui/Pagination";
import { EmptyState, ErrorState } from "../components/ui/States";
import { SkeletonList, SkeletonRegion } from "../components/ui/Skeleton";
import PayDialog from "../components/PayDialog";

/**
 * A student's invoices.
 *
 * ## The amount on screen is the server's
 *
 * `totalFormatted` is sent by the server, which computed it from integer paise.
 * The `formatMoney` fallback exists for figures that arrive bare, but money is
 * never re-derived here from anything the browser holds.
 *
 * ## Paying does not mean it is paid
 *
 * `createOrder` takes an invoice, never an amount, and the invoice only reaches
 * PAID when Razorpay confirms. This page shows what actually happened rather
 * than assuming the checkout worked — which is why it polls for the outcome
 * instead of showing a success screen on the client's word.
 */
export default function Invoices() {
  const [page, setPage] = useState(1);
  const [paying, setPaying] = useState(null);
  const queryClient = useQueryClient();
  const { permissions } = useAuth();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["invoices", page],
    queryFn: () => apiGet(`/finance/invoices?page=${page}&limit=20`),
  });

  const items = data?.data ?? [];
  const canPay = permissions.includes("payment:create:own");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Invoices
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Fees raised against your account.
        </p>
      </header>

      {isLoading && (
        <SkeletonRegion label="Loading invoices">
          <SkeletonList rows={6} />
        </SkeletonRegion>
      )}
      {isError && (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={Receipt}
          title="No invoices"
          description="You have nothing to pay right now."
        />
      )}

      {items.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-ink-100">
            {items.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center gap-4 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">
                    {invoice.purpose}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                    {invoice.reference}
                    {invoice.dueAt && ` · due ${formatDate(invoice.dueAt)}`}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-ink-900">
                    {invoice.totalFormatted ?? formatMoney(invoice.total)}
                  </p>
                  {invoice.balanceDue > 0 &&
                    invoice.balanceDue !== invoice.total && (
                      <p className="text-xs text-ink-500 dark:text-ink-400">
                        {invoice.balanceDueFormatted ??
                          formatMoney(invoice.balanceDue)}{" "}
                        due
                      </p>
                    )}
                </div>

                <Badge status={invoice.status} />

                {invoice.status !== "PAID" && canPay && (
                  <Button size="sm" onClick={() => setPaying(invoice)}>
                    Pay now
                  </Button>
                )}
              </li>
            ))}
          </ul>

          {data?.meta && (
            <Pagination
              page={page}
              limit={data.meta.limit}
              total={data.meta.total}
              onPage={setPage}
            />
          )}
        </Card>
      )}

      {paying && (
        <PayDialog
          invoice={paying}
          onClose={() => setPaying(null)}
          onVerified={() => {
            setPaying(null);
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
          }}
        />
      )}

      <p className="text-xs text-ink-400 dark:text-ink-500">
        A receipt is issued automatically once Razorpay confirms a payment.
      </p>
    </div>
  );
}
