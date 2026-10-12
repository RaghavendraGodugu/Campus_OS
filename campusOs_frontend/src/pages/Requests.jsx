import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";

import { apiGet } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatRelative, humanise } from "../lib/format";
import { Card } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Pagination from "../components/ui/Pagination";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";

const STATUSES = [
  "SUBMITTED",
  "ASSIGNED",
  "UNDER_REVIEW",
  "ACTION_REQUIRED",
  "APPROVAL_PENDING",
  "APPROVED",
  "REJECTED",
  "PROCESSING",
  "COMPLETED",
  "CANCELLED",
  "ESCALATED",
];

/**
 * A list of requests.
 *
 * `mode` decides whose requests these are, and it is read from permissions
 * rather than from a role name: a member of staff reaches this page through
 * /management/requests, where `assignedToMe` is set, and a student reaches it
 * through /requests. Neither is a different component — the server already
 * scopes the query, and passing a filter the user has no permission to use
 * would simply be ignored.
 */
export default function Requests({ mode = "own" }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const { can } = useAuth();

  const query = new URLSearchParams({ page: String(page), limit: "20" });
  if (status) query.set("status", status);
  if (mode === "assigned") query.set("assignedToMe", "true");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["requests", mode, page, status],
    queryFn: () => apiGet(`/requests?${query.toString()}`),
  });

  const items = data?.data ?? [];
  const canCreate = can("request:create:own");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            {mode === "assigned" ? "Assigned to you" : "Your requests"}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {mode === "assigned"
              ? "Work currently with you."
              : "Everything you have raised, and where it has got to."}
          </p>
        </div>

        {canCreate && (
          <Link
            to="/requests/new"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus className="size-4" aria-hidden="true" />
            Raise a request
          </Link>
        )}
      </header>

      {/* Filter. A select rather than a row of pills: eleven statuses is too
          many to show at once, and the list is usually filtered by one. */}
      <div className="flex items-center gap-2">
        <label htmlFor="status-filter" className="text-sm text-ink-600">
          Status
        </label>
        <select
          id="status-filter"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className="rounded-lg border-0 px-3 py-1.5 text-sm shadow-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600"
        >
          <option value="">All</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanise(value)}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <Loading label="Loading requests" />}
      {isError && (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={FileText}
          title={status ? "Nothing with that status" : "Nothing here yet"}
          description={
            status
              ? "Try clearing the filter."
              : mode === "assigned"
                ? "Nothing is currently assigned to you."
                : "Raise a request and you can follow it here at every step."
          }
          action={
            canCreate && !status ? (
              <Link
                to="/requests/new"
                className="mt-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Raise a request
              </Link>
            ) : null
          }
        />
      )}

      {items.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-ink-100">
            {items.map((request) => (
              <li key={request._id ?? request.id}>
                <Link
                  to={`/requests/${request.reference}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-ink-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {request.title}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {request.reference}
                      {request.requestType?.name &&
                        ` · ${request.requestType.name}`}
                      {" · "}
                      {formatRelative(request.createdAt)}
                      {request.dueAt && ` · due ${formatDate(request.dueAt)}`}
                    </p>
                  </div>

                  {request.assignedTo && (
                    <span className="hidden text-xs text-ink-500 sm:inline">
                      {request.assignedTo.fullName}
                    </span>
                  )}

                  <Badge status={request.status} />
                </Link>
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
    </div>
  );
}
