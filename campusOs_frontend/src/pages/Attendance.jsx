import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarCheck,
  ClipboardCheck,
  Users,
} from "lucide-react";

import { apiGet, apiPatch, apiPost } from "../api/client";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import { inputClass } from "../components/ui/Field";
import Modal from "../components/ui/Modal";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";

/**
 * Attendance.
 *
 * One route, three audiences, because the data is one domain:
 *
 *  - a **student** sees their own derived percentage, overall and per subject;
 *  - **faculty** see the classes they teach on a chosen date and mark or
 *    correct the register;
 *  - a **HOD** or the examination office additionally see the roll-up.
 *
 * The page never calculates a percentage. Every figure comes from the server,
 * which derives it from the register — the same rule that stops a stored total
 * from disagreeing with the records after a correction.
 */

const pad = (value) => String(value).padStart(2, "0");

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function timeFromMinutes(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

const STATUS_OPTIONS = [
  { value: "PRESENT", label: "Present", short: "P" },
  { value: "ABSENT", label: "Absent", short: "A" },
  { value: "LATE", label: "Late", short: "L" },
  { value: "EXCUSED", label: "Excused", short: "E" },
];

const WEEKDAY = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function toneFor(percentage) {
  if (percentage === null || percentage === undefined) return "ink";
  if (percentage >= 75) return "good";
  if (percentage >= 60) return "warn";
  return "bad";
}

const TONE_TEXT = {
  good: "text-brand-700 dark:text-brand-300",
  warn: "text-amber-700 dark:text-amber-300",
  bad: "text-red-600 dark:text-red-300",
  ink: "text-ink-500 dark:text-ink-400 dark:text-ink-500",
};

const TONE_BAR = {
  good: "bg-brand-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  ink: "bg-ink-300",
};

export default function Attendance() {
  const { user, canAny } = useAuth();
  const isStudent = user?.role === "STUDENT";
  const canMark = canAny("attendance:mark:own");
  const canRollUp = canAny(
    "attendance:read:department",
    "attendance:read:institution",
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
          Attendance
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500 dark:text-ink-400 dark:text-ink-500">
          Every percentage is derived from the class registers. A correction
          changes the register, not a total, and always carries a reason.
        </p>
      </header>

      {isStudent && <StudentAttendance />}
      {canMark && <MarkingPanel />}
      {canRollUp && <Overview />}

      {!isStudent && !canMark && !canRollUp && (
        <EmptyState
          icon={CalendarCheck}
          title="No attendance view for this role"
          description="Attendance is available to students, faculty, heads of department and the examination office."
        />
      )}
    </div>
  );
}

function StudentAttendance() {
  const query = useQuery({
    queryKey: ["attendance", "me"],
    queryFn: () => apiGet("/attendance/me"),
  });

  const data = query.data?.data;

  if (query.isPending) return <Loading label="Loading your attendance" />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error?.message ?? "Your attendance could not be loaded."}
        onRetry={() => query.refetch()}
      />
    );
  }

  if (!data?.term) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="No term is open"
        description="Attendance is recorded against a term. Once one is opened, your percentages appear here."
      />
    );
  }

  if (!data.overall) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="No classes marked yet"
        description="When your teachers mark a register, your running percentage appears here."
      />
    );
  }

  const overallTone = toneFor(data.overall.percentage);

  return (
    <section className="space-y-4">
      <div className="surface p-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400 dark:text-ink-500">
              Overall attendance · {data.term.name}
            </p>
            <p
              className={`mt-2 text-5xl font-semibold tracking-tight ${TONE_TEXT[overallTone]}`}
            >
              {data.overall.percentage}
              <span className="text-2xl">%</span>
            </p>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
              {data.overall.attended} of {data.overall.held} classes attended
            </p>
          </div>

          <div className="min-w-56">
            <div className="h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-200/40">
              <div
                className={`h-full rounded-full ${TONE_BAR[overallTone]}`}
                style={{ width: `${Math.min(100, data.overall.percentage)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
              Institutional threshold {data.threshold}%.{" "}
              {data.overall.belowThreshold
                ? "You are below the threshold."
                : "You are above the threshold."}
            </p>
          </div>
        </div>
      </div>

      <div className="surface overflow-hidden">
        <div className="border-b border-ink-200/60 dark:border-ink-700/50 px-5 py-4">
          <h2 className="text-[0.9375rem] font-semibold text-ink-900 dark:text-ink-100">
            By subject
          </h2>
        </div>
        <ul className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
          {data.subjects.map((row) => {
            const tone = toneFor(row.percentage);
            return (
              <li key={row.subject.id} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                      {row.subject.code} · {row.subject.name}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
                      {row.attended} of {row.held} classes · {row.present}{" "}
                      present
                      {row.late ? `, ${row.late} late` : ""}
                      {row.excused ? `, ${row.excused} excused` : ""}
                    </p>
                  </div>
                  <p
                    className={`text-lg font-semibold tabular-nums ${TONE_TEXT[tone]}`}
                  >
                    {row.percentage}%
                  </p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-200/40">
                  <div
                    className={`h-full rounded-full ${TONE_BAR[tone]}`}
                    style={{ width: `${Math.min(100, row.percentage)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function MarkingPanel() {
  const [date, setDate] = useState(todayLocal());
  const [activeEntry, setActiveEntry] = useState(null);

  const query = useQuery({
    queryKey: ["attendance", "day", date],
    queryFn: () => apiGet(`/attendance/day?date=${date}`),
  });

  const classes = query.data?.data?.classes ?? [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-100">
            Mark a register
          </h2>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
            {WEEKDAY[query.data?.data?.weekday] ?? "Choose a date"} · your
            classes only
          </p>
        </div>

        <div className="w-44">
          <label htmlFor="attendance-date" className="sr-only">
            Date
          </label>
          <input
            id="attendance-date"
            type="date"
            className={inputClass}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
      </div>

      {query.isPending && <Loading label="Loading your classes" />}

      {query.isError && (
        <ErrorState
          message={query.error?.message ?? "Your classes could not be loaded."}
          onRetry={() => query.refetch()}
        />
      )}

      {query.isSuccess && classes.length === 0 && (
        <EmptyState
          icon={ClipboardCheck}
          title="No classes on this date"
          description="You do not teach anything on this weekday, or the timetable has not been set up for that day."
        />
      )}

      {query.isSuccess && classes.length > 0 && (
        <ul className="space-y-3">
          {classes.map((item) => (
            <li
              key={item.entry.id}
              className="surface flex flex-wrap items-center justify-between gap-4 p-4"
            >
              <div className="min-w-0">
                <p className="font-mono text-[0.6875rem] text-ink-500 dark:text-ink-400 dark:text-ink-500">
                  {timeFromMinutes(item.entry.startMinute)}–
                  {timeFromMinutes(item.entry.endMinute)}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-ink-900 dark:text-ink-100">
                  {item.entry.subject.code} · {item.entry.subject.name}
                </p>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
                  {[item.entry.room?.block, item.entry.room?.name]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {item.marked ? (
                  <span className="rounded-full bg-brand-50 dark:bg-brand-500/15 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300 ring-1 ring-brand-200/70 dark:ring-brand-400/25 ring-inset">
                    Marked{item.revision > 0 ? ` · rev ${item.revision}` : ""}
                  </span>
                ) : (
                  <span className="rounded-full bg-ink-100 dark:bg-ink-200/40 px-2.5 py-1 text-xs font-medium text-ink-600 dark:text-ink-300">
                    Not marked
                  </span>
                )}

                <Button
                  variant={item.marked ? "secondary" : "primary"}
                  size="sm"
                  onClick={() => setActiveEntry({ entry: item.entry, date })}
                >
                  {item.marked ? "Correct" : "Mark attendance"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {activeEntry && (
        <RegisterDialog
          entry={activeEntry.entry}
          date={activeEntry.date}
          onClose={() => setActiveEntry(null)}
        />
      )}
    </section>
  );
}

function RegisterDialog({ entry, date, onClose }) {
  const query = useQuery({
    queryKey: ["attendance", "entry", entry.id, date],
    queryFn: () => apiGet(`/attendance/entry/${entry.id}?date=${date}`),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        query.data?.data?.marked ? "Correct the register" : "Mark attendance"
      }
      description={`${entry.subject.code} · ${entry.subject.name} · ${
        WEEKDAY[entry.dayOfWeek]
      } ${date}`}
    >
      {query.isPending && <Loading label="Loading the roster" />}
      {query.isError && (
        <ErrorState
          message={query.error?.message ?? "The roster could not be loaded."}
          onRetry={() => query.refetch()}
        />
      )}
      {query.isSuccess && (
        <RegisterForm
          key={`${entry.id}-${date}-${query.data.data.session?.revision ?? "new"}`}
          context={query.data.data}
          entry={entry}
          date={date}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function RegisterForm({ context, entry, date, onClose }) {
  const queryClient = useQueryClient();
  const [statuses, setStatuses] = useState(() =>
    Object.fromEntries(
      context.roster.map((student) => [
        student.studentId,
        student.status ?? "PRESENT",
      ]),
    ),
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const marked = context.marked;
  const records = context.roster.map((student) => ({
    student: student.studentId,
    status: statuses[student.studentId] ?? "PRESENT",
  }));

  const submit = useMutation({
    mutationFn: () =>
      marked
        ? apiPatch(`/attendance/sessions/${context.session.id}`, {
            records,
            reason: reason.trim(),
          })
        : apiPost("/attendance/sessions", {
            entry: entry.id,
            date,
            records,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  const bulk = (status) =>
    setStatuses(
      Object.fromEntries(
        context.roster.map((student) => [student.studentId, status]),
      ),
    );

  const reasonTooShort = marked && reason.trim().length < 5;

  return (
    <div className="space-y-4">
      {marked && (
        <p className="rounded-lg bg-amber-50 dark:bg-amber-500/12 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 ring-1 ring-amber-200/80 dark:ring-amber-400/25">
          This register was already marked
          {context.session.revision > 0
            ? ` and corrected ${context.session.revision} time${
                context.session.revision === 1 ? "" : "s"
              }`
            : ""}
          . Changing it creates a new revision and requires a reason.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
          {context.roster.length} student
          {context.roster.length === 1 ? "" : "s"} on the roster
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => bulk("PRESENT")}>
            All present
          </Button>
          <Button variant="ghost" size="sm" onClick={() => bulk("ABSENT")}>
            All absent
          </Button>
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto rounded-xl ring-1 ring-ink-200/70 dark:ring-ink-700/60">
        <ul className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
          {context.roster.map((student) => {
            const current = statuses[student.studentId] ?? "PRESENT";
            return (
              <li
                key={student.studentId}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-100">
                    {student.name}
                  </p>
                  <p className="font-mono text-[0.6875rem] text-ink-500 dark:text-ink-400 dark:text-ink-500">
                    {student.rollNumber}
                  </p>
                </div>

                <div
                  className="flex gap-1"
                  role="group"
                  aria-label={`Status for ${student.name}`}
                >
                  {STATUS_OPTIONS.map((option) => {
                    const selected = current === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setStatuses((previous) => ({
                            ...previous,
                            [student.studentId]: option.value,
                          }))
                        }
                        className={`min-w-9 rounded-md px-2 py-1 text-[0.6875rem] font-medium transition-colors ${
                          selected
                            ? "bg-brand-600 text-white shadow-brand"
                            : "bg-ink-100 text-ink-600 dark:text-ink-400 dark:text-ink-500 hover:bg-ink-200 dark:bg-ink-200/40 dark:text-ink-300 dark:hover:bg-ink-200/60"
                        }`}
                      >
                        {option.short}
                        <span className="sr-only"> {option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {marked && (
        <div>
          <label
            htmlFor="correction-reason"
            className="block text-[0.8125rem] font-medium text-ink-700 dark:text-ink-300"
          >
            Reason for the correction
            <span className="ml-0.5 text-red-500" aria-hidden="true">
              *
            </span>
          </label>
          <textarea
            id="correction-reason"
            rows={2}
            className={`${inputClass} mt-1.5`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is the register changing?"
            maxLength={500}
          />
          <p className="mt-1 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
            Stored with the register and audited. At least 5 characters.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          loading={submit.isPending}
          disabled={reasonTooShort}
          onClick={() => submit.mutate()}
        >
          {marked ? "Save correction" : "Save register"}
        </Button>
      </div>
    </div>
  );
}

function Overview() {
  const query = useQuery({
    queryKey: ["attendance", "overview"],
    queryFn: () => apiGet("/attendance/overview"),
  });

  const data = query.data?.data;

  if (query.isPending) return <Loading label="Loading the roll-up" />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error?.message ?? "The roll-up could not be loaded."}
        onRetry={() => query.refetch()}
      />
    );
  }

  if (!data?.term) {
    return (
      <EmptyState
        icon={Users}
        title="No term is open"
        description="A roll-up is reported against a term."
      />
    );
  }

  if (!data.subjects.length) {
    return (
      <EmptyState
        icon={Users}
        title="No attendance yet"
        description="Once registers are marked, attendance by subject appears here."
      />
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-100">
            Attendance roll-up
          </h2>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
            {data.term.name} · threshold {data.threshold}%
          </p>
        </div>
      </div>

      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink-200/70 dark:border-ink-700/60 text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400 dark:text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Subject</th>
                <th className="px-5 py-3 font-medium">Sessions</th>
                <th className="px-5 py-3 font-medium">Students</th>
                <th className="px-5 py-3 font-medium">
                  Below {data.threshold}%
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
              {data.subjects.map((row) => (
                <tr key={row.subject.id}>
                  <td className="px-5 py-3">
                    <span className="font-medium text-ink-900 dark:text-ink-100">
                      {row.subject.code}
                    </span>
                    <span className="ml-2 text-ink-600 dark:text-ink-300">
                      {row.subject.name}
                    </span>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-ink-600 dark:text-ink-300">
                    {row.sessions}
                  </td>
                  <td className="px-5 py-3 tabular-nums text-ink-600 dark:text-ink-300">
                    {row.students}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                        row.belowThreshold > 0
                          ? "bg-red-50 text-red-700 ring-1 ring-red-200/70 dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/25"
                          : "bg-brand-50 text-brand-700 ring-1 ring-brand-200/70 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/25"
                      }`}
                    >
                      {row.belowThreshold > 0 && (
                        <AlertTriangle className="size-3" aria-hidden="true" />
                      )}
                      {row.belowThreshold}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
