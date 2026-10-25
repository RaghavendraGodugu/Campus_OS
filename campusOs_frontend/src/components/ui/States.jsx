import { AlertTriangle, Inbox, Loader2 } from "lucide-react";

/**
 * Loading, empty and error states.
 *
 * Each says what happened rather than showing a spinner forever. "Nothing here"
 * and "we could not load this" are different answers and a user cannot tell them
 * apart if both render as blank space.
 */

export function Loading({ label = "Loading" }) {
  return (
    <div
      className="flex items-center justify-center gap-3 py-16 text-ink-500 dark:text-ink-400 dark:text-ink-500"
      role="status"
    >
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-ink-200 dark:border-ink-700/70 bg-white/50 dark:bg-surface px-6 py-16 text-center">
      <Icon
        className="size-8 text-ink-300 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500"
        aria-hidden="true"
      />
      <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
      {description && (
        <p className="max-w-sm text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-red-200 dark:border-red-400/25 bg-red-50 dark:bg-red-500/12 px-6 py-12 text-center"
    >
      <AlertTriangle className="size-8 text-red-500" aria-hidden="true" />
      <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">
        {title}
      </h3>
      {message && (
        <p className="max-w-sm text-sm text-red-700 dark:text-red-300">
          {message}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-xl bg-white dark:bg-surface px-4 py-2 text-sm font-medium text-red-800 dark:text-red-200 shadow-card ring-1 ring-red-200 dark:ring-red-400/25 transition-all duration-150 hover:bg-red-50 hover:shadow-raised"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** A full-page message for a session that exists but could not be confirmed. */
export function UnconfirmedState({ onRetry }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <AlertTriangle
        className="mx-auto size-10 text-amber-500 dark:text-amber-400"
        aria-hidden="true"
      />
      <h2 className="mt-4 text-lg font-semibold text-ink-900 dark:text-ink-100">
        We could not confirm your session
      </h2>
      <p className="mt-2 text-sm text-ink-600 dark:text-ink-400 dark:text-ink-500">
        You are still signed in, but the server did not answer. This is usually
        temporary — check your connection and try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Try again
      </button>
    </div>
  );
}
