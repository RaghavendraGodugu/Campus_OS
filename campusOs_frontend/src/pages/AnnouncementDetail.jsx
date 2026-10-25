import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Paperclip } from "lucide-react";

import { apiGet, fetchDocument } from "../api/client";
import { formatDateTime, humanise } from "../lib/format";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import { ErrorState } from "../components/ui/States";
import {
  SkeletonHeading,
  SkeletonPanel,
  SkeletonRegion,
} from "../components/ui/Skeleton";

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

  // The envelope nests the record one level deeper: data.announcement.
  // Reading data.data alone yields an object with no title, no body and no
  // audience — which renders as a blank notice rather than as an error.
  const announcement = data?.data?.announcement;
  const isImage = Boolean(
    announcement?.hasAttachment &&
    announcement?.attachmentMimeType?.startsWith("image/"),
  );

  const download = async () => {
    // A blob keeps a private document inside the app, so an authorisation
    // failure surfaces as a message rather than a blank tab.
    const url = await fetchDocument(`/announcements/${reference}/attachment`);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (isLoading)
    return (
      <SkeletonRegion label="Loading announcement">
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
  if (isError)
    return (
      <ErrorState
        title="Announcement not available"
        message={error?.message}
        onRetry={() => refetch()}
      />
    );

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <Link
        to="/announcements"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All announcements
      </Link>

      <header className="rounded-xl bg-white dark:bg-surface px-6 py-5 shadow-sm ring-1 ring-ink-200/70 dark:ring-ink-600">
        <div className="flex flex-wrap items-center gap-2">
          <Badge status={announcement.priority} />
          <span className="text-xs text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500">
            {announcement.reference} · {humanise(announcement.audience?.scope)}
          </span>
        </div>

        <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
          {announcement.title}
        </h1>

        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
          Published {formatDateTime(announcement.publishedAt)}
          {announcement.expiresAt &&
            ` · expires ${formatDateTime(announcement.expiresAt)}`}
          {announcement.author?.fullName &&
            ` · ${announcement.author.fullName}`}
        </p>
      </header>

      {/*
        Pointed straight at the endpoint rather than at a blob URL.

        The endpoint already authenticates the reader and applies the same
        audience rule as the notice itself, and an <img> on the same origin
        sends the session cookie without help. So there is nothing to fetch,
        nothing to keep, and no object URL to revoke — and blob URLs proved
        genuinely fragile here: under React's development double-mount, a
        cleanup revokes the URL and the remount is handed the same cached,
        now-dead one. The image then fails to decode with no error anywhere.
      */}
      {isImage && (
        <figure className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-ink-200/70 dark:bg-surface dark:ring-ink-600">
          <img
            src={`/api/v1/announcements/${reference}/attachment`}
            alt={`Image attached to the notice "${announcement.title}"`}
            loading="lazy"
            decoding="async"
            className="max-h-[28rem] w-full bg-ink-50 object-cover dark:bg-ink-100/50"
          />
        </figure>
      )}

      <div className="rounded-xl bg-white dark:bg-surface px-6 py-5 shadow-sm ring-1 ring-ink-200/70 dark:ring-ink-600">
        <div className="space-y-4 text-sm leading-relaxed whitespace-pre-wrap text-ink-700 dark:text-ink-300">
          {announcement.body}
        </div>

        {announcement.hasAttachment && !isImage && (
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
