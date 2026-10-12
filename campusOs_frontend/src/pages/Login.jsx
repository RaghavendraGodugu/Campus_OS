import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { GraduationCap, ShieldCheck } from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { DEMO_ACCOUNTS } from "../lib/nav";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";

/**
 * Sign in.
 *
 * ## Why the credentials are never stored
 *
 * There is no "remember me" here, and that is deliberate. The server sets an
 * HttpOnly session cookie the browser manages on its own; writing the password
 * or a token into localStorage would make a single XSS on this origin enough to
 * take the session, and localStorage is readable by anything that runs here.
 *
 * ## Why the error is honest but not revealing
 *
 * "Invalid email or password" for both cases, so the form cannot be used to
 * discover which addresses are registered. A missing field says which field is
 * missing, because that helps the person in front of the screen and reveals
 * nothing about anyone else.
 */
export default function Login() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) {
    return null;
  }

  if (isAuthenticated) {
    // Return the user to wherever the guard interrupted them.
    const target = location.state?.from?.pathname ?? "/";
    return <Navigate to={target} replace />;
  }

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email.trim(), password);
    } catch (failure) {
      setError(failure.message);
      setSubmitting(false);
    }
  };

  // Not named `useDemo`: a `use` prefix marks this as a hook to the linter and
  // to anyone reading it, and it is not one.
  const applyDemoAccount = (demoEmail) => {
    setEmail(demoEmail);
    setPassword("Demo@Campus123");
    setError(null);
  };

  return (
    <div className="flex min-h-screen">
      {/* ===== Brand panel ===== */}
      <div className="relative hidden w-1/2 flex-col justify-between bg-brand-800 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <GraduationCap className="size-8" aria-hidden="true" />
          <span className="text-xl font-semibold tracking-tight">CampusOS</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">
            One place for requests, certificates and fees.
          </h1>
          <p className="mt-4 text-brand-100">
            Every action is recorded, and you always see exactly what you are
            entitled to — nothing more, nothing less.
          </p>
        </div>

        <p className="flex items-center gap-2 text-xs text-brand-200">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Session cookies are HttpOnly. No password is ever stored in this
          browser.
        </p>
      </div>

      {/* ===== Form ===== */}
      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-1/2">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2">
              <GraduationCap
                className="size-7 text-brand-700"
                aria-hidden="true"
              />
              <span className="text-lg font-semibold text-brand-700">
                CampusOS
              </span>
            </div>
          </div>

          <h2 className="text-xl font-semibold text-ink-900">Sign in</h2>
          <p className="mt-1 text-sm text-ink-500">Use your college account.</p>

          <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
            <Field label="Email" htmlFor="email" required>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
                placeholder="you@college.edu"
              />
            </Field>

            <Field label="Password" htmlFor="password" required>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
                placeholder="••••••••"
              />
            </Field>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              loading={submitting}
              className="w-full"
            >
              Sign in
            </Button>
          </form>

          {import.meta.env.VITE_SHOW_DEMO_BANNER === "true" && (
            <div className="mt-10 border-t border-ink-200 pt-6">
              <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">
                Demo accounts
              </p>
              <p className="mt-1 text-xs text-ink-500">
                Shared password{" "}
                <code className="font-mono">Demo@Campus123</code>
              </p>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => applyDemoAccount(account.email)}
                    className="rounded-lg border border-ink-200 px-2.5 py-2 text-left text-xs transition-colors hover:border-brand-300 hover:bg-brand-50"
                  >
                    <span className="block font-medium text-ink-800">
                      {account.label}
                    </span>
                    <span className="block truncate text-[11px] text-ink-500">
                      {account.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
