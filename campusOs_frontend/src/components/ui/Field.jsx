/**
 * Form field.
 *
 * The label is always rendered, never replaced by a placeholder: a placeholder
 * disappears the moment someone types, which is exactly when they need to check
 * what the field asked for. The error is wired through `aria-describedby` and
 * `aria-invalid` so it is announced, not merely coloured.
 */
export default function Field({
  label,
  htmlFor,
  error,
  hint,
  required = false,
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
        className="block text-sm font-medium text-ink-700"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        )}
        {!required && (
          <span className="ml-1 text-xs text-ink-400">(optional)</span>
        )}
      </label>

      <div className="mt-1.5">{children}</div>

      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-xs text-ink-500">
          {hint}
        </p>
      )}

      {error && (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="mt-1.5 text-xs text-red-600"
        >
          {error}
        </p>
      )}

      <span className="sr-only" data-describedby={describedBy || undefined} />
    </div>
  );
}

/** The shared input styling, so every field looks the same. */
export const inputClass =
  "block w-full rounded-lg border-0 px-3 py-2 text-sm text-ink-900 shadow-sm ring-1 ring-inset ring-ink-300 placeholder:text-ink-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 aria-[invalid=true]:ring-red-500";
