import { humanise } from "../../lib/format";

/**
 * Status badge.
 *
 * Colour is derived from the status, so a new status is legible by default
 * rather than silently inheriting "unknown grey" and reading as an error.
 */
const TONES = {
  PAID: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  APPROVED: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  COMPLETED: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  RESOLVED: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  GENERATED: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",

  ISSUED: "bg-sky-100 text-sky-800 ring-sky-600/20",
  PARTIALLY_PAID: "bg-amber-100 text-amber-900 ring-amber-600/20",
  ACTION_REQUIRED: "bg-amber-100 text-amber-900 ring-amber-600/20",
  PENDING: "bg-amber-100 text-amber-900 ring-amber-600/20",
  IMPORTANT: "bg-amber-100 text-amber-900 ring-amber-600/20",
  REQUESTED: "bg-amber-100 text-amber-900 ring-amber-600/20",
  APPROVAL_PENDING: "bg-amber-100 text-amber-900 ring-amber-600/20",
  URGENT: "bg-red-100 text-red-800 ring-red-600/20",
  UNDER_REVIEW: "bg-indigo-100 text-indigo-800 ring-indigo-600/20",
  INVESTIGATING: "bg-indigo-100 text-indigo-800 ring-indigo-600/20",
  PROCESSING: "bg-indigo-100 text-indigo-800 ring-indigo-600/20",

  REJECTED: "bg-red-100 text-red-800 ring-red-600/20",
  FAILED: "bg-red-100 text-red-800 ring-red-600/20",
  CANCELLED: "bg-ink-100 text-ink-600 ring-ink-500/20",
  DRAFT: "bg-ink-100 text-ink-600 ring-ink-500/20",
  REVOKED: "bg-ink-100 text-ink-600 ring-ink-500/20",
  ARCHIVED: "bg-ink-100 text-ink-600 ring-ink-500/20",
};

export default function Badge({ status, children, className = "" }) {
  const tone = TONES[status] ?? "bg-ink-100 text-ink-700 ring-ink-500/20";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone} ${className}`}
    >
      {children ?? humanise(status)}
    </span>
  );
}
