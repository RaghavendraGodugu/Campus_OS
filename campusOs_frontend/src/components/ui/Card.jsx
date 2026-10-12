/** A page section. */
export function Card({
  title,
  description,
  actions,
  children,
  className = "",
  as: Tag = "section",
}) {
  return (
    <Tag
      className={`rounded-xl bg-white shadow-sm ring-1 ring-ink-200/70 ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div>
            {title && (
              <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-ink-500">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
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
    default: "text-ink-900",
    good: "text-emerald-700",
    warn: "text-amber-700",
    bad: "text-red-700",
  };

  return (
    <div className="rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-ink-200/70">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">
          {label}
        </p>
        {Icon && <Icon className="size-4 text-ink-400" aria-hidden="true" />}
      </div>
      <p
        className={`mt-2 text-2xl font-semibold tabular-nums ${tones[tone] ?? tones.default}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
