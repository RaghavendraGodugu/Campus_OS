import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Paperclip } from "lucide-react";

import { apiGet, fetchDocument } from "../api/client";
import { formatDateTime, humanise } from "../lib/format";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import { ErrorState, Loading } from "../components/ui/States";

/**
 * One announcement.
 *
 * A 404 here means either that it does not exist or that it was not addressed to
 * this reader. The two are deliberately indistinguishable, so this page does not
 * speculate about which it was.
 */
export default function AnnouncementDetail() {
  const { reference } = useParams();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["announcement", reference],
    queryFn: () => apiGet(`/announcements/${reference}`),
  });

  const download = async () => {
    // A blob keeps a private document inside the app, so an authorisation
    // failure surfaces as a message rather than a blank tab.
    const url = await fetchDocument(`/announcements/${reference}/attachment`);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (isLoading) return <Loading label="Loading announcement" />;
  if (isError)
    return (
      <ErrorState
        title="Announcement not available"
        message={error?.message}
        onRetry={() => refetch()}
      />
    );

  const announcement = data.data;

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <Link
        to="/announcements"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 dark:text-ink-400 hover:text-ink-800"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All announcements
      </Link>

      <header className="rounded-xl bg-white dark:bg-surface px-6 py-5 shadow-sm ring-1 ring-ink-200/70 dark:ring-ink-600">
        <div className="flex flex-wrap items-center gap-2">
          <Badge status={announcement.priority} />
          <span className="text-xs text-ink-400 dark:text-ink-500">
            {announcement.reference} · {humanise(announcement.audience?.scope)}
          </span>
        </div>

        <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink-900">
          {announcement.title}
        </h1>

        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          Published {formatDateTime(announcement.publishedAt)}
          {announcement.expiresAt &&
            ` · expires ${formatDateTime(announcement.expiresAt)}`}
          {announcement.author?.fullName &&
            ` · ${announcement.author.fullName}`}
        </p>
      </header>

      <div className="rounded-xl bg-white dark:bg-surface px-6 py-5 shadow-sm ring-1 ring-ink-200/70 dark:ring-ink-600">
        <div className="space-y-4 text-sm leading-relaxed whitespace-pre-wrap text-ink-700">
          {announcement.body}
        </div>

        {announcement.hasAttachment && (
          <div className="mt-6 border-t border-ink-100 dark:border-ink-700/50 pt-4">
            <Button variant="secondary" onClick={download}>
              <Paperclip className="size-4" aria-hidden="true" />
              Download attachment
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
