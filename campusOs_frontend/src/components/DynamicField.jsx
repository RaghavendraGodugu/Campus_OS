import Field, { inputClass } from "./ui/Field";

/**
 * A form built from a request type's field definitions.
 *
 * ## The server owns the shape
 *
 * The fields are described by the request type, not hard-coded here. That is
 * what lets an administrator publish a new service — "transcript request",
 * "scholarship application" — and have a correct form appear with no frontend
 * change, and it is why this component is a renderer rather than a page.
 *
 * ## What the browser still checks
 *
 * The server validates every field and names the offender, and that is the
 * authority. The checks here exist to catch an empty required box before a
 * round trip, not to replace the server's.
 *
 * `min`/`max` on a NUMBER are enforced as attributes *and* on blur, because a
 * native constraint is invisible until submission and the server's message only
 * arrives after it.
 */
export default function DynamicField({ field, value, error, onChange }) {
  const id = `field-${field.name}`;
  const invalid = Boolean(error);

  const described = {
    "aria-invalid": invalid || undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  };

  switch (field.type) {
    case "TEXTAREA":
      return (
        <Field
          label={field.label}
          htmlFor={id}
          required={field.required}
          error={error}
          hint={
            field.maxLength ? `Up to ${field.maxLength} characters` : undefined
          }
        >
          <textarea
            id={id}
            rows={3}
            value={value ?? ""}
            maxLength={field.maxLength}
            onChange={(event) => onChange(event.target.value)}
            className={`${inputClass} resize-y`}
            {...described}
          />
        </Field>
      );

    case "NUMBER":
      return (
        <Field
          label={field.label}
          htmlFor={id}
          required={field.required}
          error={error}
          hint={
            field.min !== undefined && field.max !== undefined
              ? `Between ${field.min} and ${field.max}`
              : field.min !== undefined
                ? `At least ${field.min}`
                : undefined
          }
        >
          <input
            id={id}
            type="number"
            inputMode="numeric"
            value={value ?? ""}
            min={field.min}
            max={field.max}
            onChange={(event) => onChange(event.target.value)}
            className={inputClass}
            {...described}
          />
        </Field>
      );

    case "DATE":
      return (
        <Field
          label={field.label}
          htmlFor={id}
          required={field.required}
          error={error}
        >
          <input
            id={id}
            type="date"
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value)}
            className={inputClass}
            {...described}
          />
        </Field>
      );

    case "SELECT":
      return (
        <Field
          label={field.label}
          htmlFor={id}
          required={field.required}
          error={error}
        >
          <select
            id={id}
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value)}
            className={inputClass}
            {...described}
          >
            {/* An explicit empty option, so clearing a select is possible and
                a required select is genuinely empty rather than silently
                defaulting to the first choice. */}
            <option value="">Choose…</option>
            {(field.options ?? []).map((option) => {
              const optionValue =
                typeof option === "string" ? option : option.value;
              const optionLabel =
                typeof option === "string" ? option : option.label;
              return (
                <option key={optionValue} value={optionValue}>
                  {optionLabel}
                </option>
              );
            })}
          </select>
        </Field>
      );

    case "BOOLEAN":
      return (
        <div className="flex items-start gap-2.5">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
            className="mt-0.5 size-4 rounded border-ink-300 dark:border-ink-600 text-brand-600 focus:ring-brand-600"
            {...described}
          />
          <div>
            <label htmlFor={id} className="text-sm font-medium text-ink-700">
              {field.label}
              {field.required && (
                <span className="ml-0.5 text-red-600 dark:text-red-400">*</span>
              )}
            </label>
            {error && (
              <p
                id={`${id}-error`}
                role="alert"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {error}
              </p>
            )}
          </div>
        </div>
      );

    case "TEXT":
    default:
      return (
        <Field
          label={field.label}
          htmlFor={id}
          required={field.required}
          error={error}
          hint={
            field.maxLength ? `Up to ${field.maxLength} characters` : undefined
          }
        >
          <input
            id={id}
            type="text"
            value={value ?? ""}
            maxLength={field.maxLength}
            onChange={(event) => onChange(event.target.value)}
            className={inputClass}
            {...described}
          />
        </Field>
      );
  }
}
