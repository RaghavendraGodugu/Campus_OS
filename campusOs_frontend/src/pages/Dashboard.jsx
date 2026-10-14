import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgeCheck,
  BellRing,
  FileText,
  IndianRupee,
  Megaphone,
  Receipt,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";

import { apiGet } from "../api/client";
import { useAuth } from "../context/AuthContext";
import {
  formatDate,
  formatMoney,
  formatRelative,
  humanise,
} from "../lib/format";
import { Card, Stat } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import { EmptyState, ErrorState } from "../components/ui/States";
import {
  SkeletonList,
  SkeletonRegion,
  SkeletonStats,
} from "../components/ui/Skeleton";

/**
 * The dashboard.
 *
 ## What it shows is decided by permission, not by role name

 A student sees their own invoices; a HOD sees their department's counts; a
 dean sees institution figures and a report summary. The server already worked
 out which is which and returned the permission list, so this reads that rather
 than maintaining a second role map that would drift.

 A section the user may not see is not rendered at all. Rendering "Complaints:
 0" to someone without complaint access would be a claim they have no basis to
 receive.
 */
export default function Dashboard() {
  const { user, student, can, canAny } = useAuth();

  const isStudent = user?.role === "STUDENT";

  const overview = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: () => apiGet("/reports/overview"),
    enabled: canAny("report:read:department", "report:read:institution"),
  });

  const myRequests = useQuery({
    queryKey: ["dashboard", "requests"],
    queryFn: () => apiGet("/requests?limit=5"),
    enabled: can("request:read:own"),
  });

  const myInvoices = useQuery({
    queryKey: ["dashboard", "invoices"],
    queryFn: () => apiGet("/finance/invoices?limit=5"),
    enabled: can("invoice:read:own"),
  });

  const announcements = useQuery({
    queryKey: ["dashboard", "announcements"],
    queryFn: () => apiGet("/announcements?limit=4"),
    enabled: can("announcement:read:institution"),
  });

  const firstName = user?.fullName?.split(" ")[0] ?? "there";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Hello, {firstName}
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          {isStudent && student
            ? `${humanise(user.role)} · Roll ${student.rollNumber}`
            : humanise(user?.role)}
        </p>
      </header>

      {announcements.data?.data?.length > 0 && (
        <AnnouncementStrip items={announcements.data.data} />
      )}

      {isStudent && student && <StudentStrip student={student} />}

      {canAny("report:read:department", "report:read:institution") && (
        <section aria-label="Key figures">
          {overview.isLoading && (
            <SkeletonRegion label="Loading figures">
              <SkeletonStats count={3} />
            </SkeletonRegion>
          )}
          {overview.isError && (
            <ErrorState
              title="Could not load your figures"
              message={overview.error?.message}
              onRetry={() => overview.refetch()}
            />
          )}
          {overview.data && <OverviewStats data={overview.data} />}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {can("request:read:own") && (
          <Card
            title="Your recent requests"
            actions={
              <Link
                to="/requests"
                className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline"
              >
                View all
              </Link>
            }
          >
            {myRequests.isLoading && (
              <SkeletonRegion label="Loading your requests">
                <SkeletonList rows={4} />
              </SkeletonRegion>
            )}
            {myRequests.data?.data?.length === 0 && (
              <EmptyState
                icon={FileText}
                title="No requests yet"
                description="Raise one and you can follow it here at every step."
                action={
                  <Link
                    to="/requests"
                    className="mt-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    Raise a request
                  </Link>
                }
              />
            )}
            {myRequests.data?.data?.length > 0 && (
              <ul className="divide-y divide-ink-100">
                {myRequests.data.data.map((request) => (
                  <li
                    key={request.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-800">
                        {request.title}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                        {request.reference} ·{" "}
                        {formatRelative(request.createdAt)}
                      </p>
                    </div>
                    <Badge status={request.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {can("invoice:read:own") && (
          <Card
            title="Your invoices"
            actions={
              <Link
                to="/finance/invoices"
                className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline"
              >
                View all
              </Link>
            }
          >
            {myInvoices.isLoading && (
              <SkeletonRegion label="Loading your invoices">
                <SkeletonList rows={4} />
              </SkeletonRegion>
            )}
            {myInvoices.data?.data?.length === 0 && (
              <EmptyState
                icon={Receipt}
                title="Nothing to pay"
                description="You have no invoices right now."
              />
            )}
            {myInvoices.data?.data?.length > 0 && (
              <ul className="divide-y divide-ink-100">
                {myInvoices.data.data.map((invoice) => (
                  <li
                    key={invoice.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-800">
                        {invoice.purpose}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                        {invoice.reference} · due {formatDate(invoice.dueAt)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-ink-900">
                        {invoice.totalFormatted ?? formatMoney(invoice.total)}
                      </p>
                      <Badge status={invoice.status} className="mt-1" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <QuickLinks />
    </div>
  );
}

/** Pinned and urgent notices, above everything else. */
function AnnouncementStrip({ items }) {
  const top = items.slice(0, 3);

  return (
    <section aria-label="Announcements" className="space-y-2">
      {top.map((announcement) => (
        <Link
          key={announcement.id}
          to={`/announcements/${announcement.reference}`}
          className={`flex items-start gap-3 rounded-xl px-4 py-3 ring-1 transition-colors ${
            announcement.priority === "URGENT"
              ? "bg-red-50 dark:bg-red-500/12 text-red-900 dark:text-red-200 ring-red-200 dark:ring-red-400/25 hover:bg-red-100"
              : "bg-white text-ink-800 ring-ink-200 dark:ring-ink-600 hover:bg-ink-50 dark:hover:bg-ink-200/40"
          }`}
        >
          <Megaphone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {announcement.priority === "URGENT" && (
                <span className="mr-1.5 rounded bg-red-600 px-1 py-0.5 text-[10px] font-semibold text-white uppercase">
                  Urgent
                </span>
              )}
              {announcement.title}
            </p>
            <p className="mt-0.5 line-clamp-1 text-xs opacity-80">
              {announcement.body}
            </p>
          </div>
        </Link>
      ))}
    </section>
  );
}

/** A student's own academic identity, with the one thing they most need to know. */
function StudentStrip({ student }) {
  return (
    <Card>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail label="Roll number" value={student.rollNumber} />
        <Detail label="Programme" value={student.program?.name ?? "—"} />
        <Detail label="Semester" value={student.semester ?? "—"} />
        <Detail label="Fee status" value={humanise(student.feeStatus)} />
      </dl>
    </Card>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-ink-500 dark:text-ink-400 uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-ink-900">
        {value ?? "—"}
      </dd>
    </div>
  );
}

/** Figures the signed-in user is entitled to see. */
function OverviewStats({ data }) {
  const stats = [];

  if (data.students) {
    stats.push(
      <Stat
        key="students"
        label={
          data.scope === "DEPARTMENT"
            ? "Students in your department"
            : "Students"
        }
        value={data.students.total.toLocaleString("en-IN")}
        hint={`${data.students.active.toLocaleString("en-IN")} active`}
        icon={TrendingUp}
      />,
    );
  }

  if (data.requests) {
    stats.push(
      <Stat
        key="requests"
        label="Open requests"
        value={data.requests.open.toLocaleString("en-IN")}
        hint={`${data.requests.total.toLocaleString("en-IN")} in the last ${data.period.days} days`}
        tone={data.requests.escalated > 0 ? "warn" : "default"}
        icon={FileText}
      />,
    );
  }

  if (data.complaints) {
    stats.push(
      <Stat
        key="complaints"
        label="Open complaints"
        value={data.complaints.open.toLocaleString("en-IN")}
        hint={`${data.complaints.total.toLocaleString("en-IN")} all time`}
        tone={data.complaints.open > 0 ? "warn" : "good"}
        icon={ShieldAlert}
      />,
    );
  }

  if (data.finance) {
    stats.push(
      <Stat
        key="collected"
        label="Collected"
        value={data.finance.collectedInPeriodFormatted}
        hint={`${data.finance.outstandingTotalFormatted} outstanding overall`}
        icon={IndianRupee}
      />,
    );
  }

  if (data.certificates) {
    stats.push(
      <Stat
        key="certificates"
        label="Certificates"
        value={data.certificates.total.toLocaleString("en-IN")}
        hint={`${data.certificates.newInPeriod.toLocaleString("en-IN")} issued recently`}
        icon={BadgeCheck}
      />,
    );
  }

  if (stats.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{stats}</div>
  );
}

/** The actions this role most often needs, and nothing else. */
function QuickLinks() {
  const { can } = useAuth();

  const links = [
    {
      to: "/requests",
      label: "Raise a request",
      icon: FileText,
      show: can("request:create:own"),
    },
    {
      to: "/complaints/new",
      label: "Raise a complaint",
      icon: ShieldAlert,
      show: can("complaint:create:own"),
    },
    {
      to: "/certificates/new",
      label: "Apply for a certificate",
      icon: BadgeCheck,
      show: can("certificate:apply:own"),
    },
    {
      to: "/finance/invoices",
      label: "View invoices",
      icon: Receipt,
      show: can("invoice:read:own"),
    },
    {
      to: "/management/requests",
      label: "Review assigned work",
      icon: AlertTriangle,
      show: can("request:read:assigned"),
    },
    {
      to: "/reports",
      label: "Open reports",
      icon: TrendingUp,
      show: can("report:read:department"),
    },
    {
      to: "/audit",
      label: "Audit trail",
      icon: BellRing,
      show: can("audit:read:department"),
    },
  ].filter((link) => link.show);

  if (links.length === 0) return null;

  return (
    <Card title="Quick actions">
      <div className="flex flex-wrap gap-2">
        {links.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="inline-flex items-center gap-2 rounded-lg bg-ink-50 dark:bg-ink-100/40 px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-ink-200 dark:ring-ink-600 transition-colors hover:bg-white hover:text-brand-700 hover:ring-brand-300"
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </div>
    </Card>
  );
}
