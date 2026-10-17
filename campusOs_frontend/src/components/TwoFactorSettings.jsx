import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";

import { apiPost } from "../api/client";
import Button from "./ui/Button";
import Field, { inputClass } from "./ui/Field";

/**
 * Two-factor sign-in.
 *
 * ## No QR code
 *
 * The usual flow shows a QR code scanned by the app. That needs a QR encoder —
 * a real dependency for a picture of six words. The app can type the secret, so
 * this shows the secret and the `otpauth://` link instead: one dependency fewer,
 * and the same enrolments work.
 *
 * ## The secret is shown once, and the recovery codes are shown once
 *
 * Both are handed out only at the moment they are generated. The server keeps a
 * hash of the recovery codes and an encrypted secret, and never returns them
 * again, so this is the only chance to copy them down.
 */
export default function TwoFactorSettings({ enabled, onChange }) {
  const [step, setStep] = useState(null);
  const [enrolment, setEnrolment] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setStep(null);
    setEnrolment(null);
    setRecoveryCodes(null);
    setCode("");
    setError(null);
    setCopied(false);
  };

  const start = useMutation({
    mutationFn: () => apiPost("/auth/2fa/enrol"),
    onSuccess: (response) => {
      setEnrolment(response.data);
      setStep("confirm");
      setError(null);
    },
    onError: (failure) => setError(failure.message),
  });

  const confirm = useMutation({
    mutationFn: () => apiPost("/auth/2fa/confirm", { code: code.trim() }),
    onSuccess: (response) => {
      setRecoveryCodes(response.data.recoveryCodes);
      setStep("codes");
      setCode("");
      setError(null);
      onChange?.();
    },
    onError: (failure) => {
      setError(failure.message);
      setCode("");
    },
  });

  const turnOff = useMutation({
    mutationFn: () => apiPost("/auth/2fa/disable", { code: code.trim() }),
    onSuccess: () => {
      reset();
      onChange?.();
    },
    onError: (failure) => {
      setError(failure.message);
      setCode("");
    },
  });

  const copySecret = async () => {
    await navigator.clipboard.writeText(enrolment.secret);
    setCopied(true);
  };

  // ===== Recovery codes: the one time they are ever shown =====
  if (step === "codes") {
    return (
      <div>
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/12 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-200">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Save these now. Each one works once, and they will not be shown
            again. Keep them somewhere other than your phone.
          </span>
        </p>

        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-sm text-ink-800 dark:text-ink-100 sm:grid-cols-2">
          {recoveryCodes.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>

        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" onClick={reset}>
            I have saved them
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              navigator.clipboard.writeText(recoveryCodes.join("\n"))
            }
          >
            <Copy className="size-3.5" aria-hidden="true" />
            Copy all
          </Button>
        </div>
      </div>
    );
  }

  // ===== Turning it on: secret first, then a working code =====
  if (step === "confirm" || step === "disable") {
    const turningOff = step === "disable";

    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (turningOff) turnOff.mutate();
          else confirm.mutate();
        }}
        className="space-y-4"
      >
        {!turningOff && enrolment && (
          <div>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              In your app, choose "add account" then "enter a setup key", and
              paste this. Then type the six digits it shows.
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-ink-100 dark:bg-ink-800 px-3 py-2 font-mono text-sm tracking-wider text-ink-900 dark:text-ink-50 break-all">
                {enrolment.secret}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={copySecret}
                aria-label="Copy the setup key"
              >
                {copied ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
        )}

        <Field
          label={
            turningOff ? "Enter a code to turn this off" : "Six-digit code"
          }
          htmlFor="two-factor-code"
          required
        >
          <input
            id="two-factor-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
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
            className="rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-700 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            type="submit"
            loading={confirm.isPending || turnOff.isPending}
          >
            {turningOff ? "Turn off" : "Turn on"}
          </Button>
          <Button size="sm" variant="ghost" onClick={reset}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  // ===== The normal state =====
  return (
    <div>
      <p className="text-sm text-ink-500 dark:text-ink-400">
        {enabled
          ? "On. Your password alone will not sign you in."
          : "Off. Your password is the only thing protecting this account."}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="mt-3">
        {enabled ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setStep("disable")}
          >
            <ShieldOff className="size-3.5" aria-hidden="true" />
            Turn off
          </Button>
        ) : (
          <Button
            size="sm"
            loading={start.isPending}
            onClick={() => start.mutate()}
          >
            <KeyRound className="size-3.5" aria-hidden="true" />
            Turn on
          </Button>
        )}
      </div>
    </div>
  );
}
