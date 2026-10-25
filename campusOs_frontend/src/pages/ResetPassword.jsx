import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Eye, EyeOff } from "lucide-react";

import { apiPost } from "../api/client";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";

/**
 * Choose a new password.
 *
 * ## The link is checked before anything is typed
 *
 * A dead or expired link should say so immediately rather than after somebody has
 * chosen a password. The check does not spend the token — it only reports whether
 * it would still work.
 *
 * ## No session is started here
 *
 * The person came from an email with a token in it, and this page is not proof
 * they are at that inbox now. Signing in is one click away, and the login page
 * says the other sessions were ended.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  /**
   * Is this link still good?
   *
   * Asked once when the page opens, so somebody is not made to choose a password
   * before being told the link is dead. The token is whatever the URL carried and
   * does not change while the page is up.
   *
   * Set only from the response, never synchronously on mount: a missing token is
   * decided during render instead, from `token` itself.
   */
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    if (!token) return undefined;

    let cancelled = false;

    apiPost(`/auth/reset-password/check?token=${encodeURIComponent(token)}`)
      .then((response) => {
        if (cancelled) return;
        setStatus(response.data.valid ? "valid" : response.data.reason);
      })
      .catch(() => {
        if (!cancelled) setStatus("invalid");
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // A URL with no token never reaches the request at all.
  const linkStatus = token ? status : "invalid";

  const reset = useMutation({
    mutationFn: () => apiPost("/auth/reset-password", { token, password }),
    onSuccess: () => setDone(true),
    onError: (failure) => setError(failure.message),
  });

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 10;

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="surface-raised w-full max-w-md p-6 text-center sm:p-7">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            <CheckCircle2 className="size-6" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
            Password changed
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-500 dark:text-ink-400 dark:text-ink-500">
            Every other session has been signed out. If that was not what you
            wanted, change it again now and tell your college.
          </p>

          <Button
            size="lg"
            className="mt-6 w-full"
            onClick={() => navigate("/login")}
          >
            Go to sign in
          </Button>
        </div>
      </div>
    );
  }

  if (linkStatus !== "valid" && linkStatus !== "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="surface-raised w-full max-w-md p-6 text-center sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
            {linkStatus === "expired"
              ? "That link has expired"
              : "That link is not valid"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-500 dark:text-ink-400 dark:text-ink-500">
            Reset links last one hour and work once. Ask for a new one and use
            it straight away.
          </p>
          <Link
            to="/forgot-password"
            className="mt-6 inline-flex text-sm font-medium text-brand-700 transition-colors hover:text-brand-900 dark:text-brand-300 dark:hover:text-brand-100"
          >
            Send a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="surface-raised w-full max-w-md p-6 sm:p-7">
        <span className="grid size-11 place-items-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          <KeyRound className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
          Choose a new password
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
          At least 10 characters, with an uppercase letter, a lowercase letter
          and a number.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (mismatch || tooShort) return;
            reset.mutate();
          }}
          className="mt-6 space-y-5"
          noValidate
        >
          <Field label="New password" htmlFor="new-password" required>
            <div className="relative">
              <input
                id="new-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500 hover:text-ink-600 dark:hover:text-ink-300"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </div>
          </Field>

          <Field
            label="Type it again"
            htmlFor="confirm-password"
            required
            error={mismatch ? "These do not match" : null}
          >
            <div className="relative">
              <input
                id="confirm-password"
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500 hover:text-ink-600 dark:hover:text-ink-300"
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                {showConfirm ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </div>
          </Field>

          {tooShort && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              That is under 10 characters.
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-200 ring-inset dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/25"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            loading={reset.isPending}
            disabled={mismatch || tooShort}
            className="w-full"
          >
            Set the new password
          </Button>
        </form>
      </div>
    </div>
  );
}
