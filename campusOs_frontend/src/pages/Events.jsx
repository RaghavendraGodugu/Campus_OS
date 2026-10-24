import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, CalendarRange } from "lucide-react";

import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";
import Modal from "../components/ui/Modal";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";

/**
 * Events.
 *
 * The campus calendar. Everyone reads the published programme; the offices
 * that answer for the poster compose drafts, publish, and cancel. Seats are a
 * live count the server hands back with the rows — the client never invents
 * one.
 */
const KIND_OPTIONS = [
  "WORKSHOP",
  "SEMINAR",
  "FEST",
  "SPORTS",
  "CULTURAL",
  "OTHER",
];

/** The renderer's words for the machine's status. */
const STATUS_LABEL = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  CANCELLED: "Cancelled",
};

const STATUS_CLASS = {
  DRAFT: "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300",
  PUBLISHED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

function kindLabel(kind) {
  return kind
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function day(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** An ISO string of `local date + time`, in UTC, as the form's input. */
function toIso(value) {
  if (!value) return value;
  return new Date(`${value}:00`).toISOString();
}

export default function Events() {
  const { can } = useAuth();
  const canManage = can("event:manage:institution");

  const [composing, setComposing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(null);

  const events = useQuery({
    queryKey: ["events"],
    queryFn: () => apiGet("/events"),
  });

  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["events"] });

  const rsvp = useMutation({
    mutationFn: (id) => apiPost(`/events/${id}/rsvp`),
    onSuccess: invalidate,
  });

  const withdraw = useMutation({
    mutationFn: (id) => apiDelete(`/events/${id}/rsvp`),
    onSuccess: invalidate,
  });

  const create = useMutation({
    mutationFn: (payload) => apiPost("/events", payload),
    onSuccess: () => {
      setComposing(false);
      invalidate();
    },
  });

  const cancel = useMutation({
    mutationFn: (id) => apiPatch(`/events/${id}`, { status: "CANCELLED" }),
    onSuccess: () => {
      setConfirmCancel(null);
      invalidate();
    },
  });

  const rows = events.data?.data?.events ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            Events
          </h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            Workshops, fests and seminars for the campus. Registration closes
            when the event begins.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setComposing(true)}>
            <CalendarPlus className="mr-1.5 h-4 w-4" />
            New event
          </Button>
        )}
      </header>

      {events.isLoading && <Loading label="Loading the calendar" />}
      {events.isError && (
        <ErrorState message={events.error?.message} onRetry={events.refetch} />
      )}

      {!events.isLoading && !events.isError && rows.length === 0 && (
        <EmptyState
          icon={CalendarRange}
          title="Nothing on the calendar yet"
          description={
            canManage
              ? "Compose an event — a workshop, a fest, a seminar — and publish it when the venue is booked."
              : "Published events appear here with a place to register."
          }
        />
      )}

      {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((ev) => (
            <li
              key={ev.id}
              className="rounded-xl border border-ink-200 bg-surface p-4 dark:border-ink-700"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[ev.status] ?? "bg-ink-100 text-ink-700"}`}
                    >
                      {(STATUS_LABEL[ev.status] ?? ev.status).toUpperCase()}
                    </span>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
                      {kindLabel(ev.kind).toUpperCase()}
                    </span>
                    {ev.capacity != null && ev.status === "PUBLISHED" && (
                      <span className="text-[11px] font-medium text-ink-500">
                        {ev.rsvpCount}/{ev.capacity} registered
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1.5 font-semibold text-ink-900">
                    {ev.title}
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-300">
                    {day(ev.startsAt)} · {clock(ev.startsAt)}
                    {ev.endsAt ? ` – ${clock(ev.endsAt)}` : ""}
                    {ev.venue ? ` · ${ev.venue}` : ""}
                  </p>
                  <p className="mt-1 max-w-prose text-sm text-ink-500 dark:text-ink-400">
                    {ev.description}
                  </p>
                </div>
                <div className="shrink-0">
                  {ev.status === "PUBLISHED" &&
                    new Date(ev.startsAt) > new Date() &&
                    (ev.rsvped ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          Registered
                        </span>
                        <Button
                          variant="outline"
                          onClick={() => withdraw.mutate(ev.id)}
                          disabled={withdraw.isPending}
                        >
                          Release seat
                        </Button>
                      </div>
                    ) : (
                      <Button
                        onClick={() => rsvp.mutate(ev.id)}
                        disabled={rsvp.isPending}
                      >
                        Register
                      </Button>
                    ))}
                  {canManage && ev.status !== "CANCELLED" && (
                    <Button
                      variant="ghost"
                      className="mt-2 block"
                      onClick={() => setConfirmCancel(ev)}
                      disabled={cancel.isPending}
                    >
                      Cancel event
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {rsvp.isError && (
        <ErrorState message={rsvp.error?.message} onRetry={invalidate} />
      )}

      <ComposeModal
        open={composing}
        onClose={() => setComposing(false)}
        onSaved={create.mutate}
        saving={create.isPending}
        error={create.error?.message}
      />

      <ConfirmCancel
        event={confirmCancel}
        onClose={() => setConfirmCancel(null)}
        onConfirm={() => cancel.mutate(confirmCancel.id)}
        working={cancel.isPending}
        error={cancel.error?.message}
      />
    </div>
  );
}

function ComposeModal({ open, onClose, onSaved, saving, error }) {
  const [form, setForm] = useState({
    title: "",
    kind: "WORKSHOP",
    venue: "",
    date: "",
    from: "",
    to: "",
    capacity: "",
    description: "",
    contact: "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!open) return null;

  const startsAt = toIso(
    form.date && form.from ? `${form.date}T${form.from}` : null,
  );
  const endsAt = toIso(
    form.date && form.to ? `${form.date}T${form.to}` : null,
  );

  const payload = {
    title: form.title.trim(),
    description: form.description.trim(),
    kind: form.kind,
    venue: form.venue.trim() || undefined,
    startsAt,
    endsAt: endsAt || undefined,
    capacity: form.capacity ? Number(form.capacity) : undefined,
    contact: form.contact.trim() || undefined,
  };

  return (
    <Modal open={open} onClose={onClose} title="New event">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSaved(payload);
        }}
        className="space-y-3"
      >
        <Field label="Title">
          <input
            className={inputClass}
            value={form.title}
            onChange={set("title")}
            required
            minLength={3}
            maxLength={160}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <select
              className={inputClass}
              value={form.kind}
              onChange={set("kind")}
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Venue">
            <input
              className={inputClass}
              value={form.venue}
              onChange={set("venue")}
              placeholder="CSE Lab 2"
            />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date">
            <input
              type="date"
              className={inputClass}
              value={form.date}
              onChange={set("date")}
              required
            />
          </Field>
          <Field label="From">
            <input
              type="time"
              className={inputClass}
              value={form.from}
              onChange={set("from")}
              required
            />
          </Field>
          <Field label="Until">
            <input
              type="time"
              className={inputClass}
              value={form.to}
              onChange={set("to")}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Capacity">
            <input
              type="number"
              min="1"
              className={inputClass}
              value={form.capacity}
              onChange={set("capacity")}
              placeholder="Leave blank for open"
            />
          </Field>
          <Field label="Contact / office">
            <input
              className={inputClass}
              value={form.contact}
              onChange={set("contact")}
              placeholder="cse-office"
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            className={inputClass}
            rows={4}
            value={form.description}
            onChange={set("description")}
            required
            minLength={10}
            maxLength={4000}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            Discard
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save draft"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmCancel({ event, onClose, onConfirm, working, error }) {
  if (!event) return null;

  return (
    <Modal open onClose={onClose} title="Cancel this event?">
      <div className="space-y-4">
        <p className="text-sm text-ink-600 dark:text-ink-300">
          <strong>{event.title}</strong> comes off the published calendar and
          everyone who registered will see the event as cancelled. A published
          event is not un-published — pulling the poster back after people acted
          on it is what this step avoids.
        </p>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button onClick={onConfirm} disabled={working}>
            {working ? "Cancelling…" : "Cancel the event"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
