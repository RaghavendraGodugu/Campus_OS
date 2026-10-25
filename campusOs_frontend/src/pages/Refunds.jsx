import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";

import { apiGet } from "../api/client";
import { formatDateTime } from "../lib/format";
import { Card } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Pagination from "../components/ui/Pagination";
import { EmptyState, ErrorState } from "../components/ui/States";
import { SkeletonList, SkeletonRegion } from "../components/ui/Skeleton";

/**
 * Refunds.
 *
 * ## Three steps, and this page shows all of them
 *
 * A refund is requested by the student, then decided by accounts staff, and only
 * then executed. So the list shows the request and its decision separately —
 * "pending" here does not mean the money is moving, and a request that has been
 * declined says why.
 *
 * Raising a request is on the invoice page, beside the payment it concerns.
 */
export default function Refunds() {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["refunds", page],
    queryFn: () => apiGet(`/finance/refunds?page=${page}&limit=20`),
  });

  const items = data?.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
          Refunds
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
          Refunds you have asked for, and what happened to them.
        </p>
      </header>

      {isLoading && (
        <SkeletonRegion label="Loading refunds">
          <SkeletonList rows={6} />
        </SkeletonRegion>
      )}
      {isError && (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={Undo2}
          title="No refunds"
          description="If you have paid for something you did not need, open the invoice it relates to and request a refund there."
        />
      )}

      {items.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-ink-100">
            {items.map((refund) => (
              <li key={refund.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                      {refund.refundAmountFormatted ?? refund.refundAmount}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
                      {refund.reference} · requested{" "}
                      {formatDateTime(refund.requestedAt ?? refund.createdAt)}
                    </p>
                  </div>
                  <Badge status={refund.status} />
                </div>

                <p className="mt-2 text-sm text-ink-600 dark:text-ink-400 dark:text-ink-500">{refund.reason}</p>

                {refund.rejectionReason && (
                  <p className="mt-2 rounded-lg bg-ink-50 dark:bg-ink-100/40 px-3 py-2 text-xs text-ink-600 dark:text-ink-400 dark:text-ink-500">
                    <span className="font-medium">Declined:</span>{" "}
                    {refund.rejectionReason}
                  </p>
                )}

                {refund.approvalNote && refund.status !== "REJECTED" && (
                  <p className="mt-2 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
                    {refund.approvalNote}
                  </p>
                )}

                {refund.razorpayRefundId && (
                  <p className="mt-2 text-[11px] text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500">
                    Provider reference {refund.razorpayRefundId}
                  </p>
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

      <ol className="rounded-xl bg-white dark:bg-surface px-5 py-4 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500 shadow-sm ring-1 ring-ink-200/70 dark:ring-ink-600">
        <li className="flex gap-2">
          <span className="font-semibold text-ink-700 dark:text-ink-300">1.</span> You ask for a
          refund on an invoice.
        </li>
        <li className="mt-1.5 flex gap-2">
          <span className="font-semibold text-ink-700 dark:text-ink-300">2.</span> Accounts staff
          review it and approve or decline, with a reason.
        </li>
        <li className="mt-1.5 flex gap-2">
          <span className="font-semibold text-ink-700 dark:text-ink-300">3.</span> Only then is
          Razorpay asked to return the money.
        </li>
      </ol>
    </div>
  );
}
