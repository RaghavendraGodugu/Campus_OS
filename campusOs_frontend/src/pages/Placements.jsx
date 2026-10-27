import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  CalendarDays,
  Plus,
  Send,
  Users,
} from "lucide-react";

import { apiGet, apiPatch, apiPost } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatMoney } from "../lib/format";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";
import Modal from "../components/ui/Modal";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";

/**
 * Placements.
 *
 * A student sees open drives and their own applications. The placement office
 * creates companies and drives, opens and closes them, and moves applications
 * through shortlisting. Draft drives never reach a student: the server filters
 * them out of the list, not the page.
 */
const DRIVE_TONE = {
  DRAFT: "bg-ink-100 text-ink-600 dark:bg-ink-200/40 dark:text-ink-300",
  OPEN: "bg-brand-50 text-brand-700 ring-1 ring-brand-200/70 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/25",
  CLOSED:
    "bg-red-50 text-red-700 ring-1 ring-red-200/70 dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/25",
};

const APPLICATION_TONE = {
  APPLIED: "bg-ink-100 text-ink-600 dark:bg-ink-200/40 dark:text-ink-300",
  SHORTLISTED:
    "bg-amber-50 text-amber-800 ring-1 ring-amber-200/80 dark:bg-amber-500/12 dark:text-amber-300 dark:ring-amber-400/25",
  SELECTED:
    "bg-brand-50 text-brand-700 ring-1 ring-brand-200/70 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/25",
  REJECTED:
    "bg-red-50 text-red-700 ring-1 ring-red-200/70 dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/25",
  WITHDRAWN:
    "bg-ink-100 text-ink-500 dark:bg-ink-200/40 dark:text-ink-400 dark:text-ink-500",
};

