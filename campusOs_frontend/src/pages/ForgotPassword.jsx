import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, MailCheck } from "lucide-react";

import { apiPost } from "../api/client";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";

/**
 * Forgot your password.
 *
 * ## The same answer either way
 *
 * Whether the address is registered or not, this page says the same thing. If it
 * said "no account with that address", the form would become a way to list every
 * student and staff member in the college — one request per guess.
 *
 * So there is nothing to see here and nothing to wait for. The message says a link
 * is on its way, and either one is or it is not.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const ask = useMutation({
    mutationFn: () => apiPost("/auth/forgot-password", { email: email.trim() }),
    onSuccess: () => setSent(true),
  });

  if (sent) {
    return (
      <div className="surface-raised mx-auto max-w-md p-6 text-center sm:p-7">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          <MailCheck className="size-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
          Check your inbox
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500 dark:text-ink-400 dark:text-ink-500">
          If{" "}
          <span className="font-medium text-ink-700 dark:text-ink-200">
            {email.trim()}
          </span>{" "}
          has an account, a reset link is on its way. It expires in one hour and
          works once.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-500 dark:text-ink-400 dark:text-ink-500">
          Nothing arrived? The address may not be registered, or the message may
          have been filtered as spam.
        </p>

        <Link
          to="/login"
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 transition-colors hover:text-brand-900 dark:text-brand-300 dark:hover:text-brand-100"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="surface-raised w-full max-w-md p-6 sm:p-7">
        <h1 className="text-xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
          Reset your password
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
          Tell us your college address and we will send a link.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            ask.mutate();
          }}
          className="mt-6 space-y-5"
          noValidate
        >
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

          {ask.isError && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-200 ring-inset dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/25"
            >
              {ask.error.message}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            loading={ask.isPending}
            className="w-full"
          >
            Send the link
          </Button>
        </form>

        <Link
          to="/login"
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 transition-colors hover:text-brand-900 dark:text-brand-300 dark:hover:text-brand-100"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
