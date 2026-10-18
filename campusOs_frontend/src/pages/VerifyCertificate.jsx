import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Ban,
  CalendarDays,
  Fingerprint,
  Hash,
  Info,
  Search,
  ShieldQuestion,
} from "lucide-react";

import { apiGet } from "../api/client";
import { formatDate, humanise } from "../lib/format";
import Button from "../components/ui/Button";

/**
 * Public certificate verification.
 *
 * ## This page has no session, and is meant to be reached without one
 *
 * Someone holding a printed certificate is standing at a bank counter, or an
 * admissions office, and needs to know whether it is real. They do not have a
 * CampusOS login and will never have one. So this sits outside the signed-in
 * shell, and the API it calls takes no authentication.
 *
 * ## It reports exactly what the record says, and nothing more
 *
 * Three outcomes, and they are kept distinct because they mean different things
 * to whoever is holding the paper: the code is not recognised, the code is
 * recognised but the certificate was revoked, or the certificate is genuine and
 * currently valid. Collapsing "revoked" into "not valid" would tell a bank
 * nothing useful about whether the student did something wrong.
 *
 * Nothing about the *holder* is shown. The endpoint returns the reference, the
 * type, the dates and the status — deliberately not the student's name — so a
 * verification link cannot be used to find out who studied here.
 */

export default function VerifyCertificate() {
  const [code, setCode] = useState("");

  const verify = useMutation({
    mutationFn: (value) =>
      apiGet(
        `/certificates/verify?code=${encodeURIComponent(value.trim().toUpperCase())}`,
      ),
  });

  const onSubmit = (event) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length >= 6) verify.mutate(trimmed);
  };

  const found = verify.data?.data?.found ?? false;
  const valid = verify.data?.data?.valid ?? false;

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* ===== Backdrop ===== */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-canvas" />
        <div className="grid-texture absolute inset-0 opacity-70" />
        <div className="liquid-blob absolute -top-40 -left-32 size-[34rem] bg-accent-500/25 blur-3xl" />
        <div className="liquid-blob absolute -top-24 right-0 size-[28rem] bg-white/50 blur-3xl" />
        <div className="liquid-blob absolute -bottom-48 left-1/3 size-[32rem] bg-brand-500/6 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-8 sm:px-8">
        {/* ===== Masthead ===== */}
        <header className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="aurora grid size-10 place-items-center rounded-xl text-sm font-bold text-white shadow-brand"
            >
              C
            </span>
            <span className="text-base font-semibold tracking-tight text-ink-900">
              CampusOS
            </span>
          </span>

          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-600 transition-colors hover:bg-white/70 hover:text-brand-800"
          >
            Staff sign in
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </header>

        {/* ===== Hero ===== */}
        <div className="flex flex-1 flex-col justify-center py-12">
          <div className="mx-auto w-full max-w-xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/70 dark:bg-surface/85 px-3 py-1.5 text-xs font-medium text-brand-700 dark:text-brand-300 shadow-card ring-1 ring-brand-200 dark:ring-brand-400/25 ring-inset backdrop-blur-sm">
              <ShieldQuestion className="size-3.5" aria-hidden="true" />
              Open to anyone — no account needed
            </span>

            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-ink-900 sm:text-[2.5rem] sm:leading-[1.1]">
              Is this certificate genuine?
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[0.9375rem] leading-relaxed text-ink-600">
              Type the verification code printed on the certificate. The check
              runs against the institute's own records.
            </p>

            {/* ===== Search ===== */}
            <form onSubmit={onSubmit} className="mt-8">
              <label htmlFor="code" className="sr-only">
                Verification code
              </label>
              <div className="surface-raised flex items-center gap-2 p-2">
                <span className="grid size-10 shrink-0 place-items-center text-ink-400 dark:text-ink-500">
                  <Hash className="size-5" aria-hidden="true" />
                </span>
                <input
                  id="code"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.toUpperCase())
                  }
                  placeholder="CAMPUS-2026-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={24}
                  aria-describedby="code-hint"
                  className="min-w-0 flex-1 bg-transparent py-2 font-mono text-base tracking-wider text-ink-900 uppercase placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-400 focus:outline-none"
                />
                <Button
                  type="submit"
                  size="lg"
                  loading={verify.isPending}
                  disabled={code.trim().length < 6}
                >
                  <Search className="size-4" aria-hidden="true" />
                  Verify
                </Button>
              </div>
              <p
                id="code-hint"
                className="mt-2.5 text-xs text-ink-500 dark:text-ink-400"
              >
                Printed beneath the registrar's seal. Letters and numbers only.
              </p>
            </form>

            {/* ===== Result ===== */}
            {verify.isError && (
              <NotRecognised message={verify.error?.message} />
            )}

            {verify.isSuccess &&
              (!found ? (
                <NotRecognised message="No certificate matches that code." />
              ) : (
                <Result valid={valid} data={verify.data.data} />
              ))}
          </div>
        </div>

        <footer className="pb-2 text-center text-xs text-ink-500 dark:text-ink-400">
          Verification confirms the certificate's status only. It does not
          disclose who it was issued to.
        </footer>
      </div>
    </div>
  );
}

