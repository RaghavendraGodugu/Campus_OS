import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  KeyRound,
  LogOut,
  Pencil,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";

import { apiGet, apiPatch, apiPost } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDateTime, humanise } from "../lib/format";
import { Card, Stat } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import AvatarPicker from "../components/AvatarPicker";
import NotificationPreferences from "../components/NotificationPreferences";
import Field, { inputClass } from "../components/ui/Field";
import { ErrorState } from "../components/ui/States";
import {
  SkeletonHeading,
  SkeletonPanel,
  SkeletonRegion,
} from "../components/ui/Skeleton";

/**
 * A person's own profile.
 *
 * ## The division is stated, not implied
 *
 * The page shows what the person owns — name, phone — beside what the
 * institution owns — programme, roll number, semester, role, department — and
 * says plainly that the second group is not editable here. Someone looking at
 * their roll number and finding no edit control should be told *why*, rather
 * than left to conclude the application is broken.
 *
 * ## The server is the authority on that line
 *
 * The refusal comes from `PATCH /profile`, which names the field it will not
 * accept and why. If this page ever offered something the server refuses, the
 * refusal is shown rather than swallowed.
 */
export default function Profile() {
  const { user, refresh } = useAuth();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const {
    data,
    isLoading,
    isError,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ["profile"],
    queryFn: () => apiGet("/profile"),
  });

  const save = useMutation({
    mutationFn: () => apiPatch("/profile", { fullName, phone }),
    onSuccess: async (response) => {
      setEditing(false);
      setNotice("Your profile has been updated.");
      setError(null);
      queryClient.setQueryData(["profile"], response);
      // The shell shows the name, so it has to hear about the change.
      await refresh({ silent: true });
    },
    onError: (failure) => {
      setError(failure.message);
      setNotice(null);
    },
  });

  const signOutEverywhere = useMutation({
    mutationFn: () => apiPost("/profile/sign-out-everywhere", {}),
    onSuccess: (response) => {
      queryClient.clear();
      setNotice(response.message);
    },
    onError: (failure) => setError(failure.message),
  });

  if (isLoading)
    return (
      <SkeletonRegion label="Loading your profile">
        <div className="space-y-6">
          <SkeletonHeading />
          <div className="grid gap-4 sm:grid-cols-2">
            <SkeletonPanel lines={3} />
            <SkeletonPanel lines={3} />
          </div>
          <SkeletonPanel lines={5} />
        </div>
      </SkeletonRegion>
    );
  if (isError) {
    return (
      <ErrorState
        title="Profile not available"
        message={loadError?.message}
        onRetry={() => refetch()}
      />
    );
  }

  const profile = data.data;
  const { user: account, student } = profile;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Your profile
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          What the college knows about you, and what you may change.
        </p>
      </header>

      {notice && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/12 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200"
        >
          <Check className="size-4" aria-hidden="true" />
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {/*
        The picture is its own card rather than a field inside "Your details".
        It is an upload with a preview and a size limit, not a text value, and
        burying it among editable fields makes it look like part of the same
        single-purpose form.
      */}
      <Card
        title="Notifications"
        description="Which things are allowed to ring the bell."
      >
        <NotificationPreferences
          preferences={account.notificationPreferences}
        />
      </Card>

      <Card title="Profile picture">
        <AvatarPicker
          userId={account.id}
          hasAvatar={Boolean(account.hasAvatar)}
        />
      </Card>

      {/* ===== What you own ===== */}
      <Card
        title="Your details"
        actions={
          !editing && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setFullName(account.fullName);
                setPhone(account.phone ?? "");
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </Button>
          )
        }
      >
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
            className="space-y-4"
          >
            <Field label="Full name" htmlFor="fullName" required>
              <input
                id="fullName"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                maxLength={150}
                className={inputClass}
              />
            </Field>

            <Field
              label="Phone"
              htmlFor="phone"
              hint="Optional. Used to reach you about a request."
            >
              <input
                id="phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                maxLength={20}
                placeholder="+91 98765 43210"
                className={inputClass}
              />
            </Field>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={save.isPending}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Name" value={account.fullName} />
            <Detail label="Email" value={account.email} />
            <Detail label="Phone" value={account.phone} />
            <Detail label="Role" value={humanise(account.role)} />
          </dl>
        )}
      </Card>

      {/* ===== What the institution owns ===== */}
      {student && (
        <Card
          title="Academic record"
          description="Maintained by the college. Contact the records office if something here is wrong."
        >
          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail label="Roll number" value={student.rollNumber} />
            <Detail label="Programme" value={student.program?.name} />
            <Detail label="Department" value={student.department?.name} />
            <Detail label="Semester" value={student.semester} />
            <Detail label="Year" value={student.year} />
            <Detail label="Section" value={student.section} />
            <Detail label="Batch" value={student.batchYear} />
            <Detail
              label="Fee status"
              value={<Badge status={student.feeStatus} />}
            />
          </dl>
        </Card>
      )}

      {!student && profile.department && (
        <Card title="Department">
          <Detail label="Department" value={profile.department.name} />
        </Card>
      )}

      {/* ===== Account ===== */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Member since"
          value={formatDate(account.createdAt)}
          icon={UserIcon}
        />
        <Stat
          label="Last sign-in"
          value={
            account.lastLoginAt ? formatDateTime(account.lastLoginAt) : "—"
          }
          hint={`${profile.account.loginCount} in total`}
          icon={ShieldCheck}
        />
        <Stat
          label="Your access"
          value={String(profile.permissions.length)}
          hint={`thing${profile.permissions.length === 1 ? "" : "s"} you are permitted to do`}
          icon={ShieldCheck}
        />
      </div>

      <PasswordSection />

      <Card
        title="Security"
        description="Signs out every other device, including one you no longer have."
      >
        <Button
          variant="secondary"
          loading={signOutEverywhere.isPending}
          onClick={() => signOutEverywhere.mutate()}
        >
          <LogOut className="size-4" aria-hidden="true" />
          Sign out everywhere
        </Button>
      </Card>

      <details className="rounded-xl bg-white dark:bg-surface px-5 py-4 shadow-sm ring-1 ring-ink-200/70 dark:ring-ink-600">
        <summary className="cursor-pointer text-sm font-medium text-ink-800">
          What my role can do ({profile.permissions.length})
        </summary>
        <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
          Decided by the server from your role, and re-checked on every request.
          This list is here so you can see it, not to control it.
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {profile.permissions.map((permission) => (
            <li
              key={permission}
              className="rounded bg-ink-50 dark:bg-ink-100/40 px-2 py-0.5 font-mono text-[11px] text-ink-600"
            >
              {permission}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Change the password. Separate because it has its own confirmation step. */
function PasswordSection() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const change = useMutation({
    mutationFn: () =>
      apiPost("/profile/change-password", {
        currentPassword: current,
        newPassword: next,
      }),
    onSuccess: () => {
      setOpen(false);
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
      setNotice("Password changed. Every other device has been signed out.");
    },
    onError: (failure) => setError(failure.message),
  });

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 12;

  return (
    <Card
      title="Password"
      description="Changing it signs out every other device."
      actions={
        !open && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <KeyRound className="size-3.5" aria-hidden="true" />
            Change
          </Button>
        )
      }
    >
      {notice && (
        <p
          role="status"
          className="mb-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/12 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200"
        >
          {notice}
        </p>
      )}

      {!open ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">
          Last changed — the audit trail records when.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (mismatch || tooShort) return;
            change.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Current password" htmlFor="current-password" required>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field
            label="New password"
            htmlFor="new-password"
            required
            hint="At least 12 characters, with an upper-case letter, a lower-case letter and a number."
            error={tooShort ? "Too short — at least 12 characters" : null}
          >
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              className={inputClass}
              aria-invalid={tooShort || undefined}
            />
          </Field>

          <Field
            label="Confirm new password"
            htmlFor="confirm-password"
            required
            error={mismatch ? "The two passwords do not match" : null}
          >
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className={inputClass}
              aria-invalid={mismatch || undefined}
            />
          </Field>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-700 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={change.isPending}
              disabled={
                mismatch ||
                tooShort ||
                next.length === 0 ||
                current.length === 0
              }
            >
              Change password
            </Button>
          </div>
        </form>
      )}

      {!open && (
        <p className="mt-3 flex items-start gap-2 text-xs text-ink-400 dark:text-ink-500">
          <AlertTriangle
            className="mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
          Use a password you do not use anywhere else.
        </p>
      )}
    </Card>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-ink-500 dark:text-ink-400 uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink-800">{value ?? "—"}</dd>
    </div>
  );
}
