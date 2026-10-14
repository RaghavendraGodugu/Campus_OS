/**
 * Skeleton placeholders.
 *
 * ## Why these instead of a spinner
 *
 * A spinner says "something is happening" and nothing else. It also reserves no
 * space, so when the data arrives the page grows underneath the reader and
 * anything they had already read moves. A skeleton that mirrors the shape of
 * what is coming means the layout is already correct before the first byte of
 * data exists, and nothing moves when it lands.
 *
 * ## The shapes are not arbitrary
 *
 * `SkeletonList` is as tall as a list row, `SkeletonStats` is as tall as a stat
 * tile, `SkeletonDetail` has the column structure of a detail page. They are
 * approximations on purpose — a skeleton that is the wrong shape is worse than a
 * spinner, because it promises a layout and then breaks it.
 *
 * ## For screen readers, silence
 *
 * The bars are `aria-hidden`; the container carries the status and the label. A
 * page announced as forty blank rectangles is worse than one that says
 * "Loading requests" and is quiet thereafter.
 *
 * ## Motion
 *
 * The shimmer is a background-position animation, disabled by the global
 * `prefers-reduced-motion` rule in index.css like everything else. It is also
 * slow enough (2.4s) to read as a pulse rather than a flash, which matters on a
 * page holding several of them at once.
 */

const SHIMMER =
  "shimmer relative overflow-hidden bg-ink-200/70 dark:bg-ink-700/60";

/**
 * A skeleton region that is announced once and then silent.
 *
 * `role="status"` with a label is the whole accessibility contract: a screen
 * reader says "Loading requests" when the region appears and says nothing
 * again. Without it the reader walks the placeholder bars one by one, which is
 * forty announcements of nothing.
 */
export function SkeletonRegion({ label, children, className = "" }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={className}
    >
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

export function Skeleton({ className = "", ...rest }) {
  return (
    <div
      aria-hidden="true"
      className={`${SHIMMER} rounded-md ${className}`}
      {...rest}
    />
  );
}

/** A single line of text. `width` exists because real text is not uniform. */
export function SkeletonLine({ width = "100%", className = "" }) {
  return <Skeleton className={`h-3.5 ${className}`} style={{ width }} />;
}

/**
 * A block of prose.
 *
 * The last line is short, because a paragraph whose final line is full width
 * looks like a table and not like a sentence.
 */
export function SkeletonText({ lines = 3, className = "" }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, index) => (
        <SkeletonLine
          key={index}
          width={index === lines - 1 ? "62%" : index % 3 === 1 ? "92%" : "100%"}
        />
      ))}
    </div>
  );
}

/** A heading plus the paragraph under it — the top of a detail page. */
export function SkeletonHeading({ width = "38%", className = "" }) {
  return (
    <div className={`space-y-3 ${className}`}>
      <Skeleton className="h-5" style={{ width }} />
      <SkeletonText lines={2} />
    </div>
  );
}

/**
 * Rows of a list or table.
 *
 * Heights are fixed rather than cyclical so a row never changes size between
 * renders, which is the whole point of using one of these at all.
 */
export function SkeletonList({ rows = 5, className = "" }) {
  return (
    <div
      className={`divide-y divide-ink-100/80 dark:divide-ink-700/50 ${className}`}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-4 sm:px-5">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonLine width="34%" />
            <SkeletonLine width="58%" className="h-3" />
          </div>
          <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** A row of the stat tiles above a dashboard or a profile. */
export function SkeletonStats({ count = 3, className = "" }) {
  return (
    <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="surface px-5 py-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-32" />
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** A card with a heading and some lines — the body of a detail page. */
export function SkeletonPanel({ lines = 4, className = "" }) {
  return (
    <div className={`surface p-5 ${className}`}>
      <Skeleton className="h-4 w-32" />
      <SkeletonText lines={lines} className="mt-4" />
    </div>
  );
}

/**
 * A form: labels and fields, already the right height.
 *
 * Used where the form itself is known before its data is — the new-complaint
 * page cannot render until the SLA policy arrives, and a blank form that then
 * pops into place is jarring.
 */
export function SkeletonForm({ fields = 3, className = "" }) {
  return (
    <div className={`space-y-5 ${className}`}>
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton
            className={index === fields - 1 ? "h-24 w-full" : "h-10 w-full"}
          />
        </div>
      ))}
    </div>
  );
}