/** The code is not in our records. Deliberately says nothing more. */
function NotRecognised({ message }) {
  return (
    <div
      role="alert"
      className="surface mt-6 flex items-start gap-4 p-5 text-left ring-red-200 dark:ring-red-400/25"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-red-50 dark:bg-red-500/12 text-red-600 dark:text-red-400 ring-1 ring-red-100 dark:ring-red-400/20 ring-inset">
        <Ban className="size-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-semibold text-ink-900">
          No certificate with that code
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          {message} Check for a typo, or for characters that may have been
          smudged in printing.
        </p>
      </div>
    </div>
  );
}

/**
 * The code is recognised. What that means depends entirely on the status, so
 * the two are shown differently rather than as one "valid/invalid" answer.
 */
function Result({ valid, data }) {
  return (
    <div className="mt-6 text-left">
      <div
        className={`surface-raised overflow-hidden ${
          valid
            ? "ring-emerald-200 dark:ring-emerald-400/25"
            : "ring-red-200 dark:ring-red-400/25"
        }`}
      >
        <div
          className={`flex items-center gap-4 px-5 py-5 ${
            valid
              ? "bg-linear-to-r from-emerald-50 dark:from-emerald-500/15 dark:from-emerald-500/12 to-surface"
              : "bg-linear-to-r from-red-50 dark:from-red-500/15 dark:from-red-500/12 to-surface"
          }`}
        >
          <span
            aria-hidden="true"
            className={`grid size-12 shrink-0 place-items-center rounded-2xl shadow-card ${
              valid
                ? "bg-linear-to-br from-emerald-400 to-emerald-600 text-white"
                : "bg-linear-to-br from-red-400 to-red-600 text-white"
            }`}
          >
            {valid ? (
              <BadgeCheck className="size-6" />
            ) : (
              <Ban className="size-6" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.08em] text-ink-500 dark:text-ink-400 uppercase">
              {valid ? "Authentic" : "Not valid"}
            </p>
            <p className="mt-0.5 text-lg font-semibold tracking-tight text-ink-900">
              {valid
                ? "This certificate is genuine and currently valid"
                : "This certificate is no longer valid"}
            </p>
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-2">
          <Row
            icon={Fingerprint}
            label="Reference"
            value={<span className="font-mono">{data.reference}</span>}
          />
          <Row icon={Info} label="Type" value={humanise(data.type)} />
          <Row
            icon={CalendarDays}
            label="Issued"
            value={formatDate(data.issuedAt)}
          />
          <Row
            icon={Ban}
            label="Revoked"
            value={data.revokedAt ? formatDate(data.revokedAt) : "—"}
            muted={!data.revokedAt}
          />
        </dl>
      </div>

      <p className="mt-3 flex items-start gap-2 px-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
        <BadgeCheck
          className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        Checked against the live register. A revoked certificate stays listed
        here rather than disappearing, so the date of withdrawal is on record.
      </p>
    </div>
  );
}

function Row({ icon: Icon, label, value, muted = false }) {
  return (
    <div className="flex items-start gap-3">
      <Icon
        className="mt-0.5 size-4 shrink-0 text-ink-400 dark:text-ink-500"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <dt className="text-xs text-ink-500 dark:text-ink-400">{label}</dt>
        <dd
          className={`text-sm ${muted ? "text-ink-400 dark:text-ink-500" : "text-ink-900"}`}
        >
          {value}
        </dd>
      </div>
    </div>
  );
}
