import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Pin } from "lucide-react";

import { apiGet } from "../api/client";
import { formatDate } from "../lib/format";
import { Card } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Pagination from "../components/ui/Pagination";
import { EmptyState, ErrorState } from "../components/ui/States";
import { SkeletonList, SkeletonRegion } from "../components/ui/Skeleton";
import { useState } from "react";

/**
 * Announcements.
 *
 * The server has already filtered this list to the reader's audience, so there
 * is nothing to filter here and no way to ask for more. An announcement outside
 * your audience is not merely hidden from this list — it 404s when opened
 * directly, which is asserted on the server.
 */
export default function Announcements() {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["announcements", page],
    queryFn: () => apiGet(`/announcements?page=${page}&limit=20`),
  });

  const items = data?.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Announcements
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Notices addressed to you.
        </p>
      </header>

      {isLoading && (
        <SkeletonRegion label="Loading announcements">
          <SkeletonList rows={6} />
        </SkeletonRegion>
      )}
      {isError && (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={Megaphone}
          title="No announcements"
          description="Notices addressed to your role or department will appear here."
        />
      )}

      {items.length > 0 && (
        <ul className="space-y-3">
          {items.map((announcement) => (
            <li key={announcement.id}>
              <Link
                to={`/announcements/${announcement.reference}`}
                className="block rounded-2xl bg-white dark:bg-surface px-5 py-4 shadow-card ring-1 ring-ink-200/80 dark:ring-ink-600 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-raised hover:ring-brand-200"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {announcement.pinned && (
                    <Pin
                      className="size-3.5 text-ink-400 dark:text-ink-500"
                      aria-label="Pinned"
                    />
                  )}
                  <h2 className="text-sm font-semibold text-ink-900">
                    {announcement.title}
                  </h2>
                  {announcement.priority !== "NORMAL" && (
                    <Badge status={announcement.priority} />
                  )}
                </div>

                <p className="mt-1.5 line-clamp-2 text-sm text-ink-600">
                  {announcement.body}
                </p>

                <p className="mt-2 text-xs text-ink-400 dark:text-ink-500">
                  {announcement.reference} ·{" "}
                  {formatDate(announcement.publishedAt)}
                  {announcement.author?.fullName &&
                    ` · ${announcement.author.fullName}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data?.meta && (
        <Card className="overflow-hidden p-0">
          <div className="-mx-5 -my-4">
            <Pagination
              page={page}
              limit={data.meta.limit}
              total={data.meta.total}
              onPage={setPage}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
