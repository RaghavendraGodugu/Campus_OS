import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, ShieldAlert } from "lucide-react";

import { apiGet } from "../api/client";
import { formatDateTime, humanise } from "../lib/format";
import { Card } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Pagination from "../components/ui/Pagination";
import Button from "../components/ui/Button";
import { EmptyState, ErrorState } from "../components/ui/States";
import { SkeletonList, SkeletonRegion } from "../components/ui/Skeleton";

/**
 * The audit trail.
 *
 * ## The scope banner is not decoration
 *
 * An audit view can be quietly narrowed — to your own actions, to a period, to a
 * filter — and a reader who assumes they are seeing everything would draw false
 * conclusions from an absence. The server states which scope produced this
 * result and the page says so at the top, before the entries.
 *
 * A department-scoped reader is looking at their own actions only, because
 * audit entries carry no department to filter by. The server says exactly that,
 * and this repeats it rather than leaving the reader to infer it.
 */
export default function AuditTrail() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [deniedOnly, setDeniedOnly] = useState(false);

  const params = new URLSearchParams({ page: String(page), limit: "50" });
  if (action) params.set("action", action);

  const path = deniedOnly ? "/audit/denied" : "/audit";

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["audit", deniedOnly, page, action],
    queryFn: () => apiGet(`${path}?${params.toString()}`),
  });

  const items = data?.data ?? [];
  const scope = data?.meta?.scope;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            {deniedOnly ? "Access-denied trail" : "Audit trail"}
          </h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            Every privileged action, who took it and when.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={deniedOnly ? "primary" : "secondary"}
            size="sm"
            onClick={() => {
              setDeniedOnly((value) => !value);
              setPage(1);
            }}
          >
            <ShieldAlert className="size-3.5" aria-hidden="true" />
            Denied access only
          </Button>

          <select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by action"
            className="h-9 rounded-xl border-0 bg-white dark:bg-surface px-3 text-sm text-ink-900 shadow-sm ring-1 ring-ink-200 dark:ring-ink-600 transition-all duration-150 hover:ring-ink-300 focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All actions</option>
            {[
              "LOGIN",
              "LOGIN_FAILED",
              "LOGOUT",
              "CREATE",
              "UPDATE",
              "DELETE",
              "STATUS_TRANSITION",
              "ASSIGNMENT",
              "PAYMENT_VERIFIED",
              "REFUND_PROCESSED",
              "CERTIFICATE_GENERATED",
              "DOCUMENT_DOWNLOADED",
              "ACCESS_DENIED",
              "ANNOUNCEMENT_POSTED",
            ].map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* The scope banner. Stated before the entries, not buried under them. */}
      {scope && scope !== "INSTITUTION" && (
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 dark:bg-amber-500/12 px-4 py-3 ring-1 ring-amber-200 dark:ring-amber-400/25">
          <ShieldAlert
            className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
            aria-hidden="true"
          />
          <div className="text-xs text-amber-900 dark:text-amber-200">
            <p className="font-medium">
              {scope === "DEPARTMENT_OWN_ACTIONS"
                ? "Showing your own actions only"
                : `Scope: ${scope}`}
            </p>
            {data?.meta?.scopeNote && (
              <p className="mt-0.5">{data.meta.scopeNote}</p>
            )}
          </div>
        </div>
      )}

      {isLoading && (
        <SkeletonRegion label="Loading audit entries">
          <SkeletonList rows={6} />
        </SkeletonRegion>
      )}
      {isError && (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={ScrollText}
          title="Nothing recorded"
          description="No entries match this filter for the period covered."
        />
      )}

      {items.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Privileged actions, most recent first. Narrowed to your own
                actions unless you hold institution-wide access.
              </caption>
              <thead>
                <tr className="border-b border-ink-200 dark:border-ink-700/70 bg-ink-50 dark:bg-ink-100/40 text-left">
                  <th
                    scope="col"
                    className="px-5 py-2.5 text-xs font-semibold tracking-wide text-ink-600 uppercase"
                  >
                    When
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-xs font-semibold tracking-wide text-ink-600 uppercase"
                  >
                    Who
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-xs font-semibold tracking-wide text-ink-600 uppercase"
                  >
                    Action
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-xs font-semibold tracking-wide text-ink-600 uppercase"
                  >
                    Resource
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {items.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-5 py-2.5 whitespace-nowrap text-ink-600">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-ink-800">
                        {entry.actor?.fullName ??
                          entry.actor?.email ??
                          "System"}
                      </span>
                      {entry.actor?.deleted && (
                        <span className="ml-1.5 text-xs text-ink-400 dark:text-ink-500">
                          (removed)
                        </span>
                      )}
                      <span className="block text-xs text-ink-500 dark:text-ink-400">
                        {humanise(entry.actor?.role)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        status={
                          entry.action === "ACCESS_DENIED"
                            ? "REJECTED"
                            : entry.action === "LOGIN_FAILED"
                              ? "FAILED"
                              : "APPROVED"
                        }
                      >
                        {humanise(entry.action)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-ink-700">
                      {entry.entity}
                      {entry.entityRef && (
                        <span className="ml-1.5 font-mono text-xs text-ink-500 dark:text-ink-400">
                          {entry.entityRef}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
    </div>
  );
}
