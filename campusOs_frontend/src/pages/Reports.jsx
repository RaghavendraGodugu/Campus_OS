import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";

import { apiGet } from "../api/client";
import { Card, Stat } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import { EmptyState, ErrorState } from "../components/ui/States";
import { SkeletonForm, SkeletonRegion } from "../components/ui/Skeleton";
import ReportExport from "../components/ReportExport";

/**
 * Reports.
 *
 * ## Sections the reader may not see are absent, not zero
 *
 * A departmental reader gets no complaints section and no finance section at
 * all. Showing "Complaints: 0" would assert that they have no grievances,
 * which is both false and something the server deliberately does not tell them.
 *
 * ## Every figure carries its period
 *
 * A number with no denominator invites the reader to supply their own. The
 * window is shown next to every figure and defaults to 30 days.
 */
const RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last year" },
];

export default function Reports() {
  const [days, setDays] = useState(30);

  const range = useMemoRange(days);

  const overview = useQuery({
    queryKey: ["report", "overview", range],
    queryFn: () => apiGet(`/reports/overview?${range}`),
  });

  const requests = useQuery({
    queryKey: ["report", "requests", range],
    queryFn: () => apiGet(`/reports/requests?${range}`),
  });

  const students = useQuery({
    queryKey: ["report", "students", range],
    queryFn: () => apiGet(`/reports/students?${range}`),
  });

  // Finance and complaint figures come from the overview, which already scopes
  // them. Fetching them separately would be a second request for data the
  // response above contains — and for a department-scoped reader it would
  // simply 403.

  if (overview.isLoading)
    return (
      <SkeletonRegion label="Loading Building your report">
        <div className="surface p-5">
          <SkeletonForm fields={4} />
        </div>
      </SkeletonRegion>
    );
  if (overview.isError) {
    return (
      <ErrorState
        message={overview.error?.message}
        onRetry={() => overview.refetch()}
      />
    );
  }

  const data = overview.data.data;
  const canSeeFinance = "finance" in data;
  const canSeeComplaints = "complaints" in data;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
            Reports
          </h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
            {data.scope === "DEPARTMENT"
              ? "Your department"
              : "The whole institution"}{" "}
            · last {data.period.days} days
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="range"
            className="text-sm text-ink-600 dark:text-ink-400 dark:text-ink-500"
          >
            Period
          </label>
          <select
            id="range"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="h-9 rounded-xl border-0 bg-white dark:bg-surface px-3 text-sm text-ink-900 dark:text-ink-100 shadow-sm ring-1 ring-ink-200 dark:ring-ink-600 transition-all duration-150 hover:ring-ink-300 focus:ring-2 focus:ring-brand-500"
          >
            {RANGES.map((option) => (
              <option key={option.days} value={option.days}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/*
        One export control per report rather than a single global button, so
        the file that arrives is the one the reader was looking at. The period
        selector above is passed straight through, because an export silently
        covering a different range from the screen is worse than no export.
      */}
      <div className="surface flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">
            Take these figures with you
          </h2>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
            The same numbers, the same period, and the same access rules as this
            page.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <ReportExport kind="overview" range={range} />
          <ReportExport kind="requests" range={range} />
          <ReportExport kind="students" range={range} />
          {canSeeComplaints && <ReportExport kind="complaints" range={range} />}
          {canSeeFinance && <ReportExport kind="finance" range={range} />}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.students && (
          <Stat
            label="Students"
            value={data.students.total.toLocaleString("en-IN")}
            hint={`${data.students.active.toLocaleString("en-IN")} active`}
          />
        )}
        {data.requests && (
          <Stat
            label="Open requests"
            value={data.requests.open.toLocaleString("en-IN")}
            hint={`${data.requests.total.toLocaleString("en-IN")} raised`}
            tone={data.requests.escalated > 0 ? "warn" : "default"}
          />
        )}
        {data.certificates && (
          <Stat
            label="Certificates"
            value={data.certificates.total.toLocaleString("en-IN")}
            hint={`${data.certificates.newInPeriod} issued in this period`}
          />
        )}
        {canSeeComplaints && (
          <Stat
            label="Open complaints"
            value={data.complaints.open.toLocaleString("en-IN")}
            hint="Institution-wide"
            tone={data.complaints.open > 0 ? "warn" : "good"}
          />
        )}
      </div>

      {canSeeFinance && data.finance && (
        <Card title="Finance" description={`Last ${data.period.days} days`}>
          <div className="grid gap-4 sm:grid-cols-4">
            <Figure
              label="Invoiced"
              value={data.finance.invoicedInPeriodFormatted}
            />
            <Figure
              label="Collected"
              value={data.finance.collectedInPeriodFormatted}
              tone="good"
            />
            <Figure
              label="Refunded"
              value={data.finance.refundedInPeriodFormatted}
            />
            <Figure
              label="Outstanding"
              value={data.finance.outstandingTotalFormatted}
              hint="All invoices, not just this period"
              tone="warn"
            />
          </div>
        </Card>
      )}

      {requests.data && (
        <Card title="Requests by status">
          {requests.data.data.available === false ? (
            <EmptyState
              icon={BarChart3}
              title="Not available"
              description={requests.data.data.reason}
            />
          ) : (
            <StatusBreakdown byStatus={requests.data.data.byStatus} />
          )}
        </Card>
      )}

      {students.data && students.data.data.available !== false && (
        <Card title="Enrolment by department">
          {students.data.data.byDepartment.length === 0 ? (
            <p className="text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
              No students in this period.
            </p>
          ) : (
            <BarList
              rows={students.data.data.byDepartment.map((d) => ({
                label: d.name,
                value: d.count,
              }))}
              total={students.data.data.totals.total}
            />
          )}
        </Card>
      )}
    </div>
  );
}

/** The ISO window the server expects. */
function useMemoRange(days) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return `from=${from.toISOString()}&to=${to.toISOString()}`;
}

function StatusBreakdown({ byStatus }) {
  const entries = Object.entries(byStatus ?? {}).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0)
    return (
      <p className="text-sm text-ink-500 dark:text-ink-400">
        No requests in this period.
      </p>
    );

  return (
    <ul className="space-y-2">
      {entries.map(([status, count]) => (
        <li key={status} className="flex items-center justify-between gap-3">
          <Badge status={status} />
          <span className="text-sm font-medium tabular-nums text-ink-800 dark:text-ink-100">
            {count}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A horizontal bar list. Bars are proportional to the largest, not the total,
 *  so the shape stays readable when one category dwarfs the rest. */
function BarList({ rows, total }) {
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-ink-700 dark:text-ink-300">
              {row.label}
            </span>
            <span className="shrink-0 font-medium tabular-nums text-ink-900 dark:text-ink-100">
              {row.value}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-200/40">
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: `${Math.round((row.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
      <li className="pt-1 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
        Total {total.toLocaleString("en-IN")}
      </li>
    </ul>
  );
}

function Figure({ label, value, hint, tone = "default" }) {
  const tones = {
    default: "text-ink-900 dark:text-ink-100",
    good: "text-emerald-700 dark:text-emerald-300",
    warn: "text-amber-700 dark:text-amber-300",
  };

  return (
    <div>
      <p className="text-xs tracking-wide text-ink-500 dark:text-ink-400 dark:text-ink-500 uppercase">
        {label}
      </p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tones[tone]}`}>
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 text-xs text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500">
          {hint}
        </p>
      )}
    </div>
  );
}
