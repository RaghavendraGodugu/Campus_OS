import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, DoorOpen, Plus } from "lucide-react";

import { apiGet, apiPost } from "../api/client";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";
import Modal from "../components/ui/Modal";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";

/**
 * Academic setup: the subjects and rooms a timetable is built from.
 *
 * ## Why these two share a page
 *
 * They are the same shape — a short list and a create form — and neither is
 * useful alone: a subject cannot be scheduled without a room, and a room
 * schedule with no subjects is empty. One page with two tabs keeps the setup
 * flow in one place instead of sending an administrator hunting through the
 * administration area for two more screens.
 *
 * ## Who reaches it
 *
 * The route is gated on any academic management permission and the server
 * re-checks every write against the record's department. A HOD therefore sees
 * the page but can only create subjects for their own department, and cannot
 * create rooms at all (rooms are institution-wide).
 */

const SUBJECT_KINDS = ["THEORY", "LAB", "PROJECT", "SEMINAR"];
const ROOM_KINDS = ["CLASSROOM", "LAB", "SEMINAR", "AUDITORIUM"];

const KIND_LABEL = {
  THEORY: "Theory",
  LAB: "Lab",
  PROJECT: "Project",
  SEMINAR: "Seminar",
  CLASSROOM: "Classroom",
  AUDITORIUM: "Auditorium",
};

const EMPTY_SUBJECT = {
  code: "",
  name: "",
  department: "",
  program: "",
  semester: "1",
  credits: "3",
  kind: "THEORY",
};

const EMPTY_ROOM = { block: "", name: "", capacity: "60", kind: "CLASSROOM" };

const idOf = (value) => (value ? String(value.id ?? value._id ?? value) : "");

