import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";

import { apiPost } from "../api/client";

/**
 * Confirm an email address.
 *
 * ## No form
 *
 * There is nothing to fill in: the link *is* the confirmation, and the page acts
 * on it as soon as it opens. Making somebody press a button to prove they clicked
 * an email adds a step and proves nothing.
 *
 * ## Deliberately silent about the outcome on failure
 *
 * A link that has already been used, expired, or was never real all say the same
 * thing. Which of those it was does not help the person holding it, and
 * distinguishing them turns this into a way to test whether a token exists.
 */
export default function VerifyEmail() {
  const [token] = useState(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
  );

  const verify = useMutation({
    mutationFn: (value) => apiPost("/auth/verify-email", { token: value }),
    // Fired once from the initial state rather than an effect.
    onSuccess: () => {},
  });

  const [sent, setSent] = useState(false);
  if (token && !sent && verify.isIdle) {
    setSent(true);
    verify.mutate(token);
  }

  const failed = verify.isError;

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="surface-raised w-full max-w-md p-6 text-center sm:p-7">
        {verify.isPending && (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">
              Confirming your address
            </h1>
            <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
              One moment.
            </p>
          </>
        )}

        {verify.isSuccess && (
          <>
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              <CheckCircle2 className="size-6" aria-hidden="true" />
            </span>
            <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">
              Email confirmed
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-500 dark:text-ink-400">
              Your college can reach you at this address, and password resets
              will arrive here.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-flex text-sm font-medium text-brand-700 transition-colors hover:text-brand-900 dark:text-brand-300 dark:hover:text-brand-100"
            >
              Sign in
            </Link>
          </>
        )}

        {failed && (
          <>
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
              <XCircle className="size-6" aria-hidden="true" />
            </span>
            <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">
              That link did not work
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-500 dark:text-ink-400">
              Confirmation links work once and last 24 hours. If you are signed
              in, ask for a new one from your profile.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-flex text-sm font-medium text-brand-700 transition-colors hover:text-brand-900 dark:text-brand-300 dark:hover:text-brand-100"
            >
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
