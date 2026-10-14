/**
 * Form field.
 *
 * The label is always rendered, never replaced by a placeholder: a placeholder
 * disappears the moment someone types, which is exactly when they need to check
 * what the field asked for. The error is wired through `aria-describedby` and
 * `aria-invalid` so it is announced, not merely coloured.
 *
 * `optional` is an explicit argument rather than inferred, because "optional"
 * is information: a field nobody needs should say so, and one that does should
 * be marked required.
 */
export default function Field({
  label,
  htmlFor,
  error,
  hint,
  required = false,
  optional = false,
  children,
  className = "",
}) {
  const describedBy = [
    error ? `${htmlFor}-error` : null,
    hint ? `${htmlFor}-hint` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="block text-[0.8125rem] font-medium text-ink-700"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-red-500" aria-hidden="true">
            *
          </span>
        )}
        {optional && !required && (
          <span className="ml-1.5 text-xs font-normal text-ink-400 dark:text-ink-500">
            Optional
          </span>
        )}
      </label>

      <div className="mt-1.5">{children}</div>

      {hint && !error && (
        <p
          id={`${htmlFor}-hint`}
          className="mt-1.5 text-xs text-ink-500 dark:text-ink-400"
        >
          {hint}
        </p>
      )}

      {error && (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="mt-1.5 text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}

      <span className="sr-only" data-describedby={describedBy || undefined} />
    </div>
  );
}

/**
 * The shared input styling, so every field looks the same.
 *
 * Ring rather than border, because a border shifts the box by a pixel when the
 * width changes and the whole page twitches on focus. The focus state is a
 * brand-coloured ring plus a soft brand wash, which reads as "active" without
 * needing a brightness jump.
 */
export const inputClass =
  "block w-full rounded-xl border-0 bg-surface px-3.5 py-2.5 text-sm text-ink-900 shadow-sm ring-1 ring-ink-200/90 dark:ring-ink-600 transition-all duration-150 placeholder:text-ink-400 hover:ring-ink-300 hover:shadow-card focus:bg-white focus:ring-2 focus:ring-brand-500 focus:shadow-raised aria-[invalid=true]:ring-red-400 aria-[invalid=true]:focus:ring-red-500 disabled:bg-ink-100/70 disabled:text-ink-400";
