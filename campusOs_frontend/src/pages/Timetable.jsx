import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, MapPin, Plus, Trash2, UserRound } from "lucide-react";

import { apiDelete, apiGet, apiPost } from "../api/client";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";
import Modal from "../components/ui/Modal";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";

/**
 * The weekly timetable.
 *
 * ## One page, four audiences
 *
 * The server decides what `GET /timetable` returns — a student's programme, a
 * faculty member's own classes, a HOD's department or the whole institution —
 * and the page renders whatever comes back. Building four pages would duplicate
 * the grid and let the four drift apart.
 *
 * ## Why the term is part of the payload
 *
 * "No classes this week" and "no term has been opened" look identical on an
 * empty grid, and they need different answers: the first is normal, the second
 * is an administrator task. The response names the term it covered, so the page
 * can tell them apart instead of showing a blank grid for both.
 */

const DAYS = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
];

const DAY_LABEL = Object.fromEntries(DAYS.map((day) => [day.value, day.label]));

const KIND_LABEL = {
  THEORY: "Theory",
  LAB: "Lab",
  PROJECT: "Project",
  SEMINAR: "Seminar",
};

const pad = (value) => String(value).padStart(2, "0");

/** 540 → "09:00". */
function timeFromMinutes(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** "09:00" → 540. */
function minutesFromTime(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

const EMPTY_FORM = {
  subject: "",
  faculty: "",
  room: "",
  dayOfWeek: "1",
  start: "09:00",
  end: "10:00",
};

export default function Timetable() {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);

  const query = useQuery({
    queryKey: ["timetable"],
    queryFn: () => apiGet("/timetable"),
  });

  const term = query.data?.data?.term ?? null;
  const canManage = Boolean(query.data?.meta?.canManage);

  // Memoised so the day bucket does not recompute on every render just because
  // `?? []` produced a fresh array.
  const entries = useMemo(() => query.data?.data?.entries ?? [], [query.data]);

  const byDay = useMemo(() => {
    const map = new Map(DAYS.map((day) => [day.value, []]));
    for (const entry of entries) {
      map.get(entry.dayOfWeek)?.push(entry);
    }
    return map;
  }, [entries]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
            Timetable
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500 dark:text-ink-400 dark:text-ink-500">
            {term
              ? `${term.name} · ${term.academicYear}. Times are the college's local time.`
              : "No academic term is currently open."}
          </p>
        </div>

        {canManage && term && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add class
          </Button>
        )}
      </header>

      {query.isPending && <Loading label="Loading timetable" />}

      {query.isError && (
        <ErrorState
          message={query.error?.message ?? "The timetable could not be loaded."}
          onRetry={() => query.refetch()}
        />
      )}

      {query.isSuccess && !term && (
        <EmptyState
          icon={CalendarDays}
          title="No term is open"
          description="A timetable belongs to a term. An administrator opens one under Academic terms before classes can be scheduled."
        />
      )}

      {query.isSuccess && term && entries.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title="Nothing scheduled yet"
          description={
            canManage
              ? "Add the first class for this term. Subjects and rooms are set up under Academics."
              : "Classes for your timetable will appear here once they are scheduled."
          }
          action={
            canManage ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden="true" />
                Add class
              </Button>
            ) : null
          }
        />
      )}

      {query.isSuccess && term && entries.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {DAYS.map((day) => {
            const classes = byDay.get(day.value) ?? [];
            return (
              <section key={day.value} className="surface p-4">
                <header className="mb-3 flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold tracking-tight text-ink-900 dark:text-ink-100">
                    {day.label}
                  </h2>
                  <span className="text-xs text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500">
                    {classes.length === 0
                      ? "Free"
                      : `${classes.length} class${classes.length === 1 ? "" : "es"}`}
                  </span>
                </header>

                {classes.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-ink-200/80 dark:border-ink-700/70 px-3 py-5 text-center text-xs text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500">
                    No classes
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {classes.map((entry) => (
                      <ClassCard
                        key={entry.id}
                        entry={entry}
                        canManage={canManage}
                        onRemove={() => setRemoving(entry)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {canManage && term && (
        <ScheduleDialog
          open={adding}
          onClose={() => setAdding(false)}
          term={term}
        />
      )}

      <RemoveDialog entry={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}

function ClassCard({ entry, canManage, onRemove }) {
  const { subject, faculty, room } = entry;

  return (
    <li className="rounded-xl bg-white/60 dark:bg-surface/60 p-3 ring-1 ring-ink-200/70 dark:ring-ink-700/60">
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[0.6875rem] text-ink-500 dark:text-ink-400 dark:text-ink-500">
          {timeFromMinutes(entry.startMinute)}–
          {timeFromMinutes(entry.endMinute)}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-brand-50 dark:bg-brand-500/15 px-2 py-0.5 text-[0.625rem] font-medium text-brand-700 dark:text-brand-300 ring-1 ring-brand-200/70 dark:ring-brand-400/25 ring-inset">
            {KIND_LABEL[subject?.kind] ?? "Class"}
          </span>
          {canManage && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${subject?.code ?? "this class"} from ${DAY_LABEL[entry.dayOfWeek]}`}
              className="rounded-md p-1 text-ink-400 dark:text-ink-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-300"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <p className="mt-1 text-sm font-semibold tracking-tight text-ink-900 dark:text-ink-100">
        {subject?.code}
        <span className="font-normal text-ink-600 dark:text-ink-300">
          {" · "}
          {subject?.name}
        </span>
      </p>

      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
        <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
        {faculty?.fullName ?? "Unassigned"}
      </p>

      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
        <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
        {room ? [room.block, room.name].filter(Boolean).join(" · ") : "No room"}
      </p>
    </li>
  );
}

function ScheduleDialog({ open, onClose, term }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");

  const subjectsQuery = useQuery({
    queryKey: ["subjects", "active"],
    queryFn: () => apiGet("/subjects?active=true"),
    enabled: open,
  });
  const roomsQuery = useQuery({
    queryKey: ["rooms", "active"],
    queryFn: () => apiGet("/rooms?active=true"),
    enabled: open,
  });
  const staffQuery = useQuery({
    queryKey: ["timetable", "staff"],
    queryFn: () => apiGet("/timetable/staff"),
    enabled: open,
  });

  const subjects = subjectsQuery.data?.data?.subjects ?? [];
  const rooms = roomsQuery.data?.data?.rooms ?? [];
  const staff = staffQuery.data?.data?.staff ?? [];

  const endMinutes = minutesFromTime(form.end);
  const startMinutes = minutesFromTime(form.start);

  const invalid =
    !form.subject || !form.faculty || !form.room || endMinutes <= startMinutes;

  const create = useMutation({
    mutationFn: () =>
      apiPost("/timetable", {
        term: term.id,
        subject: form.subject,
        faculty: form.faculty,
        room: form.room,
        dayOfWeek: Number(form.dayOfWeek),
        startMinute: startMinutes,
        endMinute: endMinutes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timetable"] });
      setForm(EMPTY_FORM);
      setError("");
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  const missingSetup =
    !subjectsQuery.isPending &&
    !roomsQuery.isPending &&
    (subjects.length === 0 || rooms.length === 0 || staff.length === 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule a class"
      description={`Added to ${term.name}. The week repeats until the class is removed.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={invalid}
            onClick={() => create.mutate()}
          >
            Schedule
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid) create.mutate();
        }}
        className="space-y-4"
      >
        {missingSetup && (
          <p className="rounded-lg bg-amber-50 dark:bg-amber-500/12 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 ring-1 ring-amber-200/80 dark:ring-amber-400/25">
            Subjects, rooms and teaching staff all need to exist first.{" "}
            <Link to="/management/academics" className="font-medium underline">
              Set up academics
            </Link>
            .
          </p>
        )}

        <Field label="Subject" htmlFor="class-subject" required>
          <select
            id="class-subject"
            className={inputClass}
            value={form.subject}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                subject: event.target.value,
              }))
            }
          >
            <option value="">Choose a subject</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.code} · {subject.name} (sem {subject.semester})
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Faculty" htmlFor="class-faculty" required>
            <select
              id="class-faculty"
              className={inputClass}
              value={form.faculty}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  faculty: event.target.value,
                }))
              }
            >
              <option value="">Choose a teacher</option>
              {staff.map((person) => (
                <option
                  key={person._id ?? person.id}
                  value={person._id ?? person.id}
                >
                  {person.fullName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Room" htmlFor="class-room" required>
            <select
              id="class-room"
              className={inputClass}
              value={form.room}
              onChange={(event) =>
                setForm((current) => ({ ...current, room: event.target.value }))
              }
            >
              <option value="">Choose a room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {[room.block, room.name].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Day" htmlFor="class-day" required>
            <select
              id="class-day"
              className={inputClass}
              value={form.dayOfWeek}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  dayOfWeek: event.target.value,
                }))
              }
            >
              {DAYS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Starts" htmlFor="class-start" required>
            <input
              id="class-start"
              type="time"
              className={inputClass}
              value={form.start}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  start: event.target.value,
                }))
              }
            />
          </Field>

          <Field
            label="Ends"
            htmlFor="class-end"
            required
            error={
              endMinutes <= startMinutes
                ? "The class must end after it starts"
                : undefined
            }
          >
            <input
              id="class-end"
              type="time"
              className={inputClass}
              value={form.end}
              onChange={(event) =>
                setForm((current) => ({ ...current, end: event.target.value }))
              }
            />
          </Field>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function RemoveDialog({ entry, onClose }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  const remove = useMutation({
    mutationFn: () => apiDelete(`/timetable/${entry.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timetable"] });
      setError("");
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  if (!entry) return null;

  return (
    <Modal
      open={Boolean(entry)}
      onClose={onClose}
      title="Remove this class?"
      description={`${entry.subject?.code ?? "This class"} on ${
        DAY_LABEL[entry.dayOfWeek]
      } at ${timeFromMinutes(entry.startMinute)}. It disappears from the weekly grid; the history stays.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </Modal>
  );
}
