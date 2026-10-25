/**
 * A page section.
 *
 * `inset` puts the header flush with the panel edge and lets the body scroll
 * independently, which is what a dialog or a list panel wants. `flush` removes
 * body padding for tables that should run to the panel's edges. Plain calls get
 * a header rule, a lifted surface and room to breathe.
 */
export function Card({
  title,
  description,
  actions,
  children,
  className = "",
  bodyClassName = "",
  as: Tag = "section",
  inset = false,
  flush = false,
}) {
  return (
    <Tag className={`surface overflow-hidden ${className}`}>
      {(title || actions) && (
        <header
          className={`flex flex-wrap items-start justify-between gap-3 ${
            inset
              ? "px-5 pt-4"
              : "border-b border-ink-200/60 dark:border-ink-700/50 px-5 py-4 sm:px-6"
          }`}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="text-[0.9375rem] font-semibold tracking-tight text-ink-900 dark:text-ink-100">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500 dark:text-ink-400">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>
      )}
      <div
        className={
          flush && !inset ? "" : inset ? "px-5 pb-5" : "px-5 py-5 sm:px-6"
        }
      >
        <div className={bodyClassName}>{children}</div>
      </div>
    </Tag>
  );
}

/**
 * A single headline figure.
 *
 * `hint` exists so a number is never presented without its unit or its period.
 * A bare figure invites the reader to supply their own denominator.
 */
export function Stat({ label, value, hint, tone = "default", icon: Icon }) {
  const tones = {
    default: "text-ink-900 dark:text-ink-100",
    good: "text-emerald-700 dark:text-emerald-300",
    warn: "text-amber-700 dark:text-amber-300",
    bad: "text-red-700 dark:text-red-300",
  };

  return (
    <div className="surface group px-5 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-raised">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.6875rem] font-semibold tracking-[0.06em] text-ink-500 dark:text-ink-400 uppercase">
          {label}
        </p>
        {Icon && (
          <Icon
            className="size-4 text-ink-300 dark:text-ink-500 transition-colors duration-200 group-hover:text-brand-500"
            aria-hidden="true"
          />
        )}
      </div>
      <p
        className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${tones[tone] ?? tones.default}`}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{hint}</p>
      )}
    </div>
  );
}
