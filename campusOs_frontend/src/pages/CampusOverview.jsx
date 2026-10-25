import { useQuery } from "@tanstack/react-query";
import {
  BedDouble,
  BookOpen,
  Briefcase,
  GraduationCap,
  TrendingUp,
} from "lucide-react";

import { apiGet } from "../api/client";
import { Stat } from "../components/ui/Card";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";

/**
 * Campus overview.
 *
 * The server returns only the sections this caller may read, so the page never
 * decides visibility for itself: an absent section is absent because the
 * response does not contain it. That is what lets a warden see occupancy
 * without seeing library circulation.
 */
export default function CampusOverview() {
  const query = useQuery({
    queryKey: ["analytics", "campus"],
    queryFn: () => apiGet("/analytics/campus"),
  });

  if (query.isPending) return <Loading label="Loading the campus picture" />;
  if (query.isError) {
    return (
      <ErrorState
        message={
          query.error?.message ?? "Campus analytics could not be loaded."
        }
        onRetry={() => query.refetch()}
      />
    );
  }

  const data = query.data?.data;
  const sections = data?.sections ?? {};
  const available = Object.keys(sections);

  if (available.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No campus data for this role"
        description="Campus figures are available to wardens, library and placement staff, and institutional oversight."
      />
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
          Campus overview
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500 dark:text-ink-400 dark:text-ink-500">
          Live figures from the hostel, library, placements and academic
          records. Every number is computed at read time; nothing here is a
          stored total.
        </p>
      </header>

      {sections.hostel && (
        <section className="space-y-3">
          <SectionHeading icon={BedDouble} title="Hostel" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Occupancy"
              value={
                sections.hostel.occupancyPercentage === null
                  ? "—"
                  : `${sections.hostel.occupancyPercentage}%`
              }
              hint={`${sections.hostel.occupied} of ${sections.hostel.beds} beds`}
              tone={
                sections.hostel.occupancyPercentage === null
                  ? "default"
                  : sections.hostel.occupancyPercentage >= 90
                    ? "warn"
                    : "good"
              }
              icon={BedDouble}
            />
            <Stat
              label="Blocks"
              value={sections.hostel.blocks}
              hint={`${sections.hostel.rooms} rooms`}
            />
            <Stat
              label="Beds"
              value={sections.hostel.beds}
              hint={`${sections.hostel.occupied} occupied`}
            />
            <Stat
              label="Pending leave"
              value={sections.hostel.pendingLeaves}
              hint="Awaiting a warden"
              tone={sections.hostel.pendingLeaves > 0 ? "warn" : "default"}
            />
          </div>
        </section>
      )}

      {sections.library && (
        <section className="space-y-3">
          <SectionHeading icon={BookOpen} title="Library" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="On loan"
              value={sections.library.onLoan}
              hint={`${sections.library.available} of ${sections.library.copies} copies available`}
            />
            <Stat
              label="Overdue"
              value={sections.library.overdue}
              hint="Past their due date"
              tone={sections.library.overdue > 0 ? "bad" : "good"}
            />
            <Stat
              label="Titles"
              value={sections.library.titles}
              hint={`${sections.library.copies} copies`}
            />
            <Stat
              label="Loans · 30 days"
              value={sections.library.loansLast30Days}
              hint="Issued recently"
            />
          </div>
        </section>
      )}

      {sections.placements && (
        <section className="space-y-3">
          <SectionHeading icon={Briefcase} title="Placements" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Selection rate"
              value={
                sections.placements.selectionPercentage === null
                  ? "—"
                  : `${sections.placements.selectionPercentage}%`
              }
              hint={`${sections.placements.applications.selected} selected`}
              tone="good"
            />
            <Stat
              label="Open drives"
              value={sections.placements.drives.open}
              hint={`${sections.placements.drives.total} drives in total`}
            />
            <Stat
              label="Applications"
              value={sections.placements.applications.total}
              hint={`${sections.placements.applications.shortlisted} shortlisted`}
            />
            <Stat
              label="Companies"
              value={sections.placements.companies}
              hint={`${sections.placements.applications.selected} offers`}
            />
          </div>
        </section>
      )}

      {sections.academics && (
        <section className="space-y-3">
          <SectionHeading
            icon={GraduationCap}
            title="Academics"
            note={sections.academics.term?.name}
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Average attendance"
              value={
                sections.academics.averageAttendance === null
                  ? "—"
                  : `${sections.academics.averageAttendance}%`
              }
              hint={`Across ${sections.academics.marks} marked records`}
              tone={
                sections.academics.averageAttendance === null
                  ? "default"
                  : sections.academics.averageAttendance >= 75
                    ? "good"
                    : sections.academics.averageAttendance >= 60
                      ? "warn"
                      : "bad"
              }
              icon={GraduationCap}
            />
            <Stat
              label="Registers"
              value={sections.academics.sessions}
              hint="Class meetings marked this term"
            />
            <Stat
              label="Components"
              value={sections.academics.assessments}
              hint={`${sections.academics.marksEntered} marks entered`}
            />
            <Stat
              label="Results released"
              value={sections.academics.resultsReleased}
              hint="Programmes published this term"
              tone={sections.academics.resultsReleased > 0 ? "good" : "default"}
            />
          </div>
        </section>
      )}

      <p className="text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
        Generated {new Date(data.generatedAt).toLocaleString()}. Sections you
        cannot read are omitted rather than shown as zero.
      </p>
    </div>
  );
}

function SectionHeading({ icon: Icon, title, note }) {
  return (
    <div className="flex items-baseline gap-2">
      <Icon className="size-4 text-ink-400 dark:text-ink-500" aria-hidden="true" />
      <h2 className="text-[0.9375rem] font-semibold tracking-tight text-ink-900 dark:text-ink-100">
        {title}
      </h2>
      {note && (
        <span className="text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">· {note}</span>
      )}
    </div>
  );
}
