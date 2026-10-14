import { humanise } from "../../lib/format";

/**
 * Status badge.
 *
 * Colour is derived from the status, so a new status is legible by default
 * rather than silently inheriting "unknown grey" and reading as an error.
 */
const TONES = {
  PAID: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 ring-emerald-600/20",
  APPROVED:
    "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 ring-emerald-600/20",
  COMPLETED:
    "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 ring-emerald-600/20",
  RESOLVED:
    "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 ring-emerald-600/20",
  GENERATED:
    "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 ring-emerald-600/20",

  ISSUED:
    "bg-sky-100 dark:bg-sky-500/15 text-sky-800 dark:text-sky-200 ring-sky-600/20 dark:ring-sky-400/25",
  PARTIALLY_PAID:
    "bg-amber-100 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200 ring-amber-600/20",
  ACTION_REQUIRED:
    "bg-amber-100 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200 ring-amber-600/20",
  PENDING:
    "bg-amber-100 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200 ring-amber-600/20",
  IMPORTANT:
    "bg-amber-100 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200 ring-amber-600/20",
  REQUESTED:
    "bg-amber-100 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200 ring-amber-600/20",
  APPROVAL_PENDING:
    "bg-amber-100 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200 ring-amber-600/20",
  URGENT:
    "bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-200 ring-red-600/20",
  UNDER_REVIEW:
    "bg-indigo-100 dark:bg-indigo-500/15 text-indigo-800 dark:text-indigo-200 ring-indigo-600/20 dark:ring-indigo-400/25",
  INVESTIGATING:
    "bg-indigo-100 dark:bg-indigo-500/15 text-indigo-800 dark:text-indigo-200 ring-indigo-600/20 dark:ring-indigo-400/25",
  PROCESSING:
    "bg-indigo-100 dark:bg-indigo-500/15 text-indigo-800 dark:text-indigo-200 ring-indigo-600/20 dark:ring-indigo-400/25",

  REJECTED:
    "bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-200 ring-red-600/20",
  FAILED:
    "bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-200 ring-red-600/20",
  CANCELLED:
    "bg-ink-100 dark:bg-ink-200/40 text-ink-600 ring-ink-500/20 dark:ring-ink-500/25",
  DRAFT:
    "bg-ink-100 dark:bg-ink-200/40 text-ink-600 ring-ink-500/20 dark:ring-ink-500/25",
  REVOKED:
    "bg-ink-100 dark:bg-ink-200/40 text-ink-600 ring-ink-500/20 dark:ring-ink-500/25",
  ARCHIVED:
    "bg-ink-100 dark:bg-ink-200/40 text-ink-600 ring-ink-500/20 dark:ring-ink-500/25",
};

export default function Badge({ status, children, className = "" }) {
  const tone =
    TONES[status] ??
    "bg-ink-100 dark:bg-ink-200/40 text-ink-700 ring-ink-500/20 dark:ring-ink-500/25";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone} ${className}`}
    >
      {children ?? humanise(status)}
    </span>
  );
}
