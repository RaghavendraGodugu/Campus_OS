import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  EyeOff,
  Hash,
  Search,
  ShieldCheck,
} from "lucide-react";

import { apiGet, apiPost } from "../api/client";
import { formatDate, humanise } from "../lib/format";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";

/**
 * Report a grievance without an account, and track one you filed.
 *
 * ## Why this is public
 *
 * The person who most needs to report harassment is often the person least able
 * to do it through an account: filing under their own name is itself part of
 * what they are afraid of. So there is no login here, and the endpoint behind it
 * takes no session.
 *
 * ## What "anonymous" costs, stated before filing
 *
 * The record has no name, no account, no IP address and no way to reply. That is
 * the price, and it belongs on the screen before the first keystroke rather than
 * in a policy page nobody opens until after they have filed.
 *
 * ## What tracking does not give back
 *
 * The tracking endpoint returns the state of the matter and nothing else — no
 * subject, no category, no description, no officer. Someone holding a code is
 * being shown that a report exists; they are not being given the right to read
 * it. The content is the part that must not follow a person around.
 */

/** Kept in step with the Complaint model's category enum. */
const CATEGORIES = [
  "HARASSMENT",
  "SAFETY",
  "MISCONDUCT",
  "ACADEMICS",
  "FEES",
  "SCHOLARSHIP",
  "HOSTEL",
  "MESS",
  "TRANSPORT",
  "LIBRARY",
  "INFRASTRUCTURE",
  "IT",
  "MAINTENANCE",
  "PLACEMENTS",
  "OTHER",
];

/** The model's own rule. Passed through nowhere near this form. */
const ALWAYS_CONFIDENTIAL = ["HARASSMENT", "SAFETY", "MISCONDUCT"];

