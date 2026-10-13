import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Building2,
  FileCheck2,
  FileText,
  GraduationCap,
  Landmark,
  Minus,
  Plus,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Stamp,
  UserRoundCheck,
} from "lucide-react";

import { apiGet, apiPost } from "../api/client";
import { Card } from "../components/ui/Card";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";
import { ErrorState, Loading } from "../components/ui/States";

/**
 * Apply for a certificate.
 *
 * ## The type is a card, not a dropdown
 *
 * Nine certificate types, and the difference between them decides whether your
 * application is accepted: a bonafide letter for a bank and a no-dues letter for
 * a visa are different documents produced by different offices on different
 * timelines. A single-line `<select>` hides all of that behind nine similar
 * labels, so each type is shown as a card with what it is for and who signs it.
 *
 * The cards are a real radiogroup: arrow keys move between them, and the field
 * set is not reachable by Tab alone. Choosing is the whole task on this page, so
 * it should not be the fiddliest part of it.
 *
 * ## What is chosen for you, and said so
 *
 * The department is not offered here. The server takes the student's own
 * department, and there is no student-facing list of departments to choose
 * from, so a picker would be inventing a choice that does not exist.
 *
 * ## One thing that is true up front
 *
 * A submitted application cannot be cancelled from here, and evidence has to be
 * attached afterwards. Saying that before the button is better than discovering
 * it afterwards.
 */

const TYPES = [
  {
    value: "BONAFIDE",
    label: "Bonafide certificate",
    icon: BadgeCheck,
    blurb: "Confirms you are enrolled, with your dates of study.",
    for: "Bank accounts, passport applications",
    office: "Registrar",
    tone: "from-brand-500/12 to-brand-500/0 text-brand-700 ring-brand-500/25",
  },
  {
    value: "STUDY",
    label: "Study certificate",
    icon: BookOpenCheck,
    blurb: "Confirms you are continuing to study this programme.",
    for: "Scholarship and exchange applications",
    office: "Registrar",
    tone: "from-sky-500/12 to-sky-500/0 text-sky-700 ring-sky-500/25",
  },
  {
    value: "CHARACTER",
    label: "Character certificate",
    icon: UserRoundCheck,
    blurb: "A statement about conduct and attendance.",
    for: "Passport, visa and background check",
    office: "HoD",
    tone: "from-violet-500/12 to-violet-500/0 text-violet-700 ring-violet-500/25",
  },
  {
    value: "TRANSCRIPT",
    label: "Academic transcript",
    icon: GraduationCap,
    blurb: "Every course and grade recorded so far.",
    for: "Further study and transfer applications",
    office: "Examination cell",
    tone: "from-indigo-500/12 to-indigo-500/0 text-indigo-700 ring-indigo-500/25",
  },
  {
    value: "COURSE_COMPLETION",
    label: "Course completion",
    icon: FileCheck2,
    blurb: "Confirms the programme was finished.",
    for: "Job applications and placements",
    office: "Examination cell",
    tone: "from-emerald-500/12 to-emerald-500/0 text-emerald-700 ring-emerald-500/25",
  },
  {
    value: "NO_DUES",
    label: "No-dues certificate",
    icon: ShieldCheck,
    blurb: "Confirms nothing is outstanding with the institute.",
    for: "Scholarship renewal and hostel allocation",
    office: "Accounts office",
    tone: "from-teal-500/12 to-teal-500/0 text-teal-700 ring-teal-500/25",
  },
  {
    value: "TRANSFER",
    label: "Transfer certificate",
    icon: Building2,
    blurb: "For moving to another institution mid-programme.",
    for: "Joining a different college or university",
    office: "Registrar",
    tone: "from-amber-500/12 to-amber-500/0 text-amber-700 ring-amber-500/25",
  },
  {
    value: "MIGRATION",
    label: "Migration certificate",
    icon: Landmark,
    blurb: "A formal record of your move to this institute.",
    for: "Government schemes and foreign education",
    office: "Registrar",
    tone: "from-rose-500/12 to-rose-500/0 text-rose-700 ring-rose-500/25",
  },
  {
    value: "INTERNSHIP",
    label: "Internship certificate",
    icon: Stamp,
    blurb: "Records a completed internship placement.",
    for: "Your CV and internship applications",
    office: "Training and placement cell",
    tone: "from-cyan-500/12 to-cyan-500/0 text-cyan-700 ring-cyan-500/25",
  },
];

const MAX_COPIES = 10;
const PURPOSE_LIMIT = 500;

