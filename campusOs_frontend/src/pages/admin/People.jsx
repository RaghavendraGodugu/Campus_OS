import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  KeyRound,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  UserX,
} from "lucide-react";

import { apiGet, apiPost } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { humanise, initials } from "../../lib/format";
import Button from "../../components/ui/Button";
import Field, { inputClass } from "../../components/ui/Field";
import Modal from "../../components/ui/Modal";
import Badge from "../../components/ui/Badge";
import Pagination from "../../components/ui/Pagination";
import { EmptyState, ErrorState } from "../../components/ui/States";
import { SkeletonList, SkeletonRegion } from "../../components/ui/Skeleton";
import AdminLayout from "./AdminLayout";
import { ASSIGNABLE_ROLES, DEPARTMENT_REQUIRED_ROLES } from "./constants";

/**
 * People.
 *
 * ## The three dangerous actions are three separate dialogs, not one menu
 *
 * Changing a role, switching an account off and resetting a password are
 * different acts with different consequences, and each server route demands a
 * written reason. Grouping them behind one "Manage" button is how a role change
 * happens because somebody was aiming for Deactivate.
 *
 * ## The temporary password is shown once, in the dialog that created it
 *
 * It cannot be retrieved later — it is stored only as a bcrypt hash — so if the
 * administrator closes the dialog without copying it, the only remedy is to
 * reset again. The dialog says that in as many words, and offers the copy
 * rather than hoping it is noticed.
 */

export default function People() {
  const queryClient = useQueryClient();
  // From the auth context, not the query cache. Reading the cache with a
  // guessed key silently yields undefined, which makes every row look like
  // somebody else's — and then the row offers you actions on yourself.
  const { user: me } = useAuth();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deactivating, setDeactivating] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [issued, setIssued] = useState(null);

  const list = useQuery({
    queryKey: ["admin", "users", page, applied, roleFilter],
    queryFn: () =>
      apiGet(
        `/admin/users?page=${page}&limit=25${applied ? `&search=${encodeURIComponent(applied)}` : ""}${roleFilter ? `&role=${roleFilter}` : ""}`,
      ),
  });

  const departments = useQuery({
    queryKey: ["admin", "departments", "picker"],
    queryFn: () => apiGet("/admin/departments"),
  });

  const afterChange = () => {
    queryClient.invalidateQueries({ queryKey: ["admin"] });
  };

  const users = list.data?.data ?? [];
  const pagination = list.data?.meta?.pagination;

  return (
    <AdminLayout
      title="People"
      description="Accounts, roles and access. A role change signs the person out everywhere, so old permissions cannot outlive it."
      actions={
        <Button size="lg" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" aria-hidden="true" />
          Add an account
        </Button>
      }
    >
      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200/70 dark:border-ink-700/60 px-4 py-3.5 sm:px-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(search.trim());
              setPage(1);
            }}
            className="relative min-w-56 flex-1"
          >
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-400 dark:text-ink-500"
              aria-hidden="true"
            />
            <label htmlFor="user-search" className="sr-only">
              Search people
            </label>
            <input
              id="user-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or email"
              className={`${inputClass} pl-10`}
            />
          </form>

          <label htmlFor="role-filter" className="sr-only">
            Filter by role
          </label>
          <select
            id="role-filter"
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter(event.target.value);
              setPage(1);
            }}
            className={`${inputClass} w-auto min-w-44`}
          >
            <option value="">Every role</option>
            {ASSIGNABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {humanise(role)}
              </option>
            ))}
          </select>
        </div>

        {list.isLoading && (
          <SkeletonRegion label="Loading Loading accounts">
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

        {!list.isLoading && !list.isError && users.length === 0 && (
          <EmptyState
            icon={Users}
            title="No accounts match"
            description={
              applied || roleFilter
                ? "Try a different search or role."
                : "Add the first account to get started."
            }
          />
        )}

        {users.length > 0 && (
          <ul className="divide-y divide-ink-100/90">
            {users.map((person) => (
              <PersonRow
                key={person.id ?? person._id}
                person={person}
                isMe={person.id === me?.id}
                onEdit={() => setEditing(person)}
                onDeactivate={() => setDeactivating(person)}
                onReset={() => setResetting(person)}
              />
            ))}
          </ul>
        )}

        {pagination && (
          <Pagination
            page={pagination.page}
            limit={pagination.limit}
            total={pagination.total}
            onPage={setPage}
          />
        )}
      </div>

      <CreateUserDialog
        open={creating}
        onClose={() => setCreating(false)}
        departments={departments.data?.data ?? []}
        onCreated={(result) => {
          setCreating(false);
          setIssued(result);
          afterChange();
        }}
      />

      <ChangeRoleDialog
        person={editing}
        departments={departments.data?.data ?? []}
        onClose={() => setEditing(null)}
        onDone={() => {
          setEditing(null);
          afterChange();
        }}
      />

      <ReasonDialog
        open={Boolean(deactivating)}
        person={deactivating}
        title="Deactivate this account"
        description={
          "They are signed out of every device immediately and cannot sign back in. Everything they handled stays on the record — accounts are switched off, never deleted."
        }
        confirmLabel="Deactivate account"
        danger
        onClose={() => setDeactivating(null)}
        onSubmit={async (reason) => {
          await apiPost(`/admin/users/${deactivating.id}/active`, {
            isActive: false,
            reason,
          });
          setDeactivating(null);
          afterChange();
        }}
      />

      <ReasonDialog
        open={Boolean(resetting)}
        person={resetting}
        title="Reset this password"
        description="Every session they have open is signed out, and a new temporary password is issued. They cannot use the account until they replace it."
        confirmLabel="Reset password"
        onClose={() => setResetting(null)}
        onSubmit={async (reason) => {
          const result = await apiPost(
            `/admin/users/${resetting.id}/reset-password`,
            { reason },
          );
          setResetting(null);
          afterChange();
          setIssued({ ...result, who: resetting.fullName });
        }}
      />

      <TemporaryPasswordDialog
        issued={issued}
        onClose={() => setIssued(null)}
      />
    </AdminLayout>
  );
}