export default function Grievance() {
  const [tab, setTab] = useState("report");

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-canvas" />
        <div className="grid-texture absolute inset-0 opacity-60" />
        <div className="liquid-blob absolute -top-40 -right-24 size-[32rem] bg-accent-500/25 blur-3xl" />
        <div className="liquid-blob absolute -top-32 -left-28 size-[30rem] bg-white/45 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="aurora grid size-10 place-items-center rounded-xl text-sm font-bold text-white shadow-brand"
            >
              C
            </span>
            <span className="text-base font-semibold tracking-tight text-ink-900 dark:text-ink-100">
              CampusOS
            </span>
          </span>

          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-600 dark:text-ink-400 dark:text-ink-500 transition-colors hover:bg-white/70 hover:text-brand-800"
          >
            Staff sign in
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </header>

        <div className="py-10">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/70 dark:bg-surface/85 px-3 py-1.5 text-xs font-medium text-brand-700 dark:text-brand-300 shadow-card ring-1 ring-brand-200 dark:ring-brand-400/25 ring-inset backdrop-blur-sm">
              <EyeOff className="size-3.5" aria-hidden="true" />
              No account, no name, no login
            </span>

            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-ink-900 dark:text-ink-100 sm:text-[2.25rem] sm:leading-tight">
              Report something, without your name on it
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-[0.9375rem] leading-relaxed text-ink-600 dark:text-ink-400 dark:text-ink-500">
              Read what anonymity costs before you decide. It is a real trade,
              not a free benefit.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Grievance"
            className="mt-8 inline-flex w-full gap-1 rounded-2xl bg-white/70 dark:bg-surface/85 p-1.5 shadow-card ring-1 ring-ink-200/80 dark:ring-ink-600 backdrop-blur-xl sm:w-auto"
          >
            {[
              { id: "report", label: "Report anonymously", icon: ShieldCheck },
              { id: "track", label: "Track a report", icon: Search },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  role="tab"
                  type="button"
                  aria-selected={tab === item.id}
                  onClick={() => setTab(item.id)}
                  className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-150 sm:flex-none ${
                    tab === item.id
                      ? "aurora text-white shadow-brand"
                      : "text-ink-600 dark:text-ink-400 dark:text-ink-500 hover:bg-white hover:text-ink-900 dark:text-ink-100"
                  }`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="mt-6">
            {tab === "report" ? (
              <ReportForm onTrack={() => setTab("track")} />
            ) : (
              <TrackForm />
            )}
          </div>
        </div>

        <footer className="pb-2 text-center text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
          If you are in immediate danger, contact the emergency services first.
        </footer>
      </div>
    </div>
  );
}

function ReportForm({ onTrack }) {
  const [form, setForm] = useState({
    category: "",
    subject: "",
    description: "",
  });
  const [errors, setErrors] = useState({});
  const [issued, setIssued] = useState(null);
  const [copied, setCopied] = useState(false);

  const confidential = ALWAYS_CONFIDENTIAL.includes(form.category);

  const submit = useMutation({
    mutationFn: () =>
      apiPost("/complaints/anonymous", {
        category: form.category,
        subject: form.subject.trim(),
        description: form.description.trim(),
      }),
    onSuccess: (response) =>
      setIssued({
        reference: response.data.reference,
        confidential: response.data.confidential,
        code: response.meta.trackingCode,
        notice: response.meta.notice,
      }),
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  if (issued) {
    return (
      <div className="surface-raised animate-rise p-6 sm:p-7">
        <span className="grid size-12 place-items-center rounded-2xl bg-emerald-50 dark:bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-400/25 ring-inset">
          <CheckCircle2 className="size-6" aria-hidden="true" />
        </span>

        <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
          Your report has been filed
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-600 dark:text-ink-400 dark:text-ink-500">
          Reference{" "}
          <span className="font-mono font-medium text-ink-900 dark:text-ink-100">
            {issued.reference}
          </span>
          {issued.confidential && (
            <>
              {" "}
              · restricted to the Dean and Principal, because of what you chose
              as the category
            </>
          )}
          .
        </p>

        <div className="mt-6 rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/70 dark:bg-brand-500/15 p-5">
          <p className="text-xs font-semibold tracking-wide text-brand-700 dark:text-brand-300 uppercase">
            Your tracking code
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tracking-widest break-all text-ink-900 dark:text-ink-100 select-all">
            {issued.code}
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={async () => {
              await navigator.clipboard?.writeText(issued.code);
              setCopied(true);
            }}
          >
            {copied ? (
              <>
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" aria-hidden="true" />
                Copy it
              </>
            )}
          </Button>
        </div>

        <p className="mt-4 rounded-xl bg-amber-50 dark:bg-amber-500/12 px-4 py-3 text-sm leading-relaxed text-amber-900 dark:text-amber-200 ring-1 ring-amber-200 dark:ring-amber-400/25 ring-inset">
          {issued.notice}
        </p>

        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-500 dark:text-ink-400 dark:text-ink-500">
          <AlertTriangle
            className="mt-0.5 size-3.5 shrink-0 text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500"
            aria-hidden="true"
          />
          We store only a hash of this code, so nobody — including an
          administrator with database access — can read it back and look up your
          report. That is why it cannot be sent to you if you lose it.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setIssued(null);
              setCopied(false);
              setForm({ category: "", subject: "", description: "" });
            }}
          >
            Report something else
          </Button>
          <Button onClick={onTrack}>Track this report</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-raised p-6 sm:p-7">
      <div className="space-y-4">
        {/*
          The trade, stated first. A person deciding whether to report
          harassment is deciding on the basis of who will read it and what they
          will be able to do afterwards.
        */}
        <div className="rounded-2xl border border-ink-200 dark:border-ink-700/70 bg-ink-50/70 dark:bg-ink-100/40 p-4">
          <p className="text-xs font-semibold tracking-wide text-ink-700 dark:text-ink-300 uppercase">
            What anonymity costs
          </p>
          <ul className="mt-2 space-y-1.5 text-[0.8125rem] leading-relaxed text-ink-600 dark:text-ink-400 dark:text-ink-500">
            {[
              "Nobody can reply to you, because we will not know who you are.",
              "No email or message will reach you at any point.",
              "The office cannot ask you a follow-up question.",
              "You can follow progress only with the tracking code below.",
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="text-ink-300 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500"
                >
                  —
                </span>
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-600 dark:text-ink-400 dark:text-ink-500">
            Need an answer, or want to be contacted?{" "}
            <Link
              to="/login"
              className="font-medium text-brand-700 dark:text-brand-300 underline underline-offset-2 hover:text-brand-900"
            >
              Sign in and file it under your account
            </Link>{" "}
            instead.
          </p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setErrors({});
            submit.mutate();
          }}
          className="space-y-4"
          noValidate
        >
          <Field
            label="What is this about?"
            htmlFor="category"
            required
            error={errors.category}
            hint="This decides which office handles it, and whether it is restricted."
          >
            <select
              id="category"
              value={form.category}
              onChange={(event) =>
                setForm((f) => ({ ...f, category: event.target.value }))
              }
              className={inputClass}
            >
              <option value="">Choose a category…</option>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {humanise(category)}
                </option>
              ))}
            </select>
          </Field>

          {confidential && (
            <p className="flex items-start gap-2 rounded-xl bg-violet-50 dark:bg-violet-500/15 px-3.5 py-2.5 text-xs leading-relaxed text-violet-900 dark:text-violet-200 ring-1 ring-violet-200 dark:ring-violet-400/25 ring-inset">
              <ShieldCheck
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              This category is always treated as restricted. You cannot turn
              that off, and nobody outside the Dean and the Principal will read
              it — including whoever you report.
            </p>
          )}

          <Field
            label="Subject"
            htmlFor="subject"
            required
            error={errors.subject}
            hint="One line. Enough for an officer to recognise what this is."
          >
            <input
              id="subject"
              value={form.subject}
              maxLength={200}
              onChange={(event) =>
                setForm((f) => ({ ...f, subject: event.target.value }))
              }
              className={inputClass}
              placeholder="Repeated conduct in the corridor"
            />
          </Field>

          <Field
            label="What happened"
            htmlFor="description"
            required
            error={errors.description}
            hint="Dates, places, and what was said or done. What you write is never copied into notifications or the audit trail."
          >
            <textarea
              id="description"
              rows={8}
              value={form.description}
              maxLength={5000}
              onChange={(event) =>
                setForm((f) => ({ ...f, description: event.target.value }))
              }
              className={`${inputClass} resize-y`}
            />
          </Field>

          {submit.isError && !Object.keys(errors).length && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 dark:bg-red-500/12 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-400/25 ring-inset"
            >
              {submit.error?.message}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={submit.isPending}
            disabled={
              !form.category ||
              form.subject.trim().length < 5 ||
              form.description.trim().length < 30
            }
          >
            File this report anonymously
          </Button>

          <p className="text-center text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
            Your IP address is not stored with the report.
          </p>
        </form>
      </div>
    </div>
  );
}

function TrackForm() {
  const [code, setCode] = useState("");

  const track = useMutation({
    mutationFn: (value) => apiGet(`/complaints/track/${value}`),
  });

  const found = track.data?.data;

  return (
    <div className="surface-raised p-6 sm:p-7">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          track.mutate(code.trim());
        }}
        className="space-y-4"
        noValidate
      >
        <Field
          label="Tracking code"
          htmlFor="tracking-code"
          required
          hint="The code you were given when you filed. Case does not matter, and the hyphen is optional."
        >
          <div className="relative">
            <Hash
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500"
              aria-hidden="true"
            />
            <input
              id="tracking-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXXXXXX-XXXXXXXX"
              className={`${inputClass} pl-10 font-mono tracking-wider uppercase placeholder:font-sans placeholder:tracking-normal`}
            />
          </div>
        </Field>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={track.isPending}
          disabled={code.trim().length < 8}
        >
          <Search className="size-4" aria-hidden="true" />
          Check progress
        </Button>
      </form>

      {track.isError && (
        <p
          role="alert"
          className="mt-5 rounded-xl bg-red-50 dark:bg-red-500/12 px-3.5 py-3 text-sm text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-400/25 ring-inset"
        >
          {track.error?.message}
        </p>
      )}

      {found && <TrackResult result={found} />}

      {found && (
        <p className="mt-5 flex items-start gap-2 border-t border-ink-200/70 dark:border-ink-700/60 pt-5 text-xs leading-relaxed text-ink-500 dark:text-ink-400 dark:text-ink-500">
          <EyeOff
            className="mt-0.5 size-3.5 shrink-0 text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500"
            aria-hidden="true"
          />
          This deliberately shows the state of your report and nothing else —
          not what you wrote, which category you chose, or who is handling it.
          Those are the parts that would identify you.
        </p>
      )}
    </div>
  );
}

function TrackResult({ result }) {
  const Icon = result.resolved ? CheckCircle2 : Clock;

  return (
    <div className="mt-6 animate-rise">
      <div
        className={`overflow-hidden rounded-2xl ring-1 ${
          result.resolved
            ? "ring-emerald-200 dark:ring-emerald-400/25"
            : "ring-brand-200 dark:ring-brand-400/25"
        }`}
      >
        <div
          className={`flex items-center gap-4 px-5 py-4 ${
            result.resolved
              ? "bg-linear-to-r from-emerald-50 dark:from-emerald-500/15 dark:from-emerald-500/12 to-surface"
              : "bg-linear-to-r from-brand-50 dark:from-brand-500/15 to-surface"
          }`}
        >
          <span
            aria-hidden="true"
            className={`grid size-11 shrink-0 place-items-center rounded-xl text-white shadow-card ${
              result.resolved
                ? "bg-linear-to-br from-emerald-400 to-emerald-600"
                : "aurora"
            }`}
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-500 dark:text-ink-400 dark:text-ink-500 uppercase">
              {humanise(result.status)}
            </p>
            <p className="mt-0.5 text-base font-semibold tracking-tight text-ink-900 dark:text-ink-100">
              {result.resolved
                ? "This report is closed"
                : "This report is being handled"}
            </p>
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
              Reference
            </dt>
            <dd className="mt-0.5 font-mono text-sm text-ink-900 dark:text-ink-100">
              {result.reference}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
              Filed
            </dt>
            <dd className="mt-0.5 text-sm text-ink-900 dark:text-ink-100">
              {formatDate(result.submittedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
              Last movement
            </dt>
            <dd className="mt-0.5 text-sm text-ink-900 dark:text-ink-100">
              {formatDate(result.lastActivityAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
              Updates
            </dt>
            <dd className="mt-0.5 text-sm text-ink-900 dark:text-ink-100">
              {result.updateCount === 0
                ? "None yet"
                : `${result.updateCount} recorded`}
            </dd>
          </div>
        </dl>
      </div>

      {result.confidential && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-violet-50 dark:bg-violet-500/15 px-3.5 py-3 text-xs leading-relaxed text-violet-900 dark:text-violet-200 ring-1 ring-violet-200 dark:ring-violet-400/25 ring-inset">
          <ShieldCheck
            className="mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
          Restricted. Only the Dean and the Principal can open it.
        </p>
      )}
    </div>
  );
}
