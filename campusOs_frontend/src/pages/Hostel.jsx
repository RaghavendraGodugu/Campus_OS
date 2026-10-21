import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, CalendarDays, DoorOpen, Plus, Search } from "lucide-react";

import { apiGet, apiPost } from "../api/client";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";
import Modal from "../components/ui/Modal";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";

/**
 * Hostel.
 *
 * A student sees their room and requests leave. A warden sees the allocations,
 * decides leave, and manages the blocks and rooms that make an allocation
 * possible. The two halves share a route because they are one domain and the
 * server decides which half applies.
 */

const STATUS_TONE = {
  PENDING:
    "bg-amber-50 text-amber-800 ring-amber-200/80 dark:bg-amber-500/12 dark:text-amber-300 dark:ring-amber-400/25",
  APPROVED:
    "bg-brand-50 text-brand-700 ring-brand-200/70 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/25",
  REJECTED:
    "bg-red-50 text-red-700 ring-red-200/70 dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/25",
  CANCELLED:
    "bg-ink-100 text-ink-600 ring-ink-200 dark:bg-ink-200/40 dark:text-ink-300",
};

const KINDS = ["BOYS", "GIRLS", "COED"];

export default function Hostel() {
  const { user, can } = useAuth();
  const isStudent = user?.role === "STUDENT";

  if (isStudent) return <StudentHostel />;

  const canManage = can("hostel:manage:institution");
  const canApprove = can("hostel:approve:institution");

  if (!canManage && !canApprove) {
    return (
      <EmptyState
        icon={BedDouble}
        title="No hostel access for this role"
        description="Hostel records are available to students, wardens and institutional oversight."
      />
    );
  }

  return <WardenHostel canManage={canManage} canApprove={canApprove} />;
}