function PersonRow({ person, isMe, onEdit, onDeactivate, onReset }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-4 px-4 py-4 transition-colors hover:bg-ink-50/40 sm:px-5">
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-brand-100 to-brand-50 dark:to-brand-500/12 text-xs font-semibold text-brand-700 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-400/25 ring-inset"
        >
          {initials(person.fullName)}
        </span>

        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
            {person.fullName}
            {isMe && (
              <span className="rounded-md bg-ink-100 dark:bg-ink-200/40 px-1.5 py-0.5 text-[0.6875rem] font-medium text-ink-600">
                You
              </span>
            )}
            {!person.isActive && (
              <span className="rounded-md bg-red-50 dark:bg-red-500/12 px-1.5 py-0.5 text-[0.6875rem] font-medium text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-400/25 ring-inset">
                Deactivated
              </span>
            )}
            {person.mustChangePassword && (
              <span
                title="Still on the temporary password it was created with"
                className="rounded-md bg-amber-50 dark:bg-amber-500/12 px-1.5 py-0.5 text-[0.6875rem] font-medium text-amber-800 dark:text-amber-200 ring-1 ring-amber-200 dark:ring-amber-400/25 ring-inset"
              >
                Awaiting password change
              </span>
            )}
          </p>
          <p className="truncate text-xs text-ink-500 dark:text-ink-400">
            {person.email}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge label={humanise(person.role)} status={person.role} />
            {person.department && (
              <span className="inline-flex items-center gap-1 text-xs text-ink-500 dark:text-ink-400">
                <Building2 className="size-3" aria-hidden="true" />
                {person.department.name}
              </span>
            )}
          </p>
        </div>
      </div>

      {/*
        Self-service actions are hidden on your own row rather than disabled.
        The server refuses them; showing a control that always fails is worse
        than not offering it.
      */}
      {!isMe && (
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={onEdit}>
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Role
          </Button>
          <Button size="sm" variant="secondary" onClick={onReset}>
            <KeyRound className="size-3.5" aria-hidden="true" />
            Reset
          </Button>
          {person.isActive && (
            <Button size="sm" variant="subtle" onClick={onDeactivate}>
              <UserX className="size-3.5" aria-hidden="true" />
              Deactivate
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function CreateUserDialog({ open, onClose, departments, onCreated }) {
  const [form, setForm] = useState({
    email: "",
    fullName: "",
    role: "",
    department: "",
    phone: "",
  });
  const [errors, setErrors] = useState({});

  const set = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const needsDepartment = DEPARTMENT_REQUIRED_ROLES.includes(form.role);

  const submit = useMutation({
    mutationFn: () =>
      apiPost("/admin/users", {
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        role: form.role,
        department: form.department || undefined,
        phone: form.phone.trim() || undefined,
      }),
    onSuccess: (response) => {
      setForm({ email: "", fullName: "", role: "", department: "", phone: "" });
      onCreated({
        email: response.data.email,
        temporaryPassword: response.meta.temporaryPassword,
        notice: response.meta.notice,
      });
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an account"
      description="A temporary password is generated and shown once. The account cannot be used until its holder replaces it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submit.isPending}
            disabled={!form.email || !form.fullName || !form.role}
            onClick={() => {
              setErrors({});
              submit.mutate();
            }}
          >
            Create account
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Full name"
            htmlFor="new-fullName"
            required
            error={errors.fullName}
          >
            <input
              id="new-fullName"
              value={form.fullName}
              onChange={set("fullName")}
              className={inputClass}
            />
          </Field>

          <Field
            label="Email"
            htmlFor="new-email"
            required
            error={errors.email}
          >
            <input
              id="new-email"
              type="email"
              value={form.email}
              onChange={set("email")}
              className={inputClass}
              placeholder="name@campusos.local"
            />
          </Field>

          <Field
            label="Role"
            htmlFor="new-role"
            required
            error={errors.role}
            hint="This decides what they can see and do."
          >
            <select
              id="new-role"
              value={form.role}
              onChange={set("role")}
              className={inputClass}
            >
              <option value="">Choose a role…</option>
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {humanise(role)}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Department"
            htmlFor="new-department"
            required={needsDepartment}
            error={errors.department}
            hint={
              needsDepartment
                ? "Required — this role's permissions are scoped to one."
                : "Optional for this role."
            }
          >
            <select
              id="new-department"
              value={form.department}
              onChange={set("department")}
              className={inputClass}
              disabled={!form.role}
            >
              <option value="">None</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Phone"
            htmlFor="new-phone"
            optional
            error={errors.phone}
            className="sm:col-span-2"
          >
            <input
              id="new-phone"
              value={form.phone}
              onChange={set("phone")}
              placeholder="+91 98765 43210"
              className={inputClass}
            />
          </Field>
        </div>

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

function ChangeRoleDialog({ person, departments, onClose, onDone }) {
  const [role, setRole] = useState("");
  const [department, setDepartment] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState(false);

  // Reset whenever a different person is opened, so the last one's reason never
  // lingers under a new name.
  const key = person?.id ?? null;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setRole(person?.role ?? "");
    setDepartment(person?.department?.id ?? "");
    setReason("");
    setErrors({});
    setTouched(false);
  }

  const needsDepartment = DEPARTMENT_REQUIRED_ROLES.includes(role);

  const submit = useMutation({
    mutationFn: () =>
      apiPost(`/admin/users/${person.id}/role`, {
        role,
        department: department || null,
        reason: reason.trim(),
      }),
    onSuccess: onDone,
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  const reasonTooShort = touched && reason.trim().length < 10;

  return (
    <Modal
      open={Boolean(person)}
      onClose={onClose}
      title={person ? `Change ${person.fullName}'s role` : "Change role"}
      description="They are signed out of every device, so the old permissions cannot linger in a live session."
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
              setErrors({});
              submit.mutate();
            }}
          >
            Change role
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
        <Field label="Role" htmlFor="edit-role" required error={errors.role}>
          <select
            id="edit-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className={inputClass}
          >
            {ASSIGNABLE_ROLES.map((option) => (
              <option key={option} value={option}>
                {humanise(option)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Department"
          htmlFor="edit-department"
          required={needsDepartment}
          error={errors.department}
        >
          <select
            id="edit-department"
            value={department ?? ""}
            onChange={(event) => setDepartment(event.target.value)}
            className={inputClass}
          >
            <option value="">None</option>
            {departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Reason"
          htmlFor="edit-reason"
          required
          error={
            reasonTooShort
              ? "Give a reason of at least 10 characters"
              : errors.reason
          }
          hint="Recorded in the audit trail. Six months from now, this is the only thing that explains the change."
        >
          <textarea
            id="edit-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            className={`${inputClass} resize-y`}
          />
        </Field>

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

/** Deactivating and resetting both need a written reason. One dialog, two uses. */
function ReasonDialog({
  open,
  person,
  title,
  description,
  confirmLabel,
  danger,
  onClose,
  onSubmit,
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const submit = useMutation({
    mutationFn: () => onSubmit(reason.trim()),
    onSuccess: () => {
      setReason("");
      setTouched(false);
    },
  });

  const tooShort = touched && reason.trim().length < 10;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={
        person ? `${person.fullName} · ${person.email}` : description
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={submit.isPending}
            onClick={() => {
              setTouched(true);
              if (reason.trim().length < 10) return;
              submit.mutate();
            }}
          >
            {confirmLabel}
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
        <p className="flex items-start gap-2.5 rounded-xl bg-ink-50 dark:bg-ink-100/40 px-3.5 py-3 text-xs leading-relaxed text-ink-600 ring-1 ring-ink-200 dark:ring-ink-600 ring-inset">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-ink-400 dark:text-ink-500"
            aria-hidden="true"
          />
          {description}
        </p>

        <Field
          label="Reason"
          htmlFor="reason-dialog"
          required
          error={tooShort ? "Give a reason of at least 10 characters" : null}
        >
          <textarea
            id="reason-dialog"
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

/**
 * The only moment the temporary password is ever visible.
 *
 * It is not stored in plaintext anywhere, so there is nothing to fetch later.
 * That is a security property worth paying for, but it means this dialog has to
 * say what happens if it is closed.
 */
function TemporaryPasswordDialog({ issued, onClose }) {
  const [copied, setCopied] = useState(false);

  return (
    <Modal
      open={Boolean(issued)}
      onClose={onClose}
      title="Temporary password"
      description="This is the only time it will be shown."
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Give this to{" "}
          <strong className="font-medium text-ink-900">
            {issued?.email ?? issued?.who}
          </strong>{" "}
          directly. They will be asked to replace it the first time they sign
          in, and the account does nothing until they do.
        </p>

        <div className="surface flex items-center justify-between gap-3 px-4 py-3.5">
          <code className="select-all font-mono text-sm tracking-wider break-all text-ink-900">
            {issued?.temporaryPassword}
          </code>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard?.writeText(
                issued.temporaryPassword ?? "",
              );
              setCopied(true);
            }}
          >
            {copied ? (
              <>
                <BadgeCheck className="size-3.5" aria-hidden="true" />
                Copied
              </>
            ) : (
              "Copy"
            )}
          </Button>
        </div>

        <p className="rounded-xl bg-amber-50 dark:bg-amber-500/12 px-3.5 py-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200 ring-1 ring-amber-200 dark:ring-amber-400/25 ring-inset">
          If you close this without copying it, the password cannot be recovered
          — only reset. That is deliberate: it is stored only as a hash, so
          nobody, including an administrator with database access, can read it
          back.
        </p>
      </div>
    </Modal>
  );
}
