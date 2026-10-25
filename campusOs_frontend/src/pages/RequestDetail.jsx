import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageSquare } from "lucide-react";

import { apiGet, apiPost } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDateTime, humanise } from "../lib/format";
import { Card } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import TransitionPanel from "../components/TransitionPanel";
import DocumentPanel from "../components/DocumentPanel";
import { ErrorState } from "../components/ui/States";
import {
  SkeletonHeading,
  SkeletonPanel,
  SkeletonRegion,
} from "../components/ui/Skeleton";

/**
 * One request, and everything that has happened to it.
 *
 * ## The actions offered come from the record, not from a guess
 *
 * Which transition is available depends on the request's current status and the
 * viewer's role, and the server enforces both. This page shows the actions the
 * server's own data implies — and if it offers something the server refuses, the
 * refusal is displayed rather than hidden, because a permission rule that
 * changes without the UI noticing is worse than one that says no out loud.
 */
export default function RequestDetail() {
  const { reference } = useParams();
  const { can, canAny } = useAuth();
  const queryClient = useQueryClient();

  const [comment, setComment] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["request", reference],
    queryFn: () => apiGet(`/requests/${reference}`),
  });

  // Only fetched when the viewer could actually assign, so a student never
  // causes a staff directory request they have no use for.
  const staff = useQuery({
    queryKey: ["staff-directory"],
    queryFn: () => apiGet("/users/staff"),
    enabled: canAny("request:assign:department", "request:assign:institution"),
  });

  const assignable = staff.data?.data ?? [];

  const request = data?.data;

  const addComment = useMutation({
    mutationFn: () =>
      apiPost(`/requests/${reference}/comments`, { body: comment }),
    onSuccess: () => {
      setComment("");
      queryClient.invalidateQueries({ queryKey: ["request", reference] });
    },
  });

  if (isLoading)
    return (
      <SkeletonRegion label="Loading request">
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
        title="Request not available"
        message={error?.message}
        onRetry={() => refetch()}
      />
    );
  }

  const history = request.statusHistory ?? [];
  const latest = history[history.length - 1];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        to={can("request:read:assigned") ? "/management/requests" : "/requests"}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All requests
      </Link>

      <header className="rounded-xl bg-white dark:bg-surface px-6 py-5 shadow-sm ring-1 ring-ink-200/70 dark:ring-ink-600">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-100">
              {request.title}
            </h1>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
              {request.reference}
              {request.requestType?.name && ` · ${request.requestType.name}`}
              {request.department?.name && ` · ${request.department.name}`}
            </p>
          </div>
          <Badge status={request.status} />
        </div>

        {request.description && (
          <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-ink-400 dark:text-ink-500">
            {request.description}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-ink-100 dark:border-ink-700/50 pt-4 sm:grid-cols-4">
          <Detail label="Raised" value={formatDateTime(request.createdAt)} />
          <Detail label="Due" value={formatDateTime(request.dueAt)} />
          <Detail
            label="Assigned to"
            value={request.assignedTo?.fullName ?? "Unassigned"}
          />
          <Detail
            label="Last update"
            value={latest ? humanise(latest.to) : "—"}
          />
        </dl>
      </header>

      {/* ===== Answers ===== */}
      {request.data && Object.keys(request.data).length > 0 && (
        <Card title="Answers">
          <dl className="grid gap-3 sm:grid-cols-2">
            {Object.entries(request.data)
              // The idempotency key is machinery, not an answer the student gave.
              .filter(([key]) => !key.startsWith("__"))
              .map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs tracking-wide text-ink-500 dark:text-ink-400 dark:text-ink-500 uppercase">
                    {humanise(key)}
                  </dt>
                  <dd className="mt-0.5 text-sm text-ink-800">
                    {typeof value === "boolean"
                      ? value
                        ? "Yes"
                        : "No"
                      : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
        </Card>
      )}

      {/* ===== Actions, exactly as the server permits them ===== */}
      <TransitionPanel
        endpoint="/requests"
        record={request}
        transitions={request.availableTransitions}
        onDone={() =>
          queryClient.invalidateQueries({ queryKey: ["request", reference] })
        }
        emptyNote={
          request.status === "COMPLETED"
            ? "This request is complete. There is nothing further to do."
            : "No actions are available to you at this stage."
        }
      />

      {canAny("request:assign:department", "request:assign:institution") &&
        !request.assignedTo && (
          <AssignPanel
            request={request}
            staff={assignable}
            onDone={() =>
              queryClient.invalidateQueries({
                queryKey: ["request", reference],
              })
            }
          />
        )}

      {can("request:internal-note:institution") && (
        <InternalNotePanel
          request={request}
          onDone={() =>
            queryClient.invalidateQueries({ queryKey: ["request", reference] })
          }
        />
      )}

      {/*
        Documents, if the service for this request type asked for any. The
        required list comes from the server, so publishing a new service that
        needs a document needs no change here.
      */}
      <DocumentPanel endpoint="/requests" parentReference={reference} />

      {/* ===== Timeline ===== */}
      <Card title="History" description="Every step, in order.">
        <ol className="space-y-4">
          {history.map((entry, index) => (
            <li key={entry._id ?? index} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-brand-600" />
                {index < history.length - 1 && (
                  <span className="mt-1 w-px flex-1 bg-ink-200 dark:bg-ink-700/50" />
                )}
              </div>
              <div className="pb-1">
                <p className="text-sm font-medium text-ink-800">
                  {entry.from ? `${humanise(entry.from)} → ` : ""}
                  {humanise(entry.to)}
                </p>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
                  {formatDateTime(entry.at)}
                  {entry.actorRole && ` · ${humanise(entry.actorRole)}`}
                  {entry.note && ` · ${entry.note}`}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {canAny("request:assign:department", "request:assign:institution") &&
        !request.assignedTo && (
          <AssignPanel
            request={request}
            staff={assignable}
            onDone={() =>
              queryClient.invalidateQueries({
                queryKey: ["request", reference],
              })
            }
          />
        )}

      {can("request:internal-note:institution") && (
        <InternalNotePanel
          request={request}
          onDone={() =>
            queryClient.invalidateQueries({ queryKey: ["request", reference] })
          }
        />
      )}

      {/* ===== Comment, visible to the student ===== */}
      {/*
        The comments endpoint requires authentication, not a named permission —
        it scopes by ownership in the service. So this is gated on being able to
        see the request at all, rather than on a permission string that does not
        exist (it never did, so this comment was simply always false and the box
        never rendered).
      */}
      {can("request:read:own") || can("request:read:assigned") ? (
        <Card title="Add a comment">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (comment.trim()) addComment.mutate();
            }}
            className="space-y-3"
          >
            <label htmlFor="comment" className="sr-only">
              Comment
            </label>
            <textarea
              id="comment"
              rows={3}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Add something for the handler…"
              className="block w-full rounded-lg border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-ink-300 dark:ring-ink-500 placeholder:text-ink-400 dark:text-ink-500 focus:ring-2 focus:ring-brand-600"
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                loading={addComment.isPending}
                disabled={!comment.trim()}
              >
                <MessageSquare className="size-4" aria-hidden="true" />
                Post comment
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Who may take this on.
 *
 * Assignment is its own action rather than a status move, so it is offered
 * separately from the transition panel.
 */
function AssignPanel({ request, staff, onDone }) {
  const [userId, setUserId] = useState("");
  const [error, setError] = useState(null);

  const assign = useMutation({
    mutationFn: () =>
      apiPost(`/requests/${request.reference}/assign`, {
        assignTo: userId,
        // Guards against a stale view: the server refuses if the request has
        // moved on since this page was loaded.
        expectedFrom: request.status,
      }),
    onSuccess: () => {
      setUserId("");
      setError(null);
      onDone?.();
    },
    onError: (failure) => setError(failure.message),
  });

  return (
    <Card title="Assign" description="Who is handling this.">
      <div className="space-y-3">
        <Field label="Staff member" htmlFor="assignee" required>
          <select
            id="assignee"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            className="block w-full rounded-lg border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-ink-300 dark:ring-ink-500 focus:ring-2 focus:ring-brand-600"
          >
            <option value="">Choose someone…</option>
            {staff.map((member) => (
              <option
                key={member._id ?? member.id}
                value={member._id ?? member.id}
              >
                {member.fullName} — {humanise(member.role)}
              </option>
            ))}
          </select>
        </Field>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-700 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            loading={assign.isPending}
            disabled={!userId}
            onClick={() => assign.mutate()}
          >
            Assign
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** An internal note: staff-only, and never shown to the student. */
function InternalNotePanel({ request, onDone }) {
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: () =>
      apiPost(`/requests/${request.reference}/internal-notes`, { body: note }),
    onSuccess: () => {
      setNote("");
      onDone?.();
    },
  });

  return (
    <Card
      title="Internal note"
      description="Staff only. Never shown to the student and never sent as a notification."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (note.trim()) save.mutate();
        }}
        className="space-y-3"
      >
        <label htmlFor="internal-note" className="sr-only">
          Internal note
        </label>
        <textarea
          id="internal-note"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Context for whoever picks this up…"
          className="block w-full rounded-lg border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-ink-300 dark:ring-ink-500 placeholder:text-ink-400 dark:text-ink-500 focus:ring-2 focus:ring-brand-600"
        />
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
      <dt className="text-xs tracking-wide text-ink-500 dark:text-ink-400 dark:text-ink-500 uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink-800">{value ?? "—"}</dd>
    </div>
  );
}
