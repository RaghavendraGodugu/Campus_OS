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
import { ErrorState, Loading } from "../components/ui/States";

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
  const { can, user } = useAuth();
  const queryClient = useQueryClient();

  const [comment, setComment] = useState("");
  const [actionError, setActionError] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["request", reference],
    queryFn: () => apiGet(`/requests/${reference}`),
  });

  const request = data?.data;

  const transition = useMutation({
    mutationFn: (to) => apiPost(`/requests/${reference}/transition`, { to }),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["request", reference] });
      queryClient.invalidateQueries({ queryKey: ["requests"] });
    },
    onError: (failure) => setActionError(failure.message),
  });

  const addComment = useMutation({
    mutationFn: () =>
      apiPost(`/requests/${reference}/comments`, { body: comment }),
    onSuccess: () => {
      setComment("");
      queryClient.invalidateQueries({ queryKey: ["request", reference] });
    },
  });

  if (isLoading) return <Loading label="Loading request" />;
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
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All requests
      </Link>

      <header className="rounded-xl bg-white px-6 py-5 shadow-sm ring-1 ring-ink-200/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-ink-900">
              {request.title}
            </h1>
            <p className="mt-1 text-xs text-ink-500">
              {request.reference}
              {request.requestType?.name && ` · ${request.requestType.name}`}
              {request.department?.name && ` · ${request.department.name}`}
            </p>
          </div>
          <Badge status={request.status} />
        </div>

        {request.description && (
          <p className="mt-3 text-sm leading-relaxed text-ink-600">
            {request.description}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-ink-100 pt-4 sm:grid-cols-4">
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
                  <dt className="text-xs tracking-wide text-ink-500 uppercase">
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

      {/* ===== Actions ===== */}
      <RequestActions
        request={request}
        viewerRole={user?.role}
        can={can}
        onTransition={(to) => transition.mutate(to)}
        pending={transition.isPending}
      />

      {actionError && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {actionError}
        </p>
      )}

      {/* ===== Timeline ===== */}
      <Card title="History" description="Every step, in order.">
        <ol className="space-y-4">
          {history.map((entry, index) => (
            <li key={entry._id ?? index} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-brand-600" />
                {index < history.length - 1 && (
                  <span className="mt-1 w-px flex-1 bg-ink-200" />
                )}
              </div>
              <div className="pb-1">
                <p className="text-sm font-medium text-ink-800">
                  {entry.from ? `${humanise(entry.from)} → ` : ""}
                  {humanise(entry.to)}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {formatDateTime(entry.at)}
                  {entry.actorRole && ` · ${humanise(entry.actorRole)}`}
                  {entry.note && ` · ${entry.note}`}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {/* ===== Comment ===== */}
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
              className="block w-full rounded-lg border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-ink-300 placeholder:text-ink-400 focus:ring-2 focus:ring-brand-600"
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
 * The transitions this viewer may attempt.
 *
 * Derived from the status rather than offering everything and letting the server
 * refuse: a row of greyed-out buttons teaches a user the rules of a workflow
 * they do not need. Anything the server still refuses shows its refusal.
 */
function RequestActions({ request, viewerRole, can, onTransition, pending }) {
  const isStaff = viewerRole !== "STUDENT";

  const actions = [];

  if (
    isStaff &&
    can("request:process:assigned") &&
    request.status === "ASSIGNED"
  ) {
    actions.push({ to: "UNDER_REVIEW", label: "Start review" });
  }

  if (isStaff && can("request:complete:assigned")) {
    if (request.status === "APPROVED")
      actions.push({ to: "PROCESSING", label: "Start processing" });
    if (request.status === "PROCESSING")
      actions.push({ to: "COMPLETED", label: "Mark completed" });
    if (request.status === "APPROVAL_PENDING")
      actions.push({ to: "APPROVED", label: "Approve" });
  }

  if (
    can("request:approve:institution") &&
    request.status === "APPROVAL_PENDING"
  ) {
    actions.push({ to: "APPROVED", label: "Approve" });
  }

  if (actions.length === 0) return null;

  return (
    <Card title="Actions">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.to}
            variant={
              action.to === "COMPLETED" || action.to === "APPROVED"
                ? "primary"
                : "secondary"
            }
            size="sm"
            loading={pending}
            onClick={() => onTransition(action.to)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-800">{value ?? "—"}</dd>
    </div>
  );
}
