import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Search, UserRound, XCircle } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "../../api/client";
import Button from "../../components/ui/Button";
import Field, { inputClass } from "../../components/ui/Field";
import Modal from "../../components/ui/Modal";
import { EmptyState, ErrorState, Loading } from "../../components/ui/States";
import AdminLayout from "./AdminLayout";

/**
 * Departments.
 *
 * A department is not only a label: it is an HOD's permission scope, the
 * routing target for requests and complaints, and the grouping for reports.
 *
 * That is why this screen refuses to retire one that still has people or
 * programmes on it, rather than letting it disappear from dropdowns while
 * hundreds of records quietly point at an office that no longer exists. The
 * server enforces it; the screen says so before you find out by being refused.
 */
export default function Departments() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [retiring, setRetiring] = useState(null);

  const list = useQuery({
    queryKey: ["admin", "departments", applied],
    queryFn: () =>
      apiGet(
        `/admin/departments?includeInactive=true${applied ? `&search=${encodeURIComponent(applied)}` : ""}`,
      ),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });
  const departments = list.data?.data ?? [];

  return (
    <AdminLayout
      title="Departments"
      description="The unit of institutional organisation: an HOD's scope, where requests are routed, and how reports group."
      actions={
        <Button size="lg" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New department
        </Button>
      }
    >
      <div className="surface overflow-hidden">
        <div className="border-b border-ink-200/70 px-4 py-3.5 sm:px-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(search.trim());
            }}
            className="relative max-w-sm"
          >
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-400"
              aria-hidden="true"
            />
            <label htmlFor="department-search" className="sr-only">
              Search departments
            </label>
            <input
              id="department-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or code"
              className={`${inputClass} pl-10`}
            />
          </form>
        </div>

        {list.isLoading && <Loading label="Loading departments" />}
        {list.isError && (
          <div className="p-5">
            <ErrorState
              message={list.error?.message}
              onRetry={() => list.refetch()}
            />
          </div>
        )}
        {!list.isLoading && !list.isError && departments.length === 0 && (
          <EmptyState
            icon={Building2}
            title="No departments yet"
            description="Add the first one to give requests somewhere to be routed."
          />
        )}

        {departments.length > 0 && (
          <ul className="divide-y divide-ink-100/90">
            {departments.map((department) => (
              <li
                key={department.id}
                className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5"
              >
                <div className="flex min-w-0 items-start gap-3.5">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-accent-100 to-accent-50 text-[0.6875rem] font-bold text-accent-700 ring-1 ring-accent-200 ring-inset"
                  >
                    {department.code?.slice(0, 3)}
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                      {department.name}
                      {!department.isActive && (
                        <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[0.6875rem] font-medium text-red-700 ring-1 ring-red-200 ring-inset">
                          Retired
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-ink-500">
                      {department.code}
                    </p>
                    {department.hod && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-500">
                        <UserRound className="size-3" aria-hidden="true" />
                        {department.hod.fullName}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditing(department)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => setRetiring(department)}
                  >
                    <XCircle className="size-3.5" aria-hidden="true" />
                    {department.isActive ? "Retire" : "Restore"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DepartmentForm
        open={creating}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false);
          refresh();
        }}
      />

      <DepartmentForm
        open={Boolean(editing)}
        department={editing}
        onClose={() => setEditing(null)}
        onDone={() => {
          setEditing(null);
          refresh();
        }}
      />

      <RetireDialog
        department={retiring}
        onClose={() => setRetiring(null)}
        onDone={() => {
          setRetiring(null);
          refresh();
        }}
      />
    </AdminLayout>
  );
}

function DepartmentForm({ open, department, onClose, onDone }) {
  const [form, setForm] = useState({ name: "", code: "" });
  const [errors, setErrors] = useState({});

  const key = department?.id ?? "new";
  const [lastKey, setLastKey] = useState(key);
  if ((open ? key : lastKey) !== lastKey || (!open && lastKey !== "new")) {
    setLastKey(open ? key : "new");
    setForm({
      name: department?.name ?? "",
      code: department?.code ?? "",
    });
    setErrors({});
  }

  const submit = useMutation({
    mutationFn: () =>
      department
        ? apiPatch(`/admin/departments/${department.id}`, form)
        : apiPost("/admin/departments", form),
    onSuccess: onDone,
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={department ? "Edit department" : "New department"}
      description={
        department
          ? "Changing the code affects new reference numbers; existing ones are untouched."
          : "The code is used in reference numbers and on printed documents."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submit.isPending}
            disabled={!form.name || !form.code}
            onClick={() => submit.mutate()}
          >
            {department ? "Save changes" : "Create"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit.mutate();
        }}
        className="space-y-4"
      >
        <Field
          label="Name"
          htmlFor="department-name"
          required
          error={errors.name}
        >
          <input
            id="department-name"
            value={form.name}
            onChange={(event) =>
              setForm((f) => ({ ...f, name: event.target.value }))
            }
            className={inputClass}
            placeholder="Computer Science & Engineering"
          />
        </Field>

        <Field
          label="Code"
          htmlFor="department-code"
          required
          error={errors.code}
          hint="Letters, numbers and hyphens. Used in reference numbers and on documents."
        >
          <input
            id="department-code"
            value={form.code}
            onChange={(event) =>
              setForm((f) => ({ ...f, code: event.target.value }))
            }
            className={`${inputClass} font-mono uppercase`}
            placeholder="CSE"
            maxLength={20}
          />
        </Field>

        {submit.isError && !Object.keys(errors).length && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-200 ring-inset"
          >
            {submit.error?.message}
          </p>
        )}
      </form>
    </Modal>
  );
}

function RetireDialog({ department, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const retiring = department && department.isActive;

  const submit = useMutation({
    mutationFn: () =>
      apiPost(`/admin/departments/${department.id}/active`, {
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
      open={Boolean(department)}
      onClose={onClose}
      title={
        retiring ? `Retire ${department?.name}` : `Restore ${department?.name}`
      }
      description={
        retiring
          ? "It will disappear from every dropdown. Anything still assigned to it must be moved first — the server will refuse this until then."
          : "It will reappear in every dropdown and can be assigned to again."
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
          htmlFor="department-reason"
          required
          error={
            touched && reason.trim().length < 10
              ? "Give a reason of at least 10 characters"
              : null
          }
        >
          <textarea
            id="department-reason"
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
            className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-200 ring-inset"
          >
            {submit.error?.message}
          </p>
        )}
      </form>
    </Modal>
  );
}
