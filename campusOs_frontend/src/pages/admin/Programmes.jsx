import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Plus, Search, XCircle } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "../../api/client";
import { humanise } from "../../lib/format";
import Button from "../../components/ui/Button";
import Field, { inputClass } from "../../components/ui/Field";
import Modal from "../../components/ui/Modal";
import { EmptyState, ErrorState, Loading } from "../../components/ui/States";
import AdminLayout from "./AdminLayout";
import { PROGRAM_LEVELS } from "./constants";

/**
 * Programmes.
 *
 * A programme is what a student's certificate, transcript and fee are issued
 * against, so its name and level are printed on documents. That is why the
 * level vocabulary here matches the model exactly rather than using shorter
 * aliases: "UNDERGRADUATE" on a transcript and "UG" in a dropdown are two
 * different facts about the same thing.
 *
 * Retiring one is refused while students are still on it, for the same reason
 * departments are: a retired programme silently drops those students out of
 * every dropdown they use.
 */
export default function Programmes() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [level, setLevel] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [retiring, setRetiring] = useState(null);

  const list = useQuery({
    queryKey: ["admin", "programs", applied, level],
    queryFn: () =>
      apiGet(
        `/admin/programs?includeInactive=true${applied ? `&search=${encodeURIComponent(applied)}` : ""}${level ? `&level=${level}` : ""}`,
      ),
  });

  const departments = useQuery({
    queryKey: ["admin", "departments", "picker"],
    queryFn: () => apiGet("/admin/departments"),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });
  const programmes = list.data?.data ?? [];

  return (
    <AdminLayout
      title="Programmes"
      description="What students are enrolled on, and what their certificates and transcripts are issued against."
      actions={
        <Button size="lg" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New programme
        </Button>
      }
    >
      <div className="surface overflow-hidden">
        <div className="flex flex-wrap gap-3 border-b border-ink-200/70 dark:border-ink-700/60 px-4 py-3.5 sm:px-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(search.trim());
            }}
            className="relative min-w-56 flex-1"
          >
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-400 dark:text-ink-500"
              aria-hidden="true"
            />
            <label htmlFor="programme-search" className="sr-only">
              Search programmes
            </label>
            <input
              id="programme-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or code"
              className={`${inputClass} pl-10`}
            />
          </form>

          <label htmlFor="level-filter" className="sr-only">
            Filter by level
          </label>
          <select
            id="level-filter"
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className={`${inputClass} w-auto min-w-48`}
          >
            <option value="">Every level</option>
            {PROGRAM_LEVELS.map((option) => (
              <option key={option} value={option}>
                {humanise(option)}
              </option>
            ))}
          </select>
        </div>

        {list.isLoading && <Loading label="Loading programmes" />}
        {list.isError && (
          <div className="p-5">
            <ErrorState
              message={list.error?.message}
              onRetry={() => list.refetch()}
            />
          </div>
        )}
        {!list.isLoading && !list.isError && programmes.length === 0 && (
          <EmptyState
            icon={GraduationCap}
            title="No programmes yet"
            description="Add the programmes students are enrolled on."
          />
        )}

        {programmes.length > 0 && (
          <ul className="divide-y divide-ink-100/90">
            {programmes.map((programme) => (
              <li
                key={programme.id}
                className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5"
              >
                <div className="flex min-w-0 items-start gap-3.5">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-brand-100 to-brand-50 dark:to-brand-500/12 dark:to-brand-500/15 text-brand-700 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-400/25 ring-inset"
                  >
                    <GraduationCap className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                      {programme.name}
                      {!programme.isActive && (
                        <span className="rounded-md bg-red-50 dark:bg-red-500/12 px-1.5 py-0.5 text-[0.6875rem] font-medium text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-400/25 ring-inset">
                          Retired
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                      <span className="font-mono">{programme.code}</span>
                      {" · "}
                      {humanise(programme.level)}
                      {" · "}
                      {programme.durationYears} year
                      {programme.durationYears === 1 ? "" : "s"}
                      {programme.department &&
                        ` · ${programme.department.name}`}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditing(programme)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => setRetiring(programme)}
                  >
                    <XCircle className="size-3.5" aria-hidden="true" />
                    {programme.isActive ? "Retire" : "Restore"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ProgrammeForm
        open={creating}
        departments={departments.data?.data ?? []}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false);
          refresh();
        }}
      />

      <ProgrammeForm
        open={Boolean(editing)}
        programme={editing}
        departments={departments.data?.data ?? []}
        onClose={() => setEditing(null)}
        onDone={() => {
          setEditing(null);
          refresh();
        }}
      />

      <RetireProgrammeDialog
        programme={retiring}
        onClose={() => setRetiring(null)}
        onDone={() => {
          setRetiring(null);
          refresh();
        }}
      />
    </AdminLayout>
  );
}

function ProgrammeForm({ open, programme, departments, onClose, onDone }) {
  const [form, setForm] = useState({
    name: "",
    code: "",
    department: "",
    level: "",
    durationYears: 4,
  });
  const [errors, setErrors] = useState({});

  const key = programme?.id ?? "new";
  const [lastKey, setLastKey] = useState(key);
  const current = open ? key : lastKey;
  if (current !== lastKey) {
    setLastKey(current);
    setForm({
      name: programme?.name ?? "",
      code: programme?.code ?? "",
      department: programme?.department?.id ?? "",
      level: programme?.level ?? "",
      durationYears: programme?.durationYears ?? 4,
    });
    setErrors({});
  }

  const set = (field) => (event) =>
    setForm((currentForm) => ({ ...currentForm, [field]: event.target.value }));

  const submit = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim(),
        department: form.department,
        level: form.level,
        durationYears: Number(form.durationYears),
      };
      return programme
        ? apiPatch(`/admin/programs/${programme.id}`, payload)
        : apiPost("/admin/programs", payload);
    },
    onSuccess: onDone,
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={programme ? "Edit programme" : "New programme"}
      description="The name, code and level are printed on certificates and transcripts."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submit.isPending}
            disabled={
              !form.name || !form.code || !form.department || !form.level
            }
            onClick={() => submit.mutate()}
          >
            {programme ? "Save changes" : "Create"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit.mutate();
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field
          label="Name"
          htmlFor="programme-name"
          required
          error={errors.name}
          className="sm:col-span-2"
        >
          <input
            id="programme-name"
            value={form.name}
            onChange={set("name")}
            className={inputClass}
            placeholder="B.Tech Computer Science"
          />
        </Field>

        <Field
          label="Code"
          htmlFor="programme-code"
          required
          error={errors.code}
        >
          <input
            id="programme-code"
            value={form.code}
            onChange={set("code")}
            className={`${inputClass} font-mono uppercase`}
            placeholder="BTCS"
            maxLength={20}
          />
        </Field>

        <Field
          label="Department"
          htmlFor="programme-department"
          required
          error={errors.department}
        >
          <select
            id="programme-department"
            value={form.department}
            onChange={set("department")}
            className={inputClass}
          >
            <option value="">Choose a department…</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Level"
          htmlFor="programme-level"
          required
          error={errors.level}
        >
          <select
            id="programme-level"
            value={form.level}
            onChange={set("level")}
            className={inputClass}
          >
            <option value="">Choose a level…</option>
            {PROGRAM_LEVELS.map((option) => (
              <option key={option} value={option}>
                {humanise(option)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Duration"
          htmlFor="programme-duration"
          required
          error={errors.durationYears}
          hint="In years, printed on the transcript."
        >
          <input
            id="programme-duration"
            type="number"
            min={1}
            max={10}
            value={form.durationYears}
            onChange={set("durationYears")}
            className={inputClass}
          />
        </Field>

        {submit.isError && !Object.keys(errors).length && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 dark:bg-red-500/12 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-400/25 ring-inset sm:col-span-2"
          >
            {submit.error?.message}
          </p>
        )}
      </form>
    </Modal>
  );
}

function RetireProgrammeDialog({ programme, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const retiring = programme && programme.isActive;

  const submit = useMutation({
    mutationFn: () =>
      apiPost(`/admin/programs/${programme.id}/active`, {
        isActive: !retiring,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setReason("");
      setTouched(false);
      onDone();
    },
  });

  return (
    <Modal
      open={Boolean(programme)}
      onClose={onClose}
      title={
        retiring ? `Retire ${programme?.name}` : `Restore ${programme?.name}`
      }
      description={
        retiring
          ? "It will disappear from every dropdown. The server refuses this while students are still enrolled."
          : "It will reappear in every dropdown and can be enrolled onto again."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submit.isPending}
            onClick={() => {
              setTouched(true);
              if (reason.trim().length < 10) return;
              submit.mutate();
            }}
          >
            {retiring ? "Retire" : "Restore"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (reason.trim().length < 10) return;
          submit.mutate();
        }}
        className="space-y-4"
      >
        <Field
          label="Reason"
          htmlFor="programme-reason"
          required
          error={
            touched && reason.trim().length < 10
              ? "Give a reason of at least 10 characters"
              : null
          }
        >
          <textarea
            id="programme-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            className={`${inputClass} resize-y`}
          />
        </Field>

        {submit.isError && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 dark:bg-red-500/12 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-400/25 ring-inset"
          >
            {submit.error?.message}
          </p>
        )}
      </form>
    </Modal>
  );
}
