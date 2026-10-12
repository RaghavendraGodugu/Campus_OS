/**
 * Button.
 *
 * `type` defaults to "button" rather than inheriting the browser's "submit".
 * An unlabelled button inside a form submits that form by accident, which is
 * how a "Cancel" ends up creating a record.
 */
const VARIANTS = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-700 disabled:bg-brand-300",
  secondary:
    "bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50 focus-visible:outline-ink-400 disabled:text-ink-400",
  danger:
    "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-700 disabled:bg-red-300",
  ghost:
    "text-ink-600 hover:bg-ink-100 focus-visible:outline-ink-400 disabled:text-ink-400",
};

const SIZES = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3.5 py-2 text-sm",
  lg: "px-5 py-2.5 text-sm",
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
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
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