export default function ApplyCertificate() {
  const navigate = useNavigate();
  const [type, setType] = useState("");
  const [purpose, setPurpose] = useState("");
  const [copies, setCopies] = useState(1);
  const [errors, setErrors] = useState({});
  const [touchedType, setTouchedType] = useState(false);

  // Arrow-key movement between the cards, as a real radiogroup does.
  const cardsRef = useRef([]);

  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () => apiGet("/profile"),
  });

  const submit = useMutation({
    mutationFn: (payload) => apiPost("/certificates", payload),
    onSuccess: (response) =>
      navigate(`/certificates/${response.data.reference}`),
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  const chosen = useMemo(
    () => TYPES.find((option) => option.value === type),
    [type],
  );

  /**
   * Roving arrow keys. Only the selected card is in the tab order, so Tab
   * leaves the group instead of walking through nine controls to reach the
   * purpose field.
   */
  const onCardKeyDown = (event, index) => {
    const moves = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };

    if (event.key in moves) {
      event.preventDefault();
      const next = (index + moves[event.key] + TYPES.length) % TYPES.length;
      setType(TYPES[next].value);
      setTouchedType(true);
      cardsRef.current[next]?.focus();
    }

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setType(TYPES[index].value);
      setTouchedType(true);
    }
  };

  const onSubmit = (event) => {
    event.preventDefault();
    setTouchedType(true);

    if (!type) {
      setErrors({ type: "Choose the certificate you need" });
      return;
    }

    setErrors({});
    submit.mutate({ type, purpose: purpose.trim() || undefined, copies });
  };

  if (profile.isLoading) return <Loading label="Loading your details" />;

  if (profile.isError) {
    return (
      <ErrorState
        message={profile.error?.message}
        onRetry={() => profile.refetch()}
      />
    );
  }

  const student = profile.data?.data?.student;
  const tooLong = purpose.length > PURPOSE_LIMIT;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-4">
      {/* ===== Header ===== */}
      <header className="relative overflow-hidden rounded-2xl bg-linear-to-br from-brand-700 via-brand-700 to-brand-800 px-6 py-7 shadow-raised sm:px-8 sm:py-9">
        <div
          aria-hidden="true"
          className="absolute -top-24 -right-16 size-72 rounded-full bg-white/8 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-28 -left-10 size-64 rounded-full bg-brand-400/20 blur-3xl"
        />

        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 text-[0.6875rem] font-medium tracking-wide text-brand-100 uppercase ring-1 ring-white/15 ring-inset">
              <Sparkles className="size-3" aria-hidden="true" />
              New application
            </span>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">
              Request a certificate
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-brand-100/90">
              Choose what you need and say who it is for. Your student record
              fills in the rest, so nothing is retyped and nothing can be
              mistyped.
            </p>
          </div>

          {student && (
            <dl className="min-w-56 rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/15 ring-inset backdrop-blur-sm">
              <dt className="text-[0.6875rem] font-medium tracking-wide text-brand-200 uppercase">
                Applying as
              </dt>
              <dd className="mt-1 text-sm font-medium text-white">
                {student.rollNumber}
              </dd>
              <dd className="text-xs text-brand-100/80">
                {student.program?.name ?? "Programme on record"}
              </dd>
              <dd className="mt-1.5 text-xs text-brand-200">
                {student.department?.name}
              </dd>
            </dl>
          )}
        </div>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-6">
        {/* ===== Which certificate ===== */}
        <Card
          title="Which certificate do you need?"
          description="Pick the closest match. If you need one for a specific purpose, say so below and the office will guide you if a different document is required."
        >
          <div
            role="radiogroup"
            aria-label="Certificate type"
            aria-describedby={
              errors.type ? "certificate-type-error" : undefined
            }
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {TYPES.map((option, index) => {
              const Icon = option.icon;
              const selected = type === option.value;

              return (
                <button
                  key={option.value}
                  ref={(node) => {
                    cardsRef.current[index] = node;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  // The name is the label alone. Left to itself, a button
                  // takes its whole contents as its name, and a screen reader
                  // would announce "Bonafide certificate, confirms you are
                  // enrolled, with your dates of study, Registrar, bank
                  // accounts, passport applications" as one option. The detail
                  // is still on screen and still reachable; it is just not part
                  // of the name.
                  aria-labelledby={`certificate-label-${option.value}`}
                  tabIndex={selected || (!type && index === 0) ? 0 : -1}
                  onClick={() => {
                    setType(option.value);
                    setTouchedType(true);
                    setErrors({});
                  }}
                  onKeyDown={(event) => onCardKeyDown(event, index)}
                  className={`group relative flex gap-3.5 rounded-2xl p-4 text-left transition-all duration-200 ${
                    selected
                      ? "bg-white shadow-raised ring-2 ring-brand-500"
                      : "bg-white/70 shadow-card ring-1 ring-ink-200/80 hover:-translate-y-0.5 hover:bg-white hover:shadow-raised hover:ring-ink-300"
                  }`}
                >
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br ${option.tone} ring-1 ring-inset transition-transform duration-200 group-hover:scale-105 ${
                      selected ? "scale-105" : ""
                    }`}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        id={`certificate-label-${option.value}`}
                        className="text-sm font-semibold text-ink-900"
                      >
                        {option.label}
                      </span>
                      {selected && (
                        <span
                          aria-hidden="true"
                          className="grid size-4 shrink-0 place-items-center rounded-full bg-brand-600 text-white"
                        >
                          <svg
                            viewBox="0 0 12 12"
                            className="size-2.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M2.5 6.5 5 9l4.5-6" />
                          </svg>
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-ink-500">
                      {option.blurb}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-md bg-ink-100/80 px-1.5 py-0.5 text-[0.6875rem] text-ink-600">
                        {option.office}
                      </span>
                      <span className="rounded-md bg-ink-100/80 px-1.5 py-0.5 text-[0.6875rem] text-ink-500">
                        {option.for}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {touchedType && errors.type && (
            <p
              id="certificate-type-error"
              role="alert"
              className="mt-3 flex items-center gap-1.5 text-xs font-medium text-red-600"
            >
              {errors.type}
            </p>
          )}

          {!type && !errors.type && (
            <p className="mt-3 text-xs text-ink-400">
              Nothing selected yet — use the arrow keys to move between cards.
            </p>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* ===== Details ===== */}
          <div className="space-y-6 lg:col-span-2">
            <Card
              title="Purpose"
              description="Where the certificate is going. The office uses this to decide how to word it, and it is the fastest way to get it right first time."
            >
              <Field
                label="What do you need it for?"
                htmlFor="purpose"
                optional
                error={errors.purpose}
                hint={`${purpose.length} of ${PURPOSE_LIMIT} characters`}
              >
                <textarea
                  id="purpose"
                  rows={4}
                  value={purpose}
                  maxLength={PURPOSE_LIMIT}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder="e.g. Applying for a student account at HDFC Bank"
                  className={`${inputClass} resize-y`}
                  aria-invalid={Boolean(errors.purpose) || tooLong || undefined}
                />
              </Field>
            </Card>

            <Card
              title="How many copies?"
              description="Each copy is issued and stamped separately."
            >
              <div className="flex items-center gap-4">
                <div className="inline-flex items-center rounded-xl bg-ink-100/70 p-1 ring-1 ring-ink-200">
                  <button
                    type="button"
                    onClick={() => setCopies((n) => Math.max(1, n - 1))}
                    disabled={copies <= 1}
                    aria-label="One fewer copy"
                    className="grid size-9 place-items-center rounded-lg text-ink-600 transition-colors hover:bg-white hover:text-ink-900 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Minus className="size-4" aria-hidden="true" />
                  </button>

                  <span
                    aria-live="polite"
                    aria-label="Number of copies"
                    className="w-12 text-center text-sm font-semibold text-ink-900 tabular-nums"
                  >
                    {copies}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      setCopies((n) => Math.min(MAX_COPIES, n + 1))
                    }
                    disabled={copies >= MAX_COPIES}
                    aria-label="One more copy"
                    className="grid size-9 place-items-center rounded-lg text-ink-600 transition-colors hover:bg-white hover:text-ink-900 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                  </button>
                </div>

                <p className="text-xs text-ink-500">
                  {copies === 1
                    ? "One stamped copy."
                    : `${copies} stamped copies, issued together.`}
                </p>
              </div>
            </Card>
          </div>

          {/* ===== Live summary ===== */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <Card
              title="Summary"
              description="Check this before submitting."
              className="overflow-hidden"
            >
              <div className="space-y-4">
                <SummaryRow
                  icon={chosen?.icon ?? FileText}
                  label="Certificate"
                  value={chosen?.label ?? "Not chosen yet"}
                  muted={!chosen}
                />
                <SummaryRow
                  icon={ScrollText}
                  label="Purpose"
                  value={purpose.trim() || "Not given"}
                  muted={!purpose.trim()}
                />
                <SummaryRow
                  icon={FileCheck2}
                  label="Copies"
                  value={String(copies)}
                />

                <div className="border-t border-ink-100/90 pt-4">
                  <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-500">
                    <Building2
                      className="mt-0.5 size-3.5 shrink-0 text-ink-400"
                      aria-hidden="true"
                    />
                    Issued by the {chosen?.office ?? "relevant office"}, from
                    your student record. No documents need to be typed in again.
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                <Button
                  type="submit"
                  size="lg"
                  loading={submit.isPending}
                  disabled={!type}
                  className="w-full"
                >
                  Submit application
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={() => navigate(-1)}
                  className="w-full"
                >
                  Cancel
                </Button>
              </div>

              {submit.isError && !Object.keys(errors).length && (
                <p
                  role="alert"
                  className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200 ring-inset"
                >
                  {submit.error?.message}
                </p>
              )}

              <p className="mt-4 flex items-start gap-2 text-[0.6875rem] leading-relaxed text-ink-400">
                <FileText
                  className="mt-0.5 size-3 shrink-0"
                  aria-hidden="true"
                />
                You can attach supporting documents once the application exists,
                on its own page.
              </p>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}

function SummaryRow({ icon: Icon, label, value, muted = false }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset ${
          muted
            ? "bg-ink-50 text-ink-300 ring-ink-200"
            : "bg-brand-50 text-brand-600 ring-brand-200"
        }`}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[0.6875rem] font-medium tracking-wide text-ink-400 uppercase">
          {label}
        </p>
        <p
          className={`mt-0.5 text-sm ${muted ? "text-ink-400 italic" : "text-ink-800"}`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
