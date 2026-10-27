import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Plus, Search, XCircle } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "../../api/client";
import Button from "../../components/ui/Button";
import Field, { inputClass } from "../../components/ui/Field";
import Modal from "../../components/ui/Modal";
import { EmptyState, ErrorState } from "../../components/ui/States";
import { SkeletonList, SkeletonRegion } from "../../components/ui/Skeleton";
import AdminLayout from "./AdminLayout";

/**
 * The service catalogue.
 *
 * ## The number of fields is the whole point
 *
 * A request type is not a label on a form — it *is* the form. It defines the
 * questions a student is asked and the documents they are told to bring. So the
 * list shows that shape at a glance: how many questions, which ones are
 * mandatory, and what will be demanded. An administrator choosing between two
 * similar services needs to see that, not a name.
 *
 * Editing a service's name must not quietly delete its questions. The schema
 * behind this screen drops defaults for exactly that reason, and there is a
 * test that says so.
 */
export default function RequestTypes() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [retiring, setRetiring] = useState(null);

  const list = useQuery({
    queryKey: ["admin", "request-types", applied],
    queryFn: () =>
      apiGet(
        `/admin/request-types?includeInactive=true${applied ? `&search=${encodeURIComponent(applied)}` : ""}`,
      ),
  });

  const departments = useQuery({
    queryKey: ["admin", "departments", "picker"],
    queryFn: () => apiGet("/admin/departments"),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });
  const types = list.data?.data ?? [];

  return (
    <AdminLayout
      title="Services"
      description="What students can ask for. Each service defines its own questions and the documents it requires — editing one changes what every student is asked next time."
      actions={
        <Button size="lg" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New service
        </Button>
      }
    >
      <div className="surface overflow-hidden">
        <div className="border-b border-ink-200/70 dark:border-ink-700/60 px-4 py-3.5 sm:px-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(search.trim());
            }}
            className="relative max-w-sm"
          >
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-400 dark:text-ink-500"
              aria-hidden="true"
            />
            <label htmlFor="service-search" className="sr-only">
              Search services
            </label>
            <input
              id="service-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or code"
              className={`${inputClass} pl-10`}
            />
          </form>
        </div>

        {list.isLoading && (
          <SkeletonRegion label="Loading Loading services">
            <SkeletonList rows={8} />
          </SkeletonRegion>
        )}
        {list.isError && (
          <div className="p-5">
            <ErrorState
              message={list.error?.message}
              onRetry={() => list.refetch()}
            />
          </div>
        )}
        {!list.isLoading && !list.isError && types.length === 0 && (
          <EmptyState
            icon={ListChecks}
            title="No services yet"
            description="Add the services students can ask for."
          />
        )}

        {types.length > 0 && (
          <ul className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
            {types.map((type) => (
              <li
                key={type.id}
                className="flex flex-wrap items-start justify-between gap-4 px-4 py-4 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900 dark:text-ink-100">
                    {type.name}
                    {!type.isActive && (
                      <span className="rounded-md bg-red-50 dark:bg-red-500/12 px-1.5 py-0.5 text-[0.6875rem] font-medium text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-400/25 ring-inset">
                        Retired
                      </span>
                    )}
                  </p>

                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                    <span className="font-mono">{type.code}</span>
                    {type.department && ` · ${type.department.name}`}
                  </p>

                  {type.description && (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-600 dark:text-ink-300">
                      {type.description}
                    </p>
                  )}

                  {/* The shape of the form a student will actually fill in. */}
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-md bg-ink-100/80 dark:bg-ink-800 px-1.5 py-0.5 text-[0.6875rem] text-ink-600 dark:text-ink-300">
                      {(type.fields?.length ?? 0) === 0
                        ? "No extra questions"
                        : `${type.fields.length} question${type.fields.length === 1 ? "" : "s"}`}
                    </span>

                    {type.fields
                      ?.filter((field) => field.required)
                      .slice(0, 3)
                      .map((field) => (
                        <span
                          key={field.name}
                          className="rounded-md bg-amber-50 dark:bg-amber-500/12 px-1.5 py-0.5 text-[0.6875rem] text-amber-800 dark:text-amber-200 ring-1 ring-amber-200 dark:ring-amber-400/25 ring-inset"
                        >
                          {field.label} required
                        </span>
                      ))}

                    {Number(type.requiredDocuments?.length ?? 0) > 0 && (
                      <span className="rounded-md bg-brand-50 dark:bg-brand-500/15 px-1.5 py-0.5 text-[0.6875rem] text-brand-700 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-400/25 ring-inset">
                        {type.requiredDocuments.length} document
                        {type.requiredDocuments.length === 1 ? "" : "s"}{" "}
                        required
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditing(type)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => setRetiring(type)}
                  >
                    <XCircle className="size-3.5" aria-hidden="true" />
                    {type.isActive ? "Retire" : "Restore"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ServiceForm
        open={creating}
        departments={departments.data?.data ?? []}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false);
          refresh();
        }}
      />

      <ServiceForm
        open={Boolean(editing)}
        service={editing}
        departments={departments.data?.data ?? []}
        onClose={() => setEditing(null)}
        onDone={() => {
          setEditing(null);
          refresh();
        }}
      />

      <RetireDialog
        service={retiring}
        onClose={() => setRetiring(null)}
        onDone={() => {
          setRetiring(null);
          refresh();
        }}
      />
    </AdminLayout>
  );
}

function ServiceForm({ open, service, departments, onClose, onDone }) {
  const [form, setForm] = useState({
    name: "",
    code: "",
    description: "",
    department: "",
  });
  const [errors, setErrors] = useState({});

  const key = service?.id ?? "new";
  const [lastKey, setLastKey] = useState(key);
  const current = open ? key : lastKey;
  if (current !== lastKey) {
    setLastKey(current);
    setForm({
      name: service?.name ?? "",
      code: service?.code ?? "",
      description: service?.description ?? "",
      department: service?.department?.id ?? "",
    });
    setErrors({});
  }

  const set = (field) => (event) =>
    setForm((f) => ({ ...f, [field]: event.target.value }));

  // Only the fields the caller touched are sent. Sending `fields: []` on a
  // rename would delete every question the service asks.
  const payload = () => {
    const base = { name: form.name.trim(), code: form.code.trim() };
    if (form.description.trim()) base.description = form.description.trim();
    if (form.department) base.department = form.department;
    return base;
  };

  const submit = useMutation({
    mutationFn: () =>
      service
        ? apiPatch(`/admin/request-types/${service.id}`, payload())
        : apiPost("/admin/request-types", payload()),
    onSuccess: onDone,
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={service ? "Edit service" : "New service"}
      description={
        service
          ? "Only what you change is sent — its questions and required documents are left exactly as they are."
          : "Start with the name and code. Questions and documents can be added after."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submit.isPending}
            disabled={!form.name || !form.code}
            onClick={() => {
              setErrors({});
              submit.mutate();
            }}
          >
            {service ? "Save changes" : "Create"}
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
          htmlFor="service-name"
          required
          error={errors.name}
          hint="What a student sees in the catalogue."
        >
          <input
            id="service-name"
            value={form.name}
            onChange={set("name")}
            className={inputClass}
            placeholder="Bonafide certificate"
          />
        </Field>

        <Field
          label="Code"
          htmlFor="service-code"
          required
          error={errors.code}
          hint="Letters, numbers and underscores. Used in reference numbers."
        >
          <input
            id="service-code"
            value={form.code}
            onChange={set("code")}
            className={`${inputClass} font-mono uppercase`}
            placeholder="BONAFIDE"
            maxLength={30}
          />
        </Field>

        <Field
          label="Owning department"
          htmlFor="service-department"
          optional
          error={errors.department}
          hint="Which office handles it."
        >
          <select
            id="service-department"
            value={form.department}
            onChange={set("department")}
            className={inputClass}
          >
            <option value="">Not specified</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Description"
          htmlFor="service-description"
          optional
          error={errors.description}
        >
          <textarea
            id="service-description"
            rows={3}
            value={form.description}
            onChange={set("description")}
            maxLength={1000}
            className={`${inputClass} resize-y`}
            placeholder="What the student gets, and what they will need."
          />
        </Field>

        {service && (
          <p className="rounded-xl bg-ink-50 dark:bg-ink-800/50 px-3.5 py-3 text-xs leading-relaxed text-ink-600 dark:text-ink-300 ring-1 ring-ink-200 dark:ring-ink-600 ring-inset">
            This service asks {service.fields?.length ?? 0} question
            {(service.fields?.length ?? 0) === 1 ? "" : "s"} and requires{" "}
            {service.requiredDocuments?.length ?? 0} document
            {(service.requiredDocuments?.length ?? 0) === 1 ? "" : "s"}. Those
            are left untouched by this form.
          </p>
        )}

        {submit.isError && !Object.keys(errors).length && (
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

function RetireDialog({ service, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const retiring = service && service.isActive;

  const submit = useMutation({
    mutationFn: () =>
      apiPost(`/admin/request-types/${service.id}/active`, {
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
      open={Boolean(service)}
      onClose={onClose}
      title={retiring ? `Retire ${service?.name}` : `Restore ${service?.name}`}
      description={
        retiring
          ? "It disappears from the student catalogue. Requests already filed keep the definition they were filed under, and the server refuses this while any are still open."
          : "It reappears in the catalogue and can be requested again."
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
          htmlFor="service-reason"
          required
          error={
            touched && reason.trim().length < 10
              ? "Give a reason of at least 10 characters"
              : null
          }
        >
          <textarea
            id="service-reason"
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
