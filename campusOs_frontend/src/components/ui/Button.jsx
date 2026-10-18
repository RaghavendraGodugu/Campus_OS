/**
 * Button.
 *
 * `type` defaults to "button" rather than inheriting the browser's "submit".
 * An unlabelled button inside a form submits that form by accident, which is
 * how a "Cancel" ends up creating a record.
 */
const VARIANTS = {
  // A gradient rather than a flat fill: a large flat block of one colour is the
  // single most dated thing a button can be. The gradient is barely perceptible
  // but stops the control reading as a rectangle of paint.
  primary:
    "aurora liquid-sheen text-white shadow-brand ring-1 ring-white/15 hover:shadow-pop hover:brightness-[1.08] focus-visible:outline-brand-700 active:brightness-95 disabled:bg-none disabled:bg-ink-200 disabled:text-ink-400 disabled:shadow-none disabled:ring-ink-300",
  secondary:
    "bg-surface/90 text-ink-700 shadow-card ring-1 ring-ink-200/90 dark:ring-ink-600 backdrop-blur-sm hover:bg-white hover:ring-brand-200 hover:shadow-raised focus-visible:outline-ink-400 active:bg-ink-50 disabled:text-ink-400 disabled:shadow-none disabled:ring-ink-200",
  danger:
    "bg-linear-to-b from-red-500 to-red-600 text-white shadow-card ring-1 ring-red-700/20 hover:from-red-500 hover:to-red-700 hover:shadow-raised focus-visible:outline-red-700 active:to-red-700 disabled:from-red-300 disabled:to-red-300",
  ghost:
    "text-ink-600 hover:bg-ink-100/80 dark:hover:bg-ink-200/40 hover:text-ink-900 focus-visible:outline-ink-400 active:bg-ink-200/60 disabled:text-ink-400",
  /** For destructive actions that should not be the obvious thing to click. */
  subtle:
    "bg-ink-100 dark:bg-ink-200/40 text-ink-600 hover:bg-brand-50 dark:hover:bg-brand-500/20 hover:text-brand-800 focus-visible:outline-ink-400 disabled:text-ink-400",
  /** The one loud control on a page. Never more than one per screen. */
  accent:
    "aurora-vanilla liquid-sheen text-brand-950 shadow-accent ring-1 ring-brand-900/10 hover:brightness-[1.03] hover:shadow-pop focus-visible:outline-accent-700 active:brightness-95 disabled:bg-none disabled:bg-ink-200 disabled:text-ink-400 disabled:shadow-none",
};

const SIZES = {
  sm: "h-8.5 rounded-lg px-3 text-xs",
  md: "h-10 rounded-xl px-4 text-sm",
  lg: "h-12 rounded-2xl px-5 text-[0.9375rem]",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  type = "button",
  className = "",
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
