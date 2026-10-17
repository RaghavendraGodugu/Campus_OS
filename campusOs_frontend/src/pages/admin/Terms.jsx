import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarRange,
  CheckCircle2,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";

import { apiDelete, apiGet, apiPatch, apiPost } from "../../api/client";
import { formatDate, humanise } from "../../lib/format";
import Button from "../../components/ui/Button";
import Field, { inputClass } from "../../components/ui/Field";
import Modal from "../../components/ui/Modal";
import { EmptyState, ErrorState } from "../../components/ui/States";
import { SkeletonList, SkeletonRegion } from "../../components/ui/Skeleton";
import AdminLayout from "./AdminLayout";

/**
 * Academic terms.
 *
 * ## Why this screen exists
 *
 * Without terms, "how many certificates did we issue this semester?" is answered
 * by a date range somebody typed. Two people typing it produce two answers and
 * neither can be shown to be right. With terms the answer is a record, and a
 * report can name the term it covers.
 *
 * ## Creating a term does not open it
 *
 * A term typed up in June for a semester starting in July should not start
 * accepting fees because someone saved the form. Opening is a separate, named
 * action, and it is the one that closes the previous term — so the button says
 * so, rather than offering a generic "Edit".
 *
 * ## The destructive actions are not grouped
 *
 * Opening, closing and deleting all sit side by side in a table of buttons,
 * because grouping them behind one "Manage" menu is how somebody intending to
 * close a term deletes it. Each is labelled with what it actually does.
 */