function StudentHostel() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["hostel", "me"],
    queryFn: () => apiGet("/hostel/me"),
  });
  const [form, setForm] = useState({ fromDate: "", toDate: "", reason: "" });
  const [error, setError] = useState("");

  const request = useMutation({
    mutationFn: () => apiPost("/hostel/leaves", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hostel", "me"] });
      setForm({ fromDate: "", toDate: "", reason: "" });
      setError("");
    },
    onError: (failure) => setError(failure.message),
  });

  if (query.isPending) return <Loading label="Loading your hostel details" />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error?.message ?? "Could not load hostel details."}
        onRetry={() => query.refetch()}
      />
    );
  }

  const data = query.data?.data ?? {};
  const allocation = data.allocation;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Hostel
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Your room, and leave requests against it.
        </p>
      </header>

      {allocation ? (
        <section className="surface p-6">
          <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
            Current allocation · {allocation.academicYear}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">
            {allocation.hostel?.name} · Room {allocation.room?.number}
          </p>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            {allocation.hostel?.kind} hostel · capacity{" "}
            {allocation.room?.capacity}
          </p>
        </section>
      ) : (
        <EmptyState
          icon={BedDouble}
          title="No room allocated"
          description="The hostel office has not allocated you a room yet."
        />
      )}

      {allocation && (
        <section className="surface p-5">
          <h2 className="text-[0.9375rem] font-semibold text-ink-900">
            Request leave
          </h2>
          <form
            className="mt-4 grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                form.fromDate &&
                form.toDate &&
                form.reason.trim().length >= 5
              )
                request.mutate();
            }}
          >
            <Field label="From" htmlFor="leave-from" required>
              <input
                id="leave-from"
                type="date"
                className={inputClass}
                value={form.fromDate}
                onChange={(event) =>
                  setForm((c) => ({ ...c, fromDate: event.target.value }))
                }
              />
            </Field>
            <Field label="To" htmlFor="leave-to" required>
              <input
                id="leave-to"
                type="date"
                className={inputClass}
                value={form.toDate}
                onChange={(event) =>
                  setForm((c) => ({ ...c, toDate: event.target.value }))
                }
              />
            </Field>
            <Field
              label="Reason"
              htmlFor="leave-reason"
              required
              className="sm:col-span-2"
              hint="At least 5 characters. The warden sees this."
            >
              <textarea
                id="leave-reason"
                rows={2}
                className={inputClass}
                value={form.reason}
                onChange={(event) =>
                  setForm((c) => ({ ...c, reason: event.target.value }))
                }
                maxLength={300}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button
                loading={request.isPending}
                disabled={
                  !form.fromDate ||
                  !form.toDate ||
                  form.reason.trim().length < 5
                }
              >
                <CalendarDays className="size-4" aria-hidden="true" /> Request
                leave
              </Button>
            </div>
          </form>
          {error && (
            <p
              role="alert"
              className="mt-3 text-sm text-red-600 dark:text-red-300"
            >
              {error}
            </p>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-[0.9375rem] font-semibold text-ink-900">
          My leave requests
        </h2>
        {data.leaves?.length ? (
          <ul className="space-y-2">
            {data.leaves.map((leave) => (
              <li
                key={leave.id}
                className="surface flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <p className="text-sm font-medium text-ink-900">
                    {new Date(leave.fromDate).toLocaleDateString()} →{" "}
                    {new Date(leave.toDate).toLocaleDateString()}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                    {leave.reason}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[leave.status]}`}
                >
                  {leave.status.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-500 dark:text-ink-400">
            No leave requests yet.
          </p>
        )}
      </section>
    </div>
  );
}

function WardenHostel({ canManage, canApprove }) {
  const [tab, setTab] = useState("allocations");
  const [allocating, setAllocating] = useState(false);

  const hostels = useQuery({
    queryKey: ["hostel", "hostels"],
    queryFn: () => apiGet("/hostel/hostels"),
  });
  const allocations = useQuery({
    queryKey: ["hostel", "allocations"],
    queryFn: () => apiGet("/hostel/allocations"),
    enabled: tab === "allocations",
  });
  const leaves = useQuery({
    queryKey: ["hostel", "leaves"],
    queryFn: () => apiGet("/hostel/leaves?status=PENDING"),
    enabled: tab === "leaves",
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            Hostel
          </h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            Allocations, leave decisions and the rooms behind them.
          </p>
        </div>
        {canManage && tab === "allocations" && (
          <Button onClick={() => setAllocating(true)}>
            <Plus className="size-4" aria-hidden="true" /> Allocate a room
          </Button>
        )}
      </header>

      <div
        role="tablist"
        aria-label="Hostel sections"
        className="inline-flex gap-1 rounded-2xl bg-white/70 dark:bg-surface/85 p-1.5 shadow-card ring-1 ring-ink-200/80 dark:ring-ink-600 backdrop-blur-xl"
      >
        {[
          ["allocations", "Allocations"],
          ["leaves", "Leave requests"],
          ["setup", "Blocks & rooms"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`rounded-xl px-3.5 py-2 text-sm font-medium transition-all ${
              tab === value
                ? "aurora text-white shadow-brand"
                : "text-ink-600 hover:bg-white hover:text-ink-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "allocations" && (
        <AllocationsTab query={allocations} canManage={canManage} />
      )}
      {tab === "leaves" && <LeavesTab query={leaves} canApprove={canApprove} />}
      {tab === "setup" && <SetupTab hostels={hostels} canManage={canManage} />}

      {allocating && (
        <AllocateDialog
          hostels={hostels.data?.data?.hostels ?? []}
          onClose={() => setAllocating(false)}
        />
      )}
    </div>
  );
}

function AllocationsTab({ query, canManage }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  const vacate = useMutation({
    mutationFn: (id) => apiPost(`/hostel/allocations/${id}/vacate`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["hostel", "allocations"] }),
    onError: (failure) => setError(failure.message),
  });

  if (query.isPending) return <Loading label="Loading allocations" />;
  if (query.isError)
    return (
      <ErrorState
        message={query.error?.message}
        onRetry={() => query.refetch()}
      />
    );

  const rows = query.data?.data?.allocations ?? [];
  if (!rows.length) {
    return (
      <EmptyState
        icon={BedDouble}
        title="No allocations yet"
        description="Allocate a room to get started."
      />
    );
  }

  return (
    <div className="surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink-200/70 dark:border-ink-700/60 text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
            <tr>
              <th className="px-5 py-3 font-medium">Student</th>
              <th className="px-5 py-3 font-medium">Room</th>
              <th className="px-5 py-3 font-medium">Year</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-5 py-3">
                  <span className="font-medium text-ink-900">
                    {row.student?.user?.fullName ?? "—"}
                  </span>
                  <span className="ml-2 font-mono text-xs text-ink-500">
                    {row.student?.rollNumber}
                  </span>
                </td>
                <td className="px-5 py-3 text-ink-600 dark:text-ink-300">
                  {row.hostel?.name} · {row.room?.number}
                </td>
                <td className="px-5 py-3 text-ink-600 dark:text-ink-300">
                  {row.academicYear}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      row.status === "ACTIVE"
                        ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200/70 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/25"
                        : "bg-ink-100 text-ink-600 dark:bg-ink-200/40 dark:text-ink-300"
                    }`}
                  >
                    {row.status.toLowerCase()}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  {canManage && row.status === "ACTIVE" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={vacate.isPending}
                      onClick={() => vacate.mutate(row.id)}
                    >
                      Vacate
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <p
          role="alert"
          className="px-5 py-3 text-sm text-red-600 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function LeavesTab({ query, canApprove }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  const decide = useMutation({
    mutationFn: ({ id, decision }) =>
      apiPost(`/hostel/leaves/${id}/decide`, { decision }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["hostel", "leaves"] }),
    onError: (failure) => setError(failure.message),
  });

  if (query.isPending) return <Loading label="Loading leave requests" />;
  if (query.isError)
    return (
      <ErrorState
        message={query.error?.message}
        onRetry={() => query.refetch()}
      />
    );

  const rows = query.data?.data?.leaves ?? [];
  if (!rows.length) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No pending leave"
        description="Requests awaiting a decision appear here."
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((leave) => (
        <div
          key={leave.id}
          className="surface flex flex-wrap items-center justify-between gap-4 p-4"
        >
          <div>
            <p className="text-sm font-medium text-ink-900">
              {leave.student?.user?.fullName ?? "Student"}{" "}
              <span className="font-mono text-xs text-ink-500">
                {leave.student?.rollNumber}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
              {new Date(leave.fromDate).toLocaleDateString()} →{" "}
              {new Date(leave.toDate).toLocaleDateString()} · {leave.reason}
            </p>
          </div>
          {canApprove && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={decide.isPending}
                onClick={() =>
                  decide.mutate({ id: leave.id, decision: "APPROVED" })
                }
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={decide.isPending}
                onClick={() =>
                  decide.mutate({ id: leave.id, decision: "REJECTED" })
                }
              >
                Reject
              </Button>
            </div>
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function SetupTab({ hostels, canManage }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [roomFor, setRoomFor] = useState(null);

  if (hostels.isPending) return <Loading label="Loading hostels" />;
  if (hostels.isError)
    return (
      <ErrorState
        message={hostels.error?.message}
        onRetry={() => hostels.refetch()}
      />
    );

  const rows = hostels.data?.data?.hostels ?? [];

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" /> Add block
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title="No blocks yet"
          description="Add a hostel block, then its rooms."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((hostel) => (
            <div key={hostel.id} className="surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-900">
                    {hostel.name}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                    {hostel.code} · {hostel.kind.toLowerCase()} ·{" "}
                    {hostel.roomCount} rooms · {hostel.occupied}/
                    {hostel.capacity} beds
                  </p>
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setRoomFor(hostel)}
                  >
                    Add room
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && <AddHostelDialog onClose={() => setAdding(false)} />}
      {roomFor && (
        <AddRoomDialog
          hostel={roomFor}
          onClose={() => setRoomFor(null)}
          onSaved={() =>
            queryClient.invalidateQueries({ queryKey: ["hostel", "hostels"] })
          }
        />
      )}
    </div>
  );
}

function AddHostelDialog({ onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", code: "", kind: "COED" });
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () => apiPost("/hostel/hostels", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hostel", "hostels"] });
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a hostel block"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!form.name.trim() || !form.code.trim()}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="hostel-name" required>
          <input
            id="hostel-name"
            className={inputClass}
            value={form.name}
            onChange={(event) =>
              setForm((c) => ({ ...c, name: event.target.value }))
            }
            placeholder="Ganga Block"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" htmlFor="hostel-code" required>
            <input
              id="hostel-code"
              className={inputClass}
              value={form.code}
              onChange={(event) =>
                setForm((c) => ({
                  ...c,
                  code: event.target.value.toUpperCase(),
                }))
              }
              placeholder="GB"
            />
          </Field>
          <Field label="Kind" htmlFor="hostel-kind">
            <select
              id="hostel-kind"
              className={inputClass}
              value={form.kind}
              onChange={(event) =>
                setForm((c) => ({ ...c, kind: event.target.value }))
              }
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
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
      </div>
    </Modal>
  );
}

function AddRoomDialog({ hostel, onClose, onSaved }) {
  const [form, setForm] = useState({ number: "", capacity: "2" });
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      apiPost(`/hostel/hostels/${hostel.id}/rooms`, {
        number: form.number,
        capacity: Number(form.capacity),
      }),
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add a room · ${hostel.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!form.number.trim()}
            onClick={() => create.mutate()}
          >
            Create room
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Room number" htmlFor="room-number" required>
            <input
              id="room-number"
              className={inputClass}
              value={form.number}
              onChange={(event) =>
                setForm((c) => ({
                  ...c,
                  number: event.target.value.toUpperCase(),
                }))
              }
              placeholder="101"
            />
          </Field>
          <Field label="Capacity" htmlFor="room-capacity" required>
            <input
              id="room-capacity"
              type="number"
              min="1"
              max="20"
              className={inputClass}
              value={form.capacity}
              onChange={(event) =>
                setForm((c) => ({ ...c, capacity: event.target.value }))
              }
            />
          </Field>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function AllocateDialog({ hostels, onClose }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState("");
  const [studentId, setStudentId] = useState("");
  const [hostelId, setHostelId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [academicYear, setAcademicYear] = useState("2026-27");
  const [error, setError] = useState("");

  const students = useQuery({
    queryKey: ["hostel", "students", searched],
    queryFn: () => apiGet(`/hostel/students?q=${encodeURIComponent(searched)}`),
    enabled: searched.trim().length >= 2,
  });
  const rooms = useQuery({
    queryKey: ["hostel", "rooms", hostelId],
    queryFn: () => apiGet(`/hostel/hostels/${hostelId}/rooms`),
    enabled: Boolean(hostelId),
  });

  const allocate = useMutation({
    mutationFn: () =>
      apiPost("/hostel/allocations", {
        student: studentId,
        room: roomId,
        academicYear,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hostel", "allocations"] });
      queryClient.invalidateQueries({ queryKey: ["hostel", "hostels"] });
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  const options = students.data?.data?.students ?? [];
  const roomList = rooms.data?.data?.rooms ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title="Allocate a room"
      description="Search by roll number or name, then choose a block and room."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={allocate.isPending}
            disabled={!studentId || !roomId || !academicYear.trim()}
            onClick={() => allocate.mutate()}
          >
            Allocate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Find a student"
          htmlFor="allocate-search"
          hint="At least 2 characters."
        >
          <div className="flex gap-2">
            <input
              id="allocate-search"
              className={inputClass}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="DEMO-CS-001 or a name"
            />
            <Button variant="secondary" onClick={() => setSearched(q)}>
              <Search className="size-4" aria-hidden="true" /> Search
            </Button>
          </div>
        </Field>

        {options.length > 0 && (
          <Field label="Student" htmlFor="allocate-student" required>
            <select
              id="allocate-student"
              className={inputClass}
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
            >
              <option value="">Choose a student</option>
              {options.map((student) => (
                <option key={student.studentId} value={student.studentId}>
                  {student.rollNumber} · {student.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Block" htmlFor="allocate-hostel" required>
            <select
              id="allocate-hostel"
              className={inputClass}
              value={hostelId}
              onChange={(event) => {
                setHostelId(event.target.value);
                setRoomId("");
              }}
            >
              <option value="">Choose a block</option>
              {hostels.map((hostel) => (
                <option key={hostel.id} value={hostel.id}>
                  {hostel.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Room" htmlFor="allocate-room" required>
            <select
              id="allocate-room"
              className={inputClass}
              value={roomId}
              disabled={!hostelId}
              onChange={(event) => setRoomId(event.target.value)}
            >
              <option value="">Choose a room</option>
              {roomList.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.number} · {room.capacity} beds
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Academic year" htmlFor="allocate-year" required>
          <input
            id="allocate-year"
            className={inputClass}
            value={academicYear}
            onChange={(event) => setAcademicYear(event.target.value)}
            placeholder="2026-27"
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
