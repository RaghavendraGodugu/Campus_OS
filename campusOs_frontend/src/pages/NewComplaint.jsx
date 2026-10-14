import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";

import { apiGet, apiPost } from "../api/client";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";
import { Card } from "../components/ui/Card";
import { ErrorState, Loading } from "../components/ui/States";

/**
 * Raise a complaint.
 *
 * ## The confidentiality promise is made here, before anything is typed
 *
 * The page states plainly who will see it and that the body is not disclosed to
 * staff who are not handling it. That is not decoration: a person deciding
 * whether to report harassment is deciding on the basis of who will read it,
 * and burying that in a policy page would be a way of losing the complaint
 * before it is ever filed.
 */
export default function NewComplaint() {
  const navigate = useNavigate();
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [confidential, setConfidential] = useState(true);
  const [errors, setErrors] = useState({});

  const policy = useQuery({
    queryKey: ["complaint-sla-policy"],
    queryFn: () => apiGet("/complaints/sla-policy"),
  });

  const submit = useMutation({
    mutationFn: (payload) => apiPost("/complaints", payload),
    onSuccess: (response) => navigate(`/complaints/${response.data.reference}`),
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  const onSubmit = (event) => {
    event.preventDefault();
    submit.mutate({ category, subject, description, confidential });
  };

  if (policy.isLoading) return <Loading label="Loading the complaint policy" />;
  if (policy.isError) {
    return (
      <ErrorState
        message={policy.error?.message}
        onRetry={() => policy.refetch()}
      />
    );
  }

  const categories = policy.data?.data?.categories ?? [];
  const chosen = categories.find((c) => (c.value ?? c.key ?? c) === category);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Raise a complaint
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Treated confidentially from the moment it is filed.
        </p>
      </header>

      <div className="flex items-start gap-3 rounded-xl bg-brand-50 dark:bg-brand-500/15 px-4 py-3 ring-1 ring-brand-200 dark:ring-brand-400/25">
        <ShieldAlert
          className="mt-0.5 size-4 shrink-0 text-brand-700 dark:text-brand-300"
          aria-hidden="true"
        />
        <p className="text-xs text-brand-900 dark:text-brand-100">
          Only the officers handling grievances can read this. They are chosen
          for that role and do not gain access through it to any other data
          about you. What you write is never copied into notifications or the
          audit trail.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <Card title="What happened">
          <div className="space-y-5">
            <Field
              label="Category"
              htmlFor="category"
              required
              error={errors.category}
            >
              <select
                id="category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className={inputClass}
                aria-invalid={Boolean(errors.category) || undefined}
              >
                <option value="">Choose a category…</option>
                {categories.map((c) => {
                  const value = c.value ?? c.key ?? c;
                  return (
                    <option key={value} value={value}>
                      {c.label ?? value.replace(/_/g, " ").toLowerCase()}
                    </option>
                  );
                })}
              </select>
            </Field>

            {chosen?.slaHours && (
              <p className="rounded-lg bg-ink-50 dark:bg-ink-100/40 px-3 py-2 text-xs text-ink-600">
                A first response is due within{" "}
                <strong className="font-medium">{chosen.slaHours} hours</strong>{" "}
                of this being filed.
              </p>
            )}

            <Field
              label="Subject"
              htmlFor="subject"
              required
              error={errors.subject}
              hint="One line. This is what staff see in the list."
            >
              <input
                id="subject"
                value={subject}
                maxLength={200}
                onChange={(event) => setSubject(event.target.value)}
                className={inputClass}
                aria-invalid={Boolean(errors.subject) || undefined}
              />
            </Field>

            <Field
              label="What happened"
              htmlFor="description"
              required
              error={errors.description}
              hint="Be as specific as you can: dates, places and what was said or done."
            >
              <textarea
                id="description"
                rows={8}
                value={description}
                maxLength={5000}
                onChange={(event) => setDescription(event.target.value)}
                className={`${inputClass} resize-y`}
                aria-invalid={Boolean(errors.description) || undefined}
              />
            </Field>

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={confidential}
                onChange={(event) => setConfidential(event.target.checked)}
                className="mt-0.5 size-4 rounded border-ink-300 dark:border-ink-600 text-brand-600 focus:ring-brand-600"
              />
              <span className="text-sm text-ink-700">
                Mark as strictly confidential
                <span className="mt-0.5 block text-xs text-ink-500 dark:text-ink-400">
                  Restricts this to the Dean and Principal. Use this for
                  anything sensitive.
                </span>
              </span>
            </label>

            {submit.isError && !Object.keys(errors).length && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-700 dark:text-red-300"
              >
                {submit.error?.message}
              </p>
            )}
          </div>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" loading={submit.isPending}>
            File complaint
          </Button>
        </div>
      </form>
    </div>
  );
}