export default function Placements() {
  const { user, can } = useAuth();
  const isStudent = user?.role === "STUDENT";
  const canManage = can("placement:manage:institution");

  const drives = useQuery({
    queryKey: ["placement", "drives"],
    queryFn: () => apiGet("/placement/drives"),
  });
  const mine = useQuery({
    queryKey: ["placement", "me"],
    queryFn: () => apiGet("/placement/me"),
    enabled: isStudent,
  });

  const [creating, setCreating] = useState(false);
  const [applicationsFor, setApplicationsFor] = useState(null);
  const [error, setError] = useState("");

  const apply = useMutation({
    mutationFn: (id) => apiPost(`/placement/drives/${id}/apply`),
    onSuccess: () => {
      drives.refetch();
      mine.refetch();
    },
    onError: (failure) => setError(failure.message),
  });

  const withdraw = useMutation({
    mutationFn: (id) => apiPost(`/placement/drives/${id}/withdraw`),
    onSuccess: () => {
      drives.refetch();
      mine.refetch();
    },
    onError: (failure) => setError(failure.message),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }) =>
      apiPost(`/placement/drives/${id}/status`, { status }),
    onSuccess: () => drives.refetch(),
    onError: (failure) => setError(failure.message),
  });

  const applicationByDrive = useMemo(() => {
    const map = new Map();
    for (const application of mine.data?.data?.applications ?? []) {
      map.set(
        String(application.drive?._id ?? application.drive?.id),
        application,
      );
    }
    return map;
  }, [mine.data]);

  const rows = drives.data?.data?.drives ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
            Placements
          </h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
            {isStudent
              ? "Open drives you are eligible for, and the status of your applications."
              : "Companies, drives and the applications against them."}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" /> New drive
          </Button>
        )}
      </header>

      {drives.isPending && <Loading label="Loading drives" />}
      {drives.isError && (
        <ErrorState
          message={drives.error?.message}
          onRetry={() => drives.refetch()}
        />
      )}

      {drives.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={Briefcase}
          title={isStudent ? "No open drives" : "No drives yet"}
          description={
            isStudent
              ? "When the placement office opens a drive, it appears here."
              : "Create a company and a drive, then open it for applications."
          }
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((drive) => {
          const application = applicationByDrive.get(
            String(drive._id ?? drive.id),
          );
          const canWithdraw = ["APPLIED", "SHORTLISTED"].includes(
            application?.status,
          );
          const closed = drive.status === "CLOSED";
          const deadlinePassed =
            new Date(drive.applicationDeadline) < new Date();

          return (
            <article key={drive.id ?? drive._id} className="surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400 dark:text-ink-500">
                    {drive.company?.name ?? "Company"} ·{" "}
                    {drive.company?.sector || "—"}
                  </p>
                  <h2 className="mt-1 text-base font-semibold tracking-tight text-ink-900 dark:text-ink-100">
                    {drive.title}
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-300">
                    {drive.role}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${DRIVE_TONE[drive.status]}`}
                >
                  {drive.status.toLowerCase()}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-ink-500 dark:text-ink-400 dark:text-ink-500">
                    Apply by
                  </dt>
                  <dd className="mt-0.5 flex items-center gap-1.5 text-ink-800 dark:text-ink-200">
                    <CalendarDays className="size-3.5" aria-hidden="true" />{" "}
                    {formatDate(drive.applicationDeadline)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-500 dark:text-ink-400 dark:text-ink-500">
                    Drive
                  </dt>
                  <dd className="mt-0.5 text-ink-800 dark:text-ink-200">
                    {formatDate(drive.driveDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-500 dark:text-ink-400 dark:text-ink-500">
                    Location
                  </dt>
                  <dd className="mt-0.5 text-ink-800 dark:text-ink-200">
                    {drive.location || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-500 dark:text-ink-400 dark:text-ink-500">
                    CTC
                  </dt>
                  <dd className="mt-0.5 text-ink-800 dark:text-ink-200">
                    {drive.ctcPaise ? formatMoney(drive.ctcPaise) : "—"}
                  </dd>
                </div>
              </dl>

              {canManage ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {drive.status === "DRAFT" && (
                    <Button
                      size="sm"
                      onClick={() =>
                        setStatus.mutate({ id: drive.id, status: "OPEN" })
                      }
                    >
                      Open applications
                    </Button>
                  )}
                  {drive.status === "OPEN" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setStatus.mutate({ id: drive.id, status: "CLOSED" })
                      }
                    >
                      Close drive
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setApplicationsFor(drive)}
                  >
                    <Users className="size-3.5" aria-hidden="true" />{" "}
                    Applications ({drive.applications})
                  </Button>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {application ? (
                    <>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${APPLICATION_TONE[application.status]}`}
                      >
                        {application.status.toLowerCase()}
                      </span>
                      {canWithdraw && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={withdraw.isPending}
                          onClick={() => withdraw.mutate(drive.id)}
                        >
                          Withdraw application
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button
                      size="sm"
                      loading={apply.isPending}
                      disabled={closed || deadlinePassed}
                      onClick={() => apply.mutate(drive.id)}
                    >
                      <Send className="size-3.5" aria-hidden="true" /> Apply
                    </Button>
                  )}
                  {deadlinePassed && !application && (
                    <p className="text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
                      The deadline has passed.
                    </p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}

      {isStudent && <MyApplications query={mine} />}

      {creating && <CreateDriveDialog onClose={() => setCreating(false)} />}
      {applicationsFor && (
        <ApplicationsDialog
          drive={applicationsFor}
          onClose={() => setApplicationsFor(null)}
        />
      )}
    </div>
  );
}

function MyApplications({ query }) {
  if (query.isPending) return <Loading label="Loading your applications" />;
  if (query.isError)
    return (
      <ErrorState
        message={query.error?.message}
        onRetry={() => query.refetch()}
      />
    );

  const rows = query.data?.data?.applications ?? [];
  if (!rows.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-[0.9375rem] font-semibold text-ink-900 dark:text-ink-100">
        My applications
      </h2>
      <div className="surface divide-y divide-ink-100/90 dark:divide-ink-700/50">
        {rows.map((application) => (
          <div
            key={application.id}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
          >
            <div>
              <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                {application.drive?.company?.name} · {application.drive?.title}
              </p>
              <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
                Applied {formatDate(application.appliedAt)}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${APPLICATION_TONE[application.status]}`}
            >
              {application.status.toLowerCase()}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CreateDriveDialog({ onClose }) {
  const queryClient = useQueryClient();
  const companies = useQuery({
    queryKey: ["placement", "companies"],
    queryFn: () => apiGet("/placement/companies"),
  });
  const [companyId, setCompanyId] = useState("");
  const [newCompany, setNewCompany] = useState({ name: "", sector: "" });
  const [form, setForm] = useState({
    title: "",
    role: "",
    location: "",
    ctc: "",
    applicationDeadline: "",
    driveDate: "",
    semesters: "",
  });
  const [error, setError] = useState("");

  const createCompany = useMutation({
    mutationFn: () =>
      apiPost("/placement/companies", {
        name: newCompany.name.trim(),
        sector: newCompany.sector.trim() || undefined,
      }),
    onSuccess: async (response) => {
      await companies.refetch();
      setCompanyId(response.data.company.id);
      setNewCompany({ name: "", sector: "" });
    },
    onError: (failure) => setError(failure.message),
  });

  const createDrive = useMutation({
    mutationFn: () =>
      apiPost("/placement/drives", {
        company: companyId,
        title: form.title.trim(),
        role: form.role.trim(),
        location: form.location.trim() || undefined,
        ctcPaise: form.ctc ? Math.round(Number(form.ctc) * 100) : undefined,
        applicationDeadline: form.applicationDeadline,
        driveDate: form.driveDate,
        eligibleSemesters: form.semesters
          ? form.semesters
              .split(",")
              .map((value) => Number(value.trim()))
              .filter(Boolean)
          : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["placement", "drives"] });
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  const options = companies.data?.data?.companies ?? [];
  const invalid =
    !companyId ||
    !form.title.trim() ||
    !form.role.trim() ||
    !form.applicationDeadline ||
    !form.driveDate;

  return (
    <Modal
      open
      onClose={onClose}
      title="Create a drive"
      description="It starts as a draft. Open it when you are ready for applications."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={createDrive.isPending}
            disabled={invalid}
            onClick={() => createDrive.mutate()}
          >
            Create drive
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Company" htmlFor="drive-company" required>
          <select
            id="drive-company"
            className={inputClass}
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
          >
            <option value="">Choose a company</option>
            {options.map((company) => (
              <option
                key={company.id ?? company._id}
                value={company.id ?? company._id}
              >
                {company.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="rounded-xl bg-ink-50/70 dark:bg-ink-100/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-600 dark:text-ink-300">
            <Building2 className="size-3.5" aria-hidden="true" /> New company
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              aria-label="New company name"
              className={inputClass}
              placeholder="Name"
              value={newCompany.name}
              onChange={(event) =>
                setNewCompany((c) => ({ ...c, name: event.target.value }))
              }
            />
            <input
              aria-label="New company sector"
              className={inputClass}
              placeholder="Sector"
              value={newCompany.sector}
              onChange={(event) =>
                setNewCompany((c) => ({ ...c, sector: event.target.value }))
              }
            />
            <Button
              variant="secondary"
              loading={createCompany.isPending}
              disabled={!newCompany.name.trim()}
              onClick={() => createCompany.mutate()}
            >
              Add
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="drive-title" required>
            <input
              id="drive-title"
              className={inputClass}
              value={form.title}
              onChange={(event) =>
                setForm((c) => ({ ...c, title: event.target.value }))
              }
              placeholder="Graduate Engineer 2027"
            />
          </Field>
          <Field label="Role" htmlFor="drive-role" required>
            <input
              id="drive-role"
              className={inputClass}
              value={form.role}
              onChange={(event) =>
                setForm((c) => ({ ...c, role: event.target.value }))
              }
              placeholder="SDE"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Application deadline" htmlFor="drive-deadline" required>
            <input
              id="drive-deadline"
              type="date"
              className={inputClass}
              value={form.applicationDeadline}
              onChange={(event) =>
                setForm((c) => ({
                  ...c,
                  applicationDeadline: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Drive date" htmlFor="drive-date" required>
            <input
              id="drive-date"
              type="date"
              className={inputClass}
              value={form.driveDate}
              onChange={(event) =>
                setForm((c) => ({ ...c, driveDate: event.target.value }))
              }
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Location" htmlFor="drive-location">
            <input
              id="drive-location"
              className={inputClass}
              value={form.location}
              onChange={(event) =>
                setForm((c) => ({ ...c, location: event.target.value }))
              }
              placeholder="Bengaluru"
            />
          </Field>
          <Field label="CTC (₹ per year)" htmlFor="drive-ctc">
            <input
              id="drive-ctc"
              type="number"
              min="0"
              className={inputClass}
              value={form.ctc}
              onChange={(event) =>
                setForm((c) => ({ ...c, ctc: event.target.value }))
              }
              placeholder="1200000"
            />
          </Field>
          <Field
            label="Semesters"
            htmlFor="drive-semesters"
            hint="Comma-separated; blank means all."
          >
            <input
              id="drive-semesters"
              className={inputClass}
              value={form.semesters}
              onChange={(event) =>
                setForm((c) => ({ ...c, semesters: event.target.value }))
              }
              placeholder="5, 6"
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

function ApplicationsDialog({ drive, onClose }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["placement", "applications", drive.id],
    queryFn: () => apiGet(`/placement/drives/${drive.id}/applications`),
  });
  const [error, setError] = useState("");

  const decide = useMutation({
    mutationFn: ({ id, status }) =>
      apiPatch(`/placement/applications/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["placement", "applications", drive.id],
      });
      queryClient.invalidateQueries({ queryKey: ["placement", "drives"] });
    },
    onError: (failure) => setError(failure.message),
  });

  const rows = query.data?.data?.applications ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Applications · ${drive.title}`}
      description={`${rows.length} application${rows.length === 1 ? "" : "s"}`}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {query.isPending && <Loading label="Loading applications" />}
      {query.isError && (
        <ErrorState
          message={query.error?.message}
          onRetry={() => query.refetch()}
        />
      )}
      {query.isSuccess && rows.length === 0 && (
        <p className="text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
          No applications yet.
        </p>
      )}
      {rows.length > 0 && (
        <div className="max-h-96 overflow-y-auto rounded-xl ring-1 ring-ink-200/70 dark:ring-ink-700/60">
          <ul className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
            {rows.map((application) => (
              <li
                key={application.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                    {application.student?.user?.fullName ?? "Student"}
                  </p>
                  <p className="font-mono text-[0.6875rem] text-ink-500 dark:text-ink-400 dark:text-ink-500">
                    {application.student?.rollNumber}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${APPLICATION_TONE[application.status]}`}
                  >
                    {application.status.toLowerCase()}
                  </span>
                  <select
                    aria-label={`Status for ${application.student?.user?.fullName ?? "student"}`}
                    className={`${inputClass} w-36`}
                    value={application.status}
                    disabled={application.status === "WITHDRAWN"}
                    onChange={(event) =>
                      decide.mutate({
                        id: application.id,
                        status: event.target.value,
                      })
                    }
                  >
                    {["SHORTLISTED", "SELECTED", "REJECTED"].map((status) => (
                      <option key={status} value={status}>
                        {status.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </Modal>
  );
}
