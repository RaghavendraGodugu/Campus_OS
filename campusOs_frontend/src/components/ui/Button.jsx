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
    "bg-linear-to-b from-brand-500 to-brand-600 text-white shadow-brand ring-1 ring-brand-600/20 hover:from-brand-500 hover:to-brand-700 hover:shadow-raised focus-visible:outline-brand-700 active:from-brand-600 active:to-brand-700 disabled:from-brand-300 disabled:to-brand-300 disabled:shadow-none",
  secondary:
    "bg-white text-ink-700 shadow-card ring-1 ring-ink-200 hover:bg-ink-50 hover:ring-ink-300 focus-visible:outline-ink-400 active:bg-ink-100 disabled:text-ink-400 disabled:shadow-none disabled:ring-ink-200",
  danger:
    "bg-linear-to-b from-red-500 to-red-600 text-white shadow-card ring-1 ring-red-600/20 hover:to-red-700 focus-visible:outline-red-700 active:to-red-700 disabled:from-red-300 disabled:to-red-300",
  ghost:
    "text-ink-600 hover:bg-ink-100/80 hover:text-ink-900 focus-visible:outline-ink-400 active:bg-ink-200/60 disabled:text-ink-400",
  /** For destructive actions that should not be the obvious thing to click. */
  subtle:
    "bg-ink-100/70 text-ink-600 hover:bg-ink-200/70 hover:text-ink-900 focus-visible:outline-ink-400 disabled:text-ink-400",
};

const SIZES = {
  sm: "h-8 rounded-lg px-3 text-xs",
  md: "h-9.5 rounded-xl px-4 text-sm",
  lg: "h-11 rounded-xl px-5 text-sm",
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
