import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";

import { apiGet } from "../api/client";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";
import { inputClass } from "../components/ui/Field.jsx";

/**
 * Staff directory.
 *
 * A finding-people tool: who works here, how they present themselves, and what
 * they say they can speak for. Deliberately dumb about contact details — the
 * list shows who somebody is, not how to reach them privately. Search matches
 * a name fragment, a designation fragment, or one of the skills a person has
 * declared, and the server does the matching so the client never has to.
 */
const STAFF_ROLES = [
  "SUPPORT_STAFF",
  "FACULTY",
  "HOD",
  "EXAM_ADMIN",
  "ACCOUNTS_ADMIN",
  "HOSTEL_ADMIN",
  "LIBRARY_ADMIN",
  "PLACEMENT_ADMIN",
  "DEAN",
  "PRINCIPAL",
  "SUPER_ADMIN",
];

function humanise(role) {
  if (!role) return "";
  return role
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function roleLabel(role) {
  if (role === "HOD") return "HoD";
  if (role === "SUPER_ADMIN") return "Super Administrator";
  if (role === "EXAM_ADMIN") return "Examinations";
  if (role === "ACCOUNTS_ADMIN") return "Accounts";
  if (role === "HOSTEL_ADMIN") return "Hostel Office";
  if (role === "LIBRARY_ADMIN") return "Library";
  if (role === "PLACEMENT_ADMIN") return "Placements";
  return humanise(role);
}

export default function StaffDirectory() {
  const [draft, setDraft] = useState("");
  const [applied, setApplied] = useState("");
  const [role, setRole] = useState("");

  const results = useQuery({
    queryKey: ["directory", "staff", applied, role],
    queryFn: () => {
      const params = new URLSearchParams();
      if (applied) params.set("q", applied);
      if (role) params.set("role", role);
      const qs = params.toString();
      return apiGet(`/directory/staff${qs ? `?${qs}` : ""}`);
    },
  });

  const rows = results.data?.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
          Staff directory
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
          Find people by name, designation or expertise. Contact details are
          deliberately not listed here.
        </p>
      </header>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(draft.trim());
        }}
      >
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400 dark:text-ink-500"
            aria-hidden="true"
          />
          <input
            aria-label="Search the staff directory"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="e.g. Rao, Machine Learning, Associate Professor"
            className={`${inputClass} pl-9`}
            maxLength={80}
          />
        </div>
        <select
          aria-label="Filter by role"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className={`${inputClass} w-auto`}
        >
          <option value="">All roles</option>
          {STAFF_ROLES.map((item) => (
            <option key={item} value={item}>
              {roleLabel(item)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition hover:brightness-110"
        >
          Search
        </button>
      </form>

      {results.isLoading && <Loading label="Looking through the directory" />}
      {results.isError && (
        <ErrorState message={results.error?.message} onRetry={results.refetch} />
      )}

      {!results.isLoading && !results.isError && rows.length === 0 && (
        <EmptyState
          icon={Users}
          title="No matches"
          description={
            applied
              ? "Try a shorter fragment — the search matches the start of names, designations and skills."
              : "The directory is empty for this filter."
          }
        />
      )}

      {rows.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((person) => (
            <li
              key={person.id}
              className="rounded-xl border border-ink-200 bg-surface p-4 dark:border-ink-700"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-ink-900 dark:text-ink-100">{person.fullName}</h2>
                  <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-300">
                    {roleLabel(person.role)}
                    {person.designation ? ` · ${person.designation}` : ""}
                  </p>
                  {person.expertise.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {person.expertise.map((skill) => (
                        <span
                          key={skill}
                          className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-700 dark:bg-ink-800 dark:text-ink-300"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
