import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, Plus } from "lucide-react";

import { apiGet } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatRelative } from "../lib/format";
import { Card } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Pagination from "../components/ui/Pagination";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";

/**
 * Complaints.
 *
 * ## Confidentiality is the whole feature
 *
 * A grievance is visible to a deliberately narrow set of roles, and the server
 * decides that. This list shows what it was given and nothing more. In
 * particular it never renders a description in a staff-facing summary: the body
 * of a complaint is not something to put in a list a wider audience can see, and
 * the server's own policy already governs who may read it at all.
 */
export default function Complaints({ mode = "own" }) {
  const [page, setPage] = useState(1);
  const { can } = useAuth();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["complaints", mode, page],
    queryFn: () => apiGet(`/complaints?page=${page}&limit=20`),
  });

  const items = data?.data ?? [];
  const canCreate = can("complaint:create:own");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            {mode === "assigned" ? "Complaints" : "Your complaints"}
          </h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            Confidential. Handled by a small number of staff.
          </p>
        </div>

        {canCreate && (
          <Link
            to="/complaints/new"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus className="size-4" aria-hidden="true" />
            Raise a complaint
          </Link>
        )}
      </header>

      {isLoading && <Loading label="Loading complaints" />}
      {isError && (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={ShieldAlert}
          title="No complaints"
          description="If something is wrong, you can raise it confidentially and track it here."
          action={
            canCreate ? (
              <Link
                to="/complaints/new"
                className="mt-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Raise a complaint
              </Link>
            ) : null
          }
        />
      )}

      {items.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-ink-100">
            {items.map((complaint) => (
              <li key={complaint._id ?? complaint.id}>
                <Link
                  to={`${mode === "own" ? "/complaints" : "/management/complaints"}/${complaint.reference}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-ink-50 dark:hover:bg-ink-200/40"
                >
                  <div className="min-w-0 flex-1">
                    {/* The subject is a category label, not the grievance text. */}
                    <p className="truncate text-sm font-medium text-ink-900">
                      {complaint.subject ?? "Complaint"}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                      {complaint.reference}
                      {complaint.category &&
                        ` · ${complaint.category.replace(/_/g, " ").toLowerCase()}`}
                      {" · "}
                      {formatRelative(
                        complaint.submittedAt ?? complaint.createdAt,
                      )}
                      {complaint.dueAt &&
                        ` · respond by ${formatDate(complaint.dueAt)}`}
                    </p>
                  </div>

                  {complaint.escalationLevel > 0 && (
                    <span className="rounded-full bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-800 dark:text-red-200">
                      Escalated L{complaint.escalationLevel}
                    </span>
                  )}

                  <Badge status={complaint.status} />
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
