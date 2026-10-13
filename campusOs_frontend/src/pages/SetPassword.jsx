import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";

import { apiPost } from "../api/client";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";

/**
 * Set a password for an account an administrator created.
 *
 * ## Why this page exists at all
 *
 * An account is provisioned with a generated password that the institute holds
 * until it is replaced. Left alone, that account would work on a credential
 * known to two parties, for ever. So the account is flagged, and until the flag
 * is cleared this is the only page reachable — no shell, no navigation, no
 * requests to any other screen.
 *
 * That gate is a convenience, not a control. The server enforces every
 * permission normally either way; what it guarantees is that the person is not
 * *shown* anything they should not have seen on the way past.
 *
 * ## The temporary password has to be entered first
 *
 * The person arrived here holding a password someone typed for them. They have
 * to prove they received it before choosing their own, or anyone could take over
 * a colleague's account by guessing that a new account exists.
 */
export default function SetPassword() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState(null);

  const submit = useMutation({
    mutationFn: () =>
      apiPost("/profile/change-password", {
        currentPassword: current,
        newPassword: next,
      }),
    onSuccess: async () => {
      // Changing the password clears every session, this one included, so the
      // only correct next step is a fresh sign-in.
      await logout();
      navigate("/login", { replace: true });
    },
    onError: (failure) => setError(failure.message),
  });

  const tooShort = next.length > 0 && next.length < 12;
  const mismatch = confirm.length > 0 && next !== confirm;
  const ready =
    current.length > 0 && next.length >= 12 && !mismatch && confirm.length > 0;

  const onSubmit = (event) => {
    event.preventDefault();
    setTouched(true);
    if (!ready) return;
    setError(null);
    submit.mutate();
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="grid-texture absolute inset-0 opacity-60" />
        <div className="absolute -top-32 -left-24 size-[32rem] rounded-full bg-brand-400/25 blur-3xl" />
        <div className="absolute -right-24 -bottom-32 size-[30rem] rounded-full bg-accent-300/25 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="aurora grid size-11 place-items-center rounded-xl text-base font-bold text-white shadow-brand"
          >
            C
          </span>
          <span className="text-lg font-semibold tracking-tight text-ink-900">
            CampusOS
          </span>
        </div>

        <div className="surface-raised p-6 sm:p-7">
          <span className="grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-200 ring-inset">
            <KeyRound className="size-6" aria-hidden="true" />
          </span>

          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">
            Choose your password
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
            Hello {user?.fullName?.split(" ")[0] ?? "there"}. Your account was
            set up by an administrator with a temporary password, which they
            still know. Choose your own to replace it.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <Field
              label="Temporary password"
              htmlFor="current"
              required
              hint="The password an administrator gave you."
            >
              <input
                id="current"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                className={inputClass}
              />
            </Field>

            <Field
              label="New password"
              htmlFor="new"
              required
              error={tooShort ? "Too short — at least 12 characters" : null}
              hint="At least 12 characters, with an upper-case letter, a lower-case letter and a number."
            >
              <input
                id="new"
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
              htmlFor="confirm"
              required
              error={mismatch ? "The two passwords do not match" : null}
            >
              <input
                id="confirm"
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
                className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-200 ring-inset"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              loading={submit.isPending}
              disabled={!ready}
              className="w-full"
            >
              Set password and sign in
            </Button>

            {touched && !ready && (
              <p className="text-xs text-ink-500">
                Enter the temporary password, then a new one of at least 12
                characters, and confirm it.
              </p>
            )}
          </form>

          <button
            type="button"
            onClick={logout}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out instead
          </button>
        </div>

        <p className="mt-4 flex items-start justify-center gap-2 px-2 text-center text-xs text-ink-500">
          <ShieldCheck
            className="mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
          Changing your password signs out every other device.
        </p>
      </div>
    </div>
  );
}
