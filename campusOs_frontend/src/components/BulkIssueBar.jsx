import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Stamp, X } from "lucide-react";

import { apiPost } from "../api/client";
import Button from "./ui/Button";

/**
 * Bulk certificate issuance.
 *
 * ## This cannot approve anything
 *
 * Issuing one certificate is a judgement about one student's evidence. Issuing
 * forty at once is forty judgements in one click, which is how a whole cohort
 * receives a certificate nobody checked. The server only touches certificates
 * that are already APPROVED with a recorded approver; this bar says so rather
 * than letting somebody discover it by being refused.
 *
 * ## Every skip is named
 *
 * A partial run that reports "38 issued" and says nothing about the other two is
 * how somebody assumes all forty went through. Each skipped certificate is listed
 * with its reference and the reason, and stays listed until dismissed.
 */

export default function BulkIssueBar({ selected, onClear, onIssued }) {
  const [result, setResult] = useState(null);

  const issue = useMutation({
    mutationFn: () =>
      apiPost("/certificates/bulk-issue", { certificateIds: selected }),
    onSuccess: (response) => {
      setResult(response.data);
      onIssued?.();
    },
  });

  if (selected.length === 0 && !result) return null;

  const skipped = result?.skipped ?? [];

  return (
    <section
      aria-label="Bulk issue"
      className="surface sticky bottom-4 z-20 space-y-3 px-5 py-4"
    >
      {issue.isPending ? (
        <p className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-300">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Issuing {selected.length} certificate
          {selected.length === 1 ? "" : "s"}…
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-300">
            <Stamp className="size-4" aria-hidden="true" />
            {selected.length === 0 ? (
              <span>
                {result?.issued?.length ?? 0} issued
                {skipped.length > 0 && `, ${skipped.length} skipped`}
              </span>
            ) : (
              <span>
                {selected.length} approved certificate
                {selected.length === 1 ? "" : "s"} selected
              </span>
            )}
          </p>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setResult(null);
                onClear?.();
              }}
            >
              <X className="size-4" aria-hidden="true" />
              Dismiss
            </Button>

            {selected.length > 0 && (
              <Button
                size="sm"
                onClick={() => issue.mutate()}
                disabled={issue.isPending}
              >
                <Stamp className="size-4" aria-hidden="true" />
                Issue {selected.length}
              </Button>
            )}
          </div>
        </div>
      )}

      {issue.isError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {issue.error?.message}
        </p>
      )}

      {result?.issued?.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-brand-700 dark:text-brand-300">
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          Issued {result.issued.length}:{" "}
          {result.issued.map((entry) => entry.reference).join(", ")}
        </p>
      )}

      {/*
        The skips are named, with the reason. This is the part that stops a
        partial run being read as a complete one.
      */}
      {skipped.length > 0 && (
        <div className="rounded-lg bg-ink-50 p-3 dark:bg-ink-100/40">
          <p className="text-xs font-medium text-ink-800 dark:text-ink-100">
            Not issued
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-ink-600 dark:text-ink-300">
            {skipped.map((entry) => (
              <li key={entry.reference}>
                <span className="font-medium">{entry.reference}</span> —{" "}
                {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {selected.length > 0 && (
        <p className="text-xs text-ink-500 dark:text-ink-400">
          Only certificates already approved with a recorded approver can be
          issued this way. This action cannot approve anything.
        </p>
      )}
    </section>
  );
}