const KINDS = ["SEMESTER", "TRIMESTER", "ACADEMIC_YEAR"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function Terms() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [errors, setErrors] = useState({});

  const list = useQuery({
    queryKey: ["academic-terms"],
    queryFn: () => apiGet("/academic-terms"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["academic-terms"] });
    queryClient.invalidateQueries({ queryKey: ["academic-term"] });
  };

  const create = useMutation({
    mutationFn: (payload) => apiPost("/academic-terms", payload),
    onSuccess: () => {
      invalidate();
      setCreating(false);
      setErrors({});
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  const update = useMutation({
    mutationFn: ({ id, payload }) => apiPatch(`/academic-terms/${id}`, payload),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setErrors({});
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  const act = useMutation({
    mutationFn: ({ id, action }) => apiPost(`/academic-terms/${id}/${action}`),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id) => apiDelete(`/academic-terms/${id}`),
    onSuccess: () => {
      invalidate();
      setConfirming(null);
    },
  });

  const terms = list.data?.data?.terms ?? [];
  const open = terms.find((term) => term.isCurrent);

  return (
    <AdminLayout
      title="Academic terms"
      description="Which term a fee, certificate or report belongs to."
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New term
        </Button>
      }
    >
      <div className="space-y-4">
        {/*
          The current term is stated on its own, above the table.
        */}
        <section
          aria-label="Currently open term"
          className="surface flex flex-wrap items-center justify-between gap-4 px-5 py-4"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2
              className="mt-0.5 size-5 text-brand-700 dark:text-brand-300"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">
                {open ? open.name : "No term is currently open"}
              </h2>
              <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                {open
                  ? `${open.code} · ${formatDate(open.startsOn)} to ${formatDate(open.endsOn)} · ${open.academicYear}`
                  : "New fees, certificates and requests cannot be attributed to a term until one is opened."}
              </p>
            </div>
          </div>

          {open && (
            <Button
              variant="secondary"
              onClick={() => act.mutate({ id: open._id, action: "close" })}
              disabled={act.isPending}
            >
              <XCircle className="size-4" aria-hidden="true" />
              Close this term
            </Button>
          )}
        </section>

        {list.isLoading ? (
          <SkeletonRegion label="Loading academic terms">
            <SkeletonList rows={4} />
          </SkeletonRegion>
        ) : list.isError ? (
          <ErrorState
            message={list.error?.message}
            onRetry={() => list.refetch()}
          />
        ) : terms.length === 0 ? (
          <EmptyState
            title="No terms yet"
            description="Create the current term so records can be attributed to it."
          />
        ) : (
          <ul className="divide-y divide-ink-100/80 dark:divide-ink-700/50">
            {terms.map((term) => (
              <li
                key={term._id}
                className="flex flex-wrap items-center gap-4 px-1 py-4"
              >
                <CalendarRange
                  className="size-5 shrink-0 text-ink-400 dark:text-ink-500"
                  aria-hidden="true"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-900 dark:text-ink-100">
                      {term.name}
                    </span>
                    <span className="text-xs text-ink-500 dark:text-ink-400">
                      {term.code}
                    </span>
                    {term.isCurrent && (
                      /*
                        Not a status badge. "Generated" is the certificate
                        vocabulary, borrowed by accident, and on a term it reads
                        as though the term had been issued by something.
                      */
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[0.6875rem] font-medium text-brand-800 ring-1 ring-brand-600/20 ring-inset dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-400/25">
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                        Current
                      </span>
                    )}
                  </div>

                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                    {humanise(term.kind)} · {term.academicYear} ·{" "}
                    {formatDate(term.startsOn)} to {formatDate(term.endsOn)}
                  </p>

                  {term.counts && (
                    <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                      {term.counts.students} students · {term.counts.invoices}{" "}
                      invoices · {term.counts.certificates} certificates
                    </p>
                  )}
                </div>

                {/*
                  Three separate, plainly-labelled actions rather than one
                  "Manage" menu. Opening closes whichever term was open before,
                  so it must not be one click away from deleting.
                */}
                <div className="flex items-center gap-2">
                  {!term.isCurrent && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        act.mutate({ id: term._id, action: "open" })
                      }
                      disabled={act.isPending}
                    >
                      Open
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(term)}
                  >
                    Edit
                  </Button>

                  {!term.isCurrent && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirming(term)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating && (
        <TermDialog
          title="New term"
          submitLabel="Create term"
          pending={create.isPending}
          errors={errors}
          onClose={() => {
            setCreating(false);
            setErrors({});
          }}
          onSubmit={(payload) => create.mutate(payload)}
          defaults={{
            startsOn: todayIso(),
            endsOn: todayIso(),
            kind: "SEMESTER",
          }}
        />
      )}

      {editing && (
        <TermDialog
          title={`Edit ${editing.name}`}
          submitLabel="Save changes"
          pending={update.isPending}
          errors={errors}
          term={editing}
          onClose={() => {
            setEditing(null);
            setErrors({});
          }}
          onSubmit={(payload) => update.mutate({ id: editing._id, payload })}
          defaults={{
            name: editing.name,
            kind: editing.kind,
            academicYear: editing.academicYear,
            startsOn: String(editing.startsOn).slice(0, 10),
            endsOn: String(editing.endsOn).slice(0, 10),
            notes: editing.notes ?? "",
          }}
        />
      )}

      {confirming && (
        <Modal
          title="Delete this term?"
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(null)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                onClick={() => remove.mutate(confirming._id)}
                disabled={remove.isPending}
              >
                Delete term
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-700 dark:text-ink-300">
            {confirming.name} will be removed. Its invoices and certificates are
            not deleted — they keep whatever term they were issued under.
          </p>
        </Modal>
      )}
    </AdminLayout>
  );
}

/** The create/edit form. Dates are plain YYYY-MM-DD: a datetime picker for a
 *  term boundary is a worse control than a date input, because the boundary is
 * a day and nothing in the college happens at 03:00. */
function TermDialog({
  title,
  submitLabel,
  pending,
  errors,
  term,
  defaults,
  onClose,
  onSubmit,
}) {
  const [form, setForm] = useState(defaults);
  const set = (key) => (event) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const closed = term?.status === "CLOSED";

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(form)} disabled={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {closed && (
          <p className="rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-800 dark:bg-accent-500/10 dark:text-accent-200">
            This term is closed. Its name and notes can still be corrected, but
            its dates cannot move — every figure reported against it was
            measured inside that window.
          </p>
        )}

        <Field label="Name" htmlFor="term-name" required error={errors.name}>
          <input
            id="term-name"
            value={form.name}
            onChange={set("name")}
            maxLength={80}
            placeholder="Autumn 2026"
            className={inputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" htmlFor="term-code" required error={errors.code}>
            <input
              id="term-code"
              value={defaults.code ?? form.code ?? ""}
              onChange={set("code")}
              maxLength={24}
              placeholder="A26"
              className={inputClass}
            />
          </Field>

          <Field
            label="Academic year"
            htmlFor="term-year"
            required
            error={errors.academicYear}
          >
            <input
              id="term-year"
              value={form.academicYear}
              onChange={set("academicYear")}
              placeholder="2026-27"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Kind" htmlFor="term-kind">
          <select
            id="term-kind"
            value={form.kind}
            onChange={set("kind")}
            className={inputClass}
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {humanise(kind)}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Starts on"
            htmlFor="term-start"
            required
            error={errors.startsOn}
          >
            <input
              id="term-start"
              type="date"
              value={form.startsOn}
              onChange={set("startsOn")}
              disabled={closed}
              className={inputClass}
            />
          </Field>

          <Field
            label="Ends on"
            htmlFor="term-end"
            required
            error={errors.endsOn}
          >
            <input
              id="term-end"
              type="date"
              value={form.endsOn}
              onChange={set("endsOn")}
              disabled={closed}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Notes" htmlFor="term-notes">
          <textarea
            id="term-notes"
            value={form.notes ?? ""}
            onChange={set("notes")}
            rows={2}
            maxLength={500}
            className={inputClass}
          />
        </Field>
      </div>
    </Modal>
  );
}
