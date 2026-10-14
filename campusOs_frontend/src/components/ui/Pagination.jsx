/**
 * Pagination.
 *
 * Rendered only when there is more than one page, so a single page does not
 * carry a row of dead buttons.
 */
export default function Pagination({ page, limit, total, onPage }) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <nav
      className="flex items-center justify-between border-t border-ink-100 dark:border-ink-700/50 px-5 py-3"
      aria-label="Pagination"
    >
      <p className="text-xs text-ink-500 dark:text-ink-400">
        Showing <span className="font-medium text-ink-700">{from}</span>–
        <span className="font-medium text-ink-700">{to}</span> of{" "}
        <span className="font-medium text-ink-700">{total}</span>
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-700 ring-1 ring-ink-200 dark:ring-ink-600 hover:bg-ink-50 dark:hover:bg-ink-200/40 disabled:text-ink-300 disabled:ring-ink-100"
        >
          Previous
        </button>
        <span className="text-xs text-ink-500 dark:text-ink-400">
          Page {page} of {pages}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-700 ring-1 ring-ink-200 dark:ring-ink-600 hover:bg-ink-50 dark:hover:bg-ink-200/40 disabled:text-ink-300 disabled:ring-ink-100"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