export default function Academics() {
  const { user } = useAuth();
  const [tab, setTab] = useState("subjects");
  const [addingSubject, setAddingSubject] = useState(false);
  const [addingRoom, setAddingRoom] = useState(false);

  const subjectsQuery = useQuery({
    queryKey: ["subjects", "active"],
    queryFn: () => apiGet("/subjects?active=true"),
  });
  const roomsQuery = useQuery({
    queryKey: ["rooms", "active"],
    queryFn: () => apiGet("/rooms?active=true"),
  });
  const departmentsQuery = useQuery({
    queryKey: ["admin", "departments"],
    queryFn: () => apiGet("/admin/departments"),
  });
  const programsQuery = useQuery({
    queryKey: ["admin", "programs"],
    queryFn: () => apiGet("/admin/programs"),
  });

  const subjects = subjectsQuery.data?.data?.subjects ?? [];
  const rooms = roomsQuery.data?.data?.rooms ?? [];
  const departments = departmentsQuery.data?.data ?? [];
  const programs = programsQuery.data?.data ?? [];

  const canManageRooms =
    user?.role === "SUPER_ADMIN" || user?.role === "EXAM_ADMIN";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            Academics
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500 dark:text-ink-400">
            Subjects and rooms are the inputs to the timetable. A subject
            belongs to a programme and a department; a room belongs to the
            campus.
          </p>
        </div>

        {tab === "subjects" ? (
          <Button onClick={() => setAddingSubject(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add subject
          </Button>
        ) : (
          <Button
            onClick={() => setAddingRoom(true)}
            disabled={!canManageRooms}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add room
          </Button>
        )}
      </header>

      <div
        role="tablist"
        aria-label="Academic setup"
        className="inline-flex gap-1 rounded-2xl bg-white/70 dark:bg-surface/85 p-1.5 shadow-card ring-1 ring-ink-200/80 dark:ring-ink-600 backdrop-blur-xl"
      >
        <TabButton
          active={tab === "subjects"}
          onClick={() => setTab("subjects")}
          icon={BookOpen}
          label={`Subjects (${subjects.length})`}
        />
        <TabButton
          active={tab === "rooms"}
          onClick={() => setTab("rooms")}
          icon={DoorOpen}
          label={`Rooms (${rooms.length})`}
        />
      </div>

      {tab === "subjects" && (
        <SubjectPanel
          query={subjectsQuery}
          subjects={subjects}
          onAdd={() => setAddingSubject(true)}
        />
      )}

      {tab === "rooms" && (
        <RoomPanel
          query={roomsQuery}
          rooms={rooms}
          canManage={canManageRooms}
          onAdd={() => setAddingRoom(true)}
        />
      )}

      <SubjectDialog
        open={addingSubject}
        onClose={() => setAddingSubject(false)}
        departments={departments}
        programs={programs}
        defaultDepartment={idOf(user?.department)}
      />

      <RoomDialog open={addingRoom} onClose={() => setAddingRoom(false)} />
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-150 ${
        active
          ? "aurora text-white shadow-brand"
          : "text-ink-600 hover:bg-white hover:text-ink-900"
      }`}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}

function SubjectPanel({ query, subjects, onAdd }) {
  if (query.isPending) return <Loading label="Loading subjects" />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error?.message ?? "Subjects could not be loaded."}
        onRetry={() => query.refetch()}
      />
    );
  }
  if (subjects.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No subjects yet"
        description="A subject is one paper in one programme and semester. Add the first one before building a timetable."
        action={
          <Button onClick={onAdd}>
            <Plus className="size-4" aria-hidden="true" />
            Add subject
          </Button>
        }
      />
    );
  }

  return (
    <div className="surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink-200/70 dark:border-ink-700/60 text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
            <tr>
              <th className="px-5 py-3 font-medium">Code</th>
              <th className="px-5 py-3 font-medium">Subject</th>
              <th className="px-5 py-3 font-medium">Programme</th>
              <th className="px-5 py-3 font-medium">Semester</th>
              <th className="px-5 py-3 font-medium">Kind</th>
              <th className="px-5 py-3 font-medium">Credits</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
            {subjects.map((subject) => (
              <tr
                key={subject.id}
                className="hover:bg-ink-50/40 dark:hover:bg-ink-200/10"
              >
                <td className="px-5 py-3 font-mono text-xs text-ink-700 dark:text-ink-300">
                  {subject.code}
                </td>
                <td className="px-5 py-3 font-medium text-ink-900">
                  {subject.name}
                </td>
                <td className="px-5 py-3 text-ink-600 dark:text-ink-300">
                  {subject.program?.code ?? "—"}
                </td>
                <td className="px-5 py-3 text-ink-600 dark:text-ink-300">
                  {subject.semester}
                </td>
                <td className="px-5 py-3">
                  <span className="rounded-full bg-brand-50 dark:bg-brand-500/15 px-2 py-0.5 text-[0.6875rem] font-medium text-brand-700 dark:text-brand-300 ring-1 ring-brand-200/70 dark:ring-brand-400/25 ring-inset">
                    {KIND_LABEL[subject.kind] ?? subject.kind}
                  </span>
                </td>
                <td className="px-5 py-3 text-ink-600 dark:text-ink-300">
                  {subject.credits}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoomPanel({ query, rooms, canManage, onAdd }) {
  if (query.isPending) return <Loading label="Loading rooms" />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error?.message ?? "Rooms could not be loaded."}
        onRetry={() => query.refetch()}
      />
    );
  }
  if (rooms.length === 0) {
    return (
      <EmptyState
        icon={DoorOpen}
        title="No rooms yet"
        description={
          canManage
            ? "Add the lecture halls and labs a class can be scheduled into."
            : "A room list has not been set up yet. Ask the examination office to add rooms."
        }
        action={
          canManage ? (
            <Button onClick={onAdd}>
              <Plus className="size-4" aria-hidden="true" />
              Add room
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <div className="surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink-200/70 dark:border-ink-700/60 text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
            <tr>
              <th className="px-5 py-3 font-medium">Room</th>
              <th className="px-5 py-3 font-medium">Block</th>
              <th className="px-5 py-3 font-medium">Kind</th>
              <th className="px-5 py-3 font-medium">Capacity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
            {rooms.map((room) => (
              <tr
                key={room.id}
                className="hover:bg-ink-50/40 dark:hover:bg-ink-200/10"
              >
                <td className="px-5 py-3 font-medium text-ink-900">
                  {room.name}
                </td>
                <td className="px-5 py-3 text-ink-600 dark:text-ink-300">
                  {room.block || "—"}
                </td>
                <td className="px-5 py-3 text-ink-600 dark:text-ink-300">
                  {KIND_LABEL[room.kind] ?? room.kind}
                </td>
                <td className="px-5 py-3 text-ink-600 dark:text-ink-300">
                  {room.capacity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SubjectDialog({
  open,
  onClose,
  departments,
  programs,
  defaultDepartment,
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_SUBJECT);
  const [error, setError] = useState("");

  const department = form.department || defaultDepartment;
  const visiblePrograms = useMemo(
    () => programs.filter((program) => idOf(program.department) === department),
    [programs, department],
  );

  const create = useMutation({
    mutationFn: () =>
      apiPost("/subjects", {
        code: form.code.trim(),
        name: form.name.trim(),
        department: department,
        program: form.program,
        semester: Number(form.semester),
        credits: Number(form.credits),
        kind: form.kind,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
      setForm(EMPTY_SUBJECT);
      setError("");
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  const invalid =
    !form.code.trim() ||
    !form.name.trim() ||
    !department ||
    !form.program ||
    !form.semester;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a subject"
      description="A subject belongs to one programme. Its department must match the programme's."
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
            Create subject
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" htmlFor="subject-code" required hint="e.g. CS301">
            <input
              id="subject-code"
              className={inputClass}
              value={form.code}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  code: event.target.value.toUpperCase(),
                }))
              }
              placeholder="CS301"
              maxLength={20}
            />
          </Field>

          <Field label="Credits" htmlFor="subject-credits">
            <input
              id="subject-credits"
              type="number"
              min="0"
              max="20"
              className={inputClass}
              value={form.credits}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  credits: event.target.value,
                }))
              }
            />
          </Field>
        </div>

        <Field label="Name" htmlFor="subject-name" required>
          <input
            id="subject-name"
            className={inputClass}
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Database Systems"
            maxLength={160}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" htmlFor="subject-department" required>
            <select
              id="subject-department"
              className={inputClass}
              value={department}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  department: event.target.value,
                  program: "",
                }))
              }
            >
              <option value="">Choose a department</option>
              {departments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Programme" htmlFor="subject-program" required>
            <select
              id="subject-program"
              className={inputClass}
              value={form.program}
              disabled={!department}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  program: event.target.value,
                }))
              }
            >
              <option value="">Choose a programme</option>
              {visiblePrograms.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.code} · {program.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Semester" htmlFor="subject-semester" required>
            <input
              id="subject-semester"
              type="number"
              min="1"
              max="12"
              className={inputClass}
              value={form.semester}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  semester: event.target.value,
                }))
              }
            />
          </Field>

          <Field label="Kind" htmlFor="subject-kind">
            <select
              id="subject-kind"
              className={inputClass}
              value={form.kind}
              onChange={(event) =>
                setForm((current) => ({ ...current, kind: event.target.value }))
              }
            >
              {SUBJECT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind]}
                </option>
              ))}
            </select>
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

function RoomDialog({ open, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_ROOM);
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      apiPost("/rooms", {
        block: form.block.trim(),
        name: form.name.trim(),
        capacity: Number(form.capacity),
        kind: form.kind,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      setForm(EMPTY_ROOM);
      setError("");
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  const invalid = !form.name.trim() || Number(form.capacity) < 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a room"
      description="A room is institution-wide: one record, one schedule, no duplicates."
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
            Create room
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Block" htmlFor="room-block">
            <input
              id="room-block"
              className={inputClass}
              value={form.block}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  block: event.target.value,
                }))
              }
              placeholder="Academic Block A"
              maxLength={80}
            />
          </Field>

          <Field label="Room" htmlFor="room-name" required hint="e.g. LH-204">
            <input
              id="room-name"
              className={inputClass}
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="LH-204"
              maxLength={60}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Capacity" htmlFor="room-capacity" required>
            <input
              id="room-capacity"
              type="number"
              min="1"
              max="2000"
              className={inputClass}
              value={form.capacity}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  capacity: event.target.value,
                }))
              }
            />
          </Field>

          <Field label="Kind" htmlFor="room-kind">
            <select
              id="room-kind"
              className={inputClass}
              value={form.kind}
              onChange={(event) =>
                setForm((current) => ({ ...current, kind: event.target.value }))
              }
            >
              {ROOM_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind]}
                </option>
              ))}
            </select>
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
