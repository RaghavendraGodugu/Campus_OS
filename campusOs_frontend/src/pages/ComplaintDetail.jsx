import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert } from "lucide-react";

import { apiGet, apiPost } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDateTime, humanise } from "../lib/format";
import { Card } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";
import TransitionPanel from "../components/TransitionPanel";
import { ErrorState } from "../components/ui/States";
import {
  SkeletonHeading,
  SkeletonPanel,
  SkeletonRegion,
} from "../components/ui/Skeleton";

/**
 * One complaint.
 *
 * ## The body is on this page, and only here
 *
 * A grievance is readable only by the roles permitted to handle it, and the
 * server decides that. There is no list anywhere that renders the text — a
 * subject line is a category, and a body is the grievance itself.
 *
 * The confidentiality banner is not reassurance. Someone who filed a complaint
 * about a colleague is entitled to be told, here, exactly who can read what they
 * wrote.
 */
export default function ComplaintDetail() {
  const { reference } = useParams();
  const { can, canAny } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["complaint", reference],
    queryFn: () => apiGet(`/complaints/${reference}`),
  });

  const complaint = data?.data;

  // Feedback is the student's own, and only after resolution.
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const feedback = useMutation({
    mutationFn: () =>
      apiPost(`/complaints/${reference}/feedback`, { rating, comment }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["complaint", reference] }),
  });

  if (isLoading)
    return (
      <SkeletonRegion label="Loading complaint">
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
        title="Complaint not available"
        message={error?.message}
        onRetry={() => refetch()}
      />
    );
  }

  const backTo = canAny("complaint:read:assigned", "complaint:read:institution")
    ? "/management/complaints"
    : "/complaints";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All complaints
      </Link>

      <div className="flex items-start gap-3 rounded-xl bg-brand-50 dark:bg-brand-500/15 px-4 py-3 ring-1 ring-brand-200 dark:ring-brand-400/25">
        <ShieldAlert
          className="mt-0.5 size-4 shrink-0 text-brand-700 dark:text-brand-300"
          aria-hidden="true"
        />
        <p className="text-xs text-brand-900 dark:text-brand-100">
          {complaint.confidential
            ? "Strictly confidential. Visible only to the Dean and Principal."
            : "Confidential. Visible only to the officers handling grievances."}{" "}
          What you wrote here is never copied into notifications or the audit
          trail.
        </p>
      </div>

      <header className="rounded-xl bg-white dark:bg-surface px-6 py-5 shadow-sm ring-1 ring-ink-200/70 dark:ring-ink-600">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-100">
              {complaint.subject}
            </h1>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
              {complaint.reference} ·{" "}
              {String(complaint.category ?? "")
                .replace(/_/g, " ")
                .toLowerCase()}
            </p>
          </div>
          <Badge status={complaint.status} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-ink-100 dark:border-ink-700/50 pt-4 sm:grid-cols-4">
          <Detail label="Filed" value={formatDateTime(complaint.submittedAt)} />
          <Detail label="Respond by" value={formatDateTime(complaint.dueAt)} />
          <Detail
            label="Assigned to"
            value={complaint.assignedTo?.fullName ?? "Unassigned"}
          />
          <Detail label="Priority" value={humanise(complaint.priority)} />
        </dl>

        {complaint.escalationLevel > 0 && (
          <p className="mt-4 rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-800 dark:text-red-200">
            Escalated to level {complaint.escalationLevel}
            {complaint.slaBreachMinutes > 0 &&
              ` — the response deadline passed by ${Math.round(complaint.slaBreachMinutes / 60)} hour(s)`}
          </p>
        )}
      </header>

      <Card title="What was reported">
        {/* Rendered as text, never as markup: nothing here is trusted HTML. */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-700 dark:text-ink-300">
          {complaint.description}
        </p>
      </Card>

      {(complaint.updates ?? []).length > 0 && (
        <Card title="Updates" description="Given to the person who raised it.">
          <ul className="space-y-3">
            {complaint.updates.map((update) => (
              <li
                key={update._id}
                className="border-l-2 border-brand-200 dark:border-brand-400/25 pl-3"
              >
                <p className="text-sm text-ink-700 dark:text-ink-300">
                  {update.body}
                </p>
                <p className="mt-0.5 text-xs text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500">
                  {formatDateTime(update.at)} · {humanise(update.authorRole)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <TransitionPanel
        endpoint="/complaints"
        record={complaint}
        transitions={complaint.availableTransitions}
        onDone={() =>
          queryClient.invalidateQueries({ queryKey: ["complaint", reference] })
        }
        emptyNote="No workflow actions are available to you here."
      />

      {can("complaint:update:assigned") && (
        <InternalNote
          reference={reference}
          onDone={() =>
            queryClient.invalidateQueries({
              queryKey: ["complaint", reference],
            })
          }
        />
      )}

      {can("complaint:feedback:own") &&
        complaint.status === "RESOLVED" &&
        !complaint.feedback?.at && (
          <Card
            title="How was this handled?"
            description="Only you and the officers see this."
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                feedback.mutate();
              }}
              className="space-y-4"
            >
              <Field label="Rating" htmlFor="rating" required>
                <select
                  id="rating"
                  value={rating}
                  onChange={(event) => setRating(Number(event.target.value))}
                  className={inputClass}
                >
                  {[5, 4, 3, 2, 1].map((value) => (
                    <option key={value} value={value}>
                      {value} —{" "}
                      {
                        ["", "Poor", "Fair", "Good", "Very good", "Excellent"][
                          value
                        ]
                      }
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Anything to add" htmlFor="feedback-comment">
                <textarea
                  id="feedback-comment"
                  rows={3}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  className={inputClass}
                />
              </Field>

              <div className="flex justify-end">
                <Button type="submit" size="sm" loading={feedback.isPending}>
                  Send feedback
                </Button>
              </div>
            </form>
          </Card>
        )}
    </div>
  );
}

/** A staff-only note. Never shown to the student, never notified. */
function InternalNote({ reference, onDone }) {
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: () =>
      apiPost(`/complaints/${reference}/internal-notes`, { body: note }),
    onSuccess: () => {
      setNote("");
      onDone?.();
    },
  });

  return (
    <Card
      title="Internal note"
      description="Staff only. Never shown to the student."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (note.trim()) save.mutate();
        }}
        className="space-y-3"
      >
        <Field label="" htmlFor="complaint-note">
          <textarea
            id="complaint-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
            placeholder="Context for whoever picks this up…"
          />
        </Field>
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            loading={save.isPending}
            disabled={!note.trim()}
          >
            Save note
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-ink-500 dark:text-ink-400 uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink-800 dark:text-ink-200">
        {value ?? "—"}
      </dd>
    </div>
  );
}
