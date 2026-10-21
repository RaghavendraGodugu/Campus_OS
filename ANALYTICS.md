# Campus analytics

Phase 11, first slice. The operational domains now produce data — occupancy,
loans, applications, attendance, results — but none of it was visible in
aggregate. This adds one scoped endpoint and one page that answer "how is the
campus doing?" without granting anyone a domain they should not see.

---

## The shape

`GET /api/v1/analytics/campus`

```json
{
  "success": true,
  "message": "Campus analytics retrieved",
  "data": {
    "generatedAt": "2026-10-18T21:20:00.000Z",
    "sections": {
      "hostel": { "...": "..." },
      "library": { "...": "..." },
      "placements": { "...": "..." },
      "academics": { "...": "..." }
    }
  }
}
```

**Sections are omitted, not zeroed.** The service includes a section only if the
caller holds the matching institution read permission:

| Section | Required permission |
| --- | --- |
| `hostel` | `hostel:read:institution` |
| `library` | `library:read:institution` |
| `placements` | `placement:read:institution` |
| `academics` | `attendance:read:institution` or `result:read:institution` |

A warden therefore receives only `hostel`; a librarian only `library`; a dean
or principal receives all four. A zero would imply access to a domain the
caller cannot read, so absence is used instead.

The route is gated on **any** of those permissions — there is no generic
"analytics" grant. A student receives 403.

---

## Figures

All values are aggregates over the source collections. Nothing is stored twice.

**Hostel** — active blocks, active rooms, total beds (`sum(capacity)`), active
allocations, `occupancyPercentage = occupied / beds`, pending leave requests.

**Library** — active titles, total copies, copies issued, available copies,
issues currently `ISSUED`, overdue (`ISSUED` and `dueAt < now`), issues in the
last 30 days.

**Placements** — companies, drives by status (`draft`, `open`, `closed`,
`total`), applications by status, and
`selectionPercentage = selected / totalApplications`.

**Academics** — for the **current term**: attendance sessions, marked records,
`averageAttendance = (PRESENT + LATE) / marks`, assessment components, marks
entered, and programmes whose results have been released.

The same definitions the operational screens use are reused: `LATE` counts as
attended; a released result is a `ResultRelease`, not a flag.

---

## Interface

`/analytics` — "Campus overview" in the sidebar under Oversight.

Four sections of stat tiles, each rendered only when the response contains it:
occupancy (green under 90%, amber at 90%+ because a full hostel needs a
waitlist), loans and overdue, selection rate and drives, and average attendance
with the term name.

No chart library was added: four tiles per section answer the question and keep
the page honest at a glance. A trend view is the next step, not this one.

---

## Verification

`tests/campus-analytics.test.js` — 3 tests:

- a dean receives all four sections and every figure matches the seeded data
  (5 beds, 2 occupied, 1 overdue, 3 applications with 1 selected → 33.3%, one
  attendance record at 50%, one result release);
- each operational role receives **only** its own section;
- a student receives no sections over the service and 403 over HTTP.

The page was checked in a browser as the demo dean against seeded data.

---

## Known limits

- **Current term only** for academics; there is no term selector or historical
  comparison yet.
- **No department scoping**: a HOD does not see this page. Academic figures are
  institution-wide, which is right for a dean and wrong for a HOD; adding a
  department-scoped section is a separate change.
- **No time series**: these are point-in-time totals, not trends.
- **No export**: reports export CSV/PDF; this overview does not yet.
- Attendance average is a record-weighted mean, not a student-weighted one, so
  a class marked more often contributes more. That is deliberate for an
  operational view and should be labelled if it becomes a published metric.
