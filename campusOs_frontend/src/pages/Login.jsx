import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { BadgeCheck, ShieldCheck, Sparkles, Eye, EyeOff } from "lucide-react";

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
  const { login, completeTwoFactor, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Non-null once the password is accepted but the second factor is not.
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState("");

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
      const result = await login(email.trim(), password);

      if (result?.twoFactorRequired) {
        // The password was right; this is not yet a session.
        setChallenge(result.challenge);
        setSubmitting(false);
        return;
      }
    } catch (failure) {
      setError(failure.message);
      setSubmitting(false);
    }
  };

  const submitCode = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await completeTwoFactor(challenge.token, code.trim());
      // On success the context flips to authenticated and this page unmounts.
    } catch (failure) {
      setError(failure.message);
      setCode("");
      setSubmitting(false);
    }
  };

  // Back to the password step: the challenge is deliberately not reused.
  const backToPassword = () => {
    setChallenge(null);
    setCode("");
    setError(null);
  };

  // Not named `useDemo`: a `use` prefix marks this as a hook to the linter and
  // to anyone reading it, and it is not one.
  const applyDemoAccount = (demoEmail) => {
    setEmail(demoEmail);
    setPassword("Demo@Campus123");
    setError(null);
  };

  return (
    <div className="relative flex min-h-screen overflow-hidden">
      {/* ===== Brand panel ===== */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-brand-ink p-12 text-white lg:flex">
        <div
          aria-hidden="true"
          className="liquid-mesh pointer-events-none absolute inset-0"
        />
        <div
          aria-hidden="true"
          className="liquid-blob pointer-events-none absolute -top-28 -right-24 size-96 bg-accent-400/25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="grid-texture pointer-events-none absolute inset-0 opacity-40"
        />

        <div className="relative flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 place-items-center rounded-xl bg-linear-to-br from-white/25 to-white/10 text-base font-bold ring-1 ring-white/25 ring-inset backdrop-blur-sm"
          >
            C
          </span>
          <span className="text-xl font-semibold tracking-tight">CampusOS</span>
        </div>

        <div className="relative max-w-md">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-xs font-medium text-brand-100 dark:text-brand-200 ring-1 ring-white/20 ring-inset">
            <Sparkles className="size-3" aria-hidden="true" />
            One system, eight roles
          </span>
          <h1 className="mt-5 text-4xl leading-[1.1] font-semibold tracking-tight">
            One place for requests, certificates and fees.
          </h1>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-brand-100/90 dark:text-brand-200/90">
            Every action is recorded, and you always see exactly what you are
            entitled to — nothing more, nothing less.
          </p>

          <ul className="mt-8 space-y-3">
            {[
              "Apply for a certificate and track it to issue",
              "Raise a grievance that is confidential from the moment it is filed",
              "See every rupee owed, paid and refunded",
            ].map((line) => (
              <li
                key={line}
                className="flex items-start gap-2.5 text-sm text-brand-100/85 dark:text-brand-200/85"
              >
                <BadgeCheck
                  className="mt-0.5 size-4 shrink-0 text-accent-300"
                  aria-hidden="true"
                />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-brand-200/80 dark:text-brand-100/80">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Session cookies are HttpOnly. No password is ever stored in this
          browser.
        </p>
      </div>

      {/* ===== Form ===== */}
      <div className="relative flex w-full flex-col justify-center px-6 py-12 lg:w-1/2">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span
              aria-hidden="true"
              className="aurora grid size-9 place-items-center rounded-xl text-sm font-bold text-white shadow-brand"
            >
              C
            </span>
            <span className="text-lg font-semibold tracking-tight text-ink-900">
              CampusOS
            </span>
          </div>

          <div className="surface-raised p-6 sm:p-7">
            {challenge ? (
              <form onSubmit={submitCode} className="space-y-5" noValidate>
                <h2 className="text-xl font-semibold tracking-tight text-ink-900">
                  Enter your code
                </h2>
                <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
                  Six digits from your authenticator app for{" "}
                  <span className="font-medium text-ink-700 dark:text-ink-200">
                    {challenge.maskedAccount}
                  </span>
                  . A recovery code works too.
                </p>

                <Field label="Code" htmlFor="code" required>
                  <input
                    id="code"
                    name="code"
                    type="text"
                    inputMode="text"
                    // Six digits normally, but recovery codes are letters, so no
                    // numeric-only autocomplete here.
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className={inputClass}
                    placeholder="123456"
                  />
                </Field>

                {error && (
                  <p
                    role="alert"
                    className="rounded-xl bg-red-50 dark:bg-red-500/12 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-400/25 ring-inset"
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
                  Verify
                </Button>

                <button
                  type="button"
                  onClick={backToPassword}
                  className="w-full text-center text-sm font-medium text-brand-700 dark:text-brand-300 transition-colors hover:text-brand-900 dark:hover:text-brand-100"
                >
                  Use a different account
                </button>
              </form>
            ) : (
              <>
                <h2 className="text-xl font-semibold tracking-tight text-ink-900">
                  Sign in
                </h2>
                <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
                  Use your college account.
                </p>

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
                    <div className="relative">
                      <input
                        id="password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className={inputClass}
                        placeholder="••••••••"
                        data-testid="password-input"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-ink-500 hover:text-ink-600 dark:hover:text-ink-300"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                      </button>
                    </div>
                  </Field>

                  {error && (
                    <p
                      role="alert"
                      className="rounded-xl bg-red-50 dark:bg-red-500/12 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-400/25 ring-inset"
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
              </>
            )}

            <div className="mt-5 text-center">
              <Link
                to="/forgot-password"
                className="text-sm font-medium text-brand-700 transition-colors hover:text-brand-900 dark:text-brand-300 dark:hover:text-brand-100"
              >
                Forgotten your password?
              </Link>
            </div>

            {/* Someone holding a paper certificate is the other kind of visitor
              to this page, and they have no account. */}
            <div className="mt-6 rounded-2xl border border-dashed border-brand-200 dark:border-brand-400/25 bg-brand-50/60 dark:bg-brand-500/12 p-4">
              <p className="text-sm font-medium text-ink-800">
                Just checking a certificate?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                Verify one by its printed code — no account needed.
              </p>
              <Link
                to="/verify"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 dark:text-brand-300 transition-colors hover:text-brand-900"
              >
                Verify a certificate
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>

          {import.meta.env.VITE_SHOW_DEMO_BANNER === "true" && (
            <div className="mt-10 border-t border-ink-200 dark:border-ink-700/70 pt-6">
              <p className="text-xs font-medium tracking-wide text-ink-500 dark:text-ink-400 uppercase">
                Demo accounts
              </p>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                Shared password{" "}
                <code className="font-mono">Demo@Campus123</code>
              </p>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => applyDemoAccount(account.email)}
                    className="rounded-xl border border-ink-200/90 dark:border-ink-700/70 bg-surface px-2.5 py-2 text-left text-xs shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-raised"
                  >
                    <span className="block font-medium text-ink-800">
                      {account.label}
                    </span>
                    <span className="block truncate text-[11px] text-ink-500 dark:text-ink-400">
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
