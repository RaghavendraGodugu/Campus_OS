import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { apiPost } from "../api/client";
import Button from "./ui/Button";
import Field, { inputClass } from "./ui/Field";
import { Card } from "./ui/Card";

/**
 * The actions available on a record.
 *
 * ## The server decides what is here
 *
 * `availableTransitions` comes from the record's own detail response, already
 * filtered by the viewer's permissions. This component renders what it is given
 * and holds no workflow rules of its own.
 *
 * That is a deliberate reversal of the usual client pattern. An earlier version
 * of the request page hard-coded a list of statuses and buttons; it drifted from
 * the server on its first change, and it offered a HOD buttons the server would
 * refuse. The workflow map lives in `utils/workflow.js` on the server, it is
 * permission-aware, and it is the only copy.
 *
 * ## `expectedFrom` is not optional
 *
 * Every transition sends the status the client believed it was moving from. The
 * server compares and refuses if it no longer matches, so two officers acting on
 * a stale view cannot both succeed and silently overwrite each other.
 *
 * ## A reason is asked for only when required
 *
 * `reasonRequired` comes from the server too. An optional field is still offered,
 * because a note is useful — but it is not demanded where the workflow does not
 * need it.
 */
export default function TransitionPanel({
  endpoint,
  record,
  transitions,
  onDone,
  emptyNote = "No actions are available to you at this stage.",
}) {
  const [pending, setPending] = useState(null); // the transition awaiting a reason
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);

  const move = useMutation({
    mutationFn: ({ to, note }) =>
      apiPost(`${endpoint}/${record.id ?? record._id}/transition`, {
        to,
        expectedFrom: record.status,
        ...(note ? { reason: note } : {}),
      }),
    onSuccess: () => {
      setPending(null);
      setReason("");
      setError(null);
      onDone?.();
    },
    onError: (failure) => setError(failure.message),
  });

  if (!transitions || transitions.length === 0) {
    return (
      <Card title="Actions">
        <p className="text-sm text-ink-500">{emptyNote}</p>
      </Card>
    );
  }

  const destructive = (to) => /REJECT|CANCEL|REVOK|ESCALAT/i.test(to);

  return (
    <Card
      title="Actions"
      description="Only what is permitted from this status."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {transitions.map((transition) => (
            <Button
              key={transition.to}
              variant={destructive(transition.to) ? "danger" : "secondary"}
              size="sm"
              loading={move.isPending && pending?.to === transition.to}
              onClick={() => {
                setError(null);
                if (transition.reasonRequired) {
                  setPending(transition);
                  setReason("");
                } else {
                  move.mutate({ to: transition.to });
                }
              }}
            >
              {transition.label ?? transition.to}
            </Button>
          ))}
        </div>

        {/* A reason, demanded only where the workflow says so. */}
        {pending && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <Field
              label={pending.label ?? pending.to}
              htmlFor="transition-reason"
              required
              hint="This is recorded in the audit trail and shown to the student."
            >
              <textarea
                id="transition-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={inputClass}
                autoFocus
              />
            </Field>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                loading={move.isPending}
                disabled={reason.trim().length === 0}
                onClick={() =>
                  move.mutate({ to: pending.to, note: reason.trim() })
                }
              >
                Confirm
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * A single irreversible action — issuing a certificate, revoking one.
 *
 * Separate from the transition panel because these are not status moves: they
 * reach a different endpoint, often take extra input, and issuing a certificate
 * produces a document a person will rely on.
 */
export function DangerousAction({
  title,
  description,
  confirmLabel,
  buttonLabel,
  variant = "danger",
  requiresReason = true,
  endpoint,
  method = "POST",
  onDone,
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);

  const action = useMutation({
    mutationFn: () =>
      apiPost(endpoint, requiresReason ? { reason: reason.trim() } : {}),
    onSuccess: () => {
      setOpen(false);
      setReason("");
      setError(null);
      onDone?.();
    },
    onError: (failure) => setError(failure.message),
  });

  void method;

  return (
    <Card title={title} description={description}>
      {!open ? (
        <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
          {buttonLabel}
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
          {requiresReason && (
            <Field
              label="Reason"
              htmlFor="danger-reason"
              required
              hint="Recorded permanently against the record."
            >
              <textarea
                id="danger-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={inputClass}
                autoFocus
              />
            </Field>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={action.isPending}
              disabled={requiresReason && reason.trim().length === 0}
              onClick={() => action.mutate()}
            >
              {confirmLabel ?? buttonLabel}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
