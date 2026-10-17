import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BadgeCheck, MailQuestion, Send } from "lucide-react";

import { apiPost } from "../api/client";
import Button from "./ui/Button";

/**
 * Whether this address has been proven.
 *
 * ## Why it is on the profile and not buried in settings
 *
 * A student who has lost their password cannot use this page — they cannot sign
 * in. So the way back in has to start somewhere they can still reach, and the
 * honest place to start is the mail inbox the college wrote to. Showing the state
 * here is what tells somebody *which* address to look at.
 *
 * Resending needs a session, unlike requesting a reset. That asymmetry is
 * deliberate: asking to confirm your own address is harmless, but a page anyone
 * could POST to would be a way to mail somebody else.
 */
export default function EmailVerification({ verified }) {
  const [sent, setSent] = useState(false);

  const resend = useMutation({
    mutationFn: () => apiPost("/auth/resend-verification"),
    onSuccess: () => setSent(true),
  });

  if (verified) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300">
        <BadgeCheck
          className="size-4 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        Confirmed
      </p>
    );
  }

  return (
    <div>
      {sent ? (
        <p role="status" className="text-sm text-ink-600 dark:text-ink-300">
          Link sent. It works for 24 hours.
        </p>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          loading={resend.isPending}
          onClick={() => resend.mutate()}
        >
          {resend.isError ? (
            <MailQuestion className="size-3.5" aria-hidden="true" />
          ) : (
            <Send className="size-3.5" aria-hidden="true" />
          )}
          {resend.isError ? "Try again" : "Send the confirmation link"}
        </Button>
      )}

      {resend.isError && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {resend.error.message}
        </p>
      )}
    </div>
  );
}
