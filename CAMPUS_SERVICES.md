# Campus services — hostel, library and placements

Phase 2, slice 4. The three roles that previously held a generic request and
complaint permission set now own a real domain. Their old grants were removed,
not merely supplemented.

---

## Why the roles changed

Before this slice, `HOSTEL_ADMIN`, `LIBRARY_ADMIN` and `PLACEMENT_ADMIN` could
read institution requests, triage complaints and resolve grievances — powers
they held only because no domain existed for them. That is exactly the shape of
an over-privileged role: the permission list described seniority, not work.

After this slice:

| Role | Domain grants | Request/complaint grants |
| --- | --- | --- |
| `HOSTEL_ADMIN` | `hostel:read:institution`, `hostel:manage:institution`, `hostel:approve:institution` | **removed** |
| `LIBRARY_ADMIN` | `library:read:institution`, `library:manage:institution`, `library:issue:institution` | **removed** |
| `PLACEMENT_ADMIN` | `placement:read:institution`, `placement:manage:institution` | **removed** |

Students gained the matching own-scope grants: `hostel:read:own`,
`hostel:leave:own`, `library:read:own`, `placement:read:own`,
`placement:apply:own`. Deans, principals and the super administrator read all
three domains; none of them manage them.

---

## Hostel

### Models

**`Hostel`** — `name` (unique), `code` (unique), `kind` (`BOYS | GIRLS | COED`),
`address`, `isActive`.

**`HostelRoom`** — `hostel`, `number`, `capacity` (1–20), `isActive`.
Unique `{ hostel, number }`.

**`HostelAllocation`** — `student`, `hostel`, `room`, `academicYear`, `status`
(`ACTIVE | VACATED`), `allocatedBy`, `vacatedAt`.
**Partial unique index on `{ student }` where `status = ACTIVE`** — one active
room per student is a database fact, not a service convention.

**`HostelLeave`** — `student`, `allocation`, `fromDate`, `toDate`, `reason`,
`status` (`PENDING | APPROVED | REJECTED | CANCELLED`), `decidedBy`,
`decidedAt`, `decisionNote`.

### Rules

- Allocation requires an active student, an active room, and a free bed. The
  capacity check counts active allocations at the moment of allocation.
- A student with an active allocation cannot be allocated again.
- Leaving requires an active allocation and a leave end on or after its start.
- Only the warden decides leave; only a pending request can be decided.
- Allocation and vacation are audited; leave requests and decisions are audited.

### API

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/hostel/hostels` | `hostel:read:institution` |
| POST | `/hostel/hostels` | `hostel:manage` |
| GET/POST | `/hostel/hostels/:id/rooms` | read / manage |
| GET | `/hostel/allocations` | `hostel:read:institution` |
| POST | `/hostel/allocations` | `hostel:manage` |
| POST | `/hostel/allocations/:id/vacate` | `hostel:manage` |
| GET | `/hostel/me` | `hostel:read:own` |
| POST | `/hostel/leaves` | `hostel:leave:own` |
| GET | `/hostel/leaves` | `hostel:approve` or institution read |
| POST | `/hostel/leaves/:id/decide` | `hostel:approve` |
| GET | `/hostel/students?q=` | `hostel:manage` — roll/name lookup for allocation |

---

## Library

### Models

**`Book`** — `title`, `author`, `isbn`, `category`, `copiesTotal`,
`copiesIssued`, `isActive`. Text index on title/author.

**`BookIssue`** — `book`, `student`, `issuedBy`, `issuedAt`, `dueAt`,
`returnedAt`, `returnedBy`, `status` (`ISSUED | RETURNED`).
**Partial unique index on `{ book, student }` where `status = ISSUED`** — one
copy of a title per student at a time.

### Rules

- Issuing claims a copy with one atomic
  `findOneAndUpdate({ $expr: { $lt: ["$copiesIssued", "$copiesTotal"] } }, { $inc: ... })`.
  Reading the count and then incrementing would let two borrowers take the same
  last copy.
- A duplicate issue by the same student rolls the increment back and returns 409.
- Returning is idempotent: the second return does not decrement again.
- Overdue is derived (`ISSUED` and `dueAt < now`); there are no fines yet.

### API

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/library/books?q=&category=` | own or institution read |
| POST | `/library/books` | `library:manage` |
| GET | `/library/issues` | `library:read:institution` |
| POST | `/library/issues` | `library:issue` |
| POST | `/library/issues/:id/return` | `library:issue` |
| GET | `/library/me` | `library:read:own` |
| GET | `/library/students?q=` | `library:issue` — roll/name lookup for issuing |

---

## Placements

### Models

**`Company`** — `name` (unique), `sector`, `website`, `isActive`.

**`PlacementDrive`** — `company`, `title`, `role`, `description`, `location`,
`ctcPaise`, `eligiblePrograms[]`, `eligibleSemesters[]`, `applicationDeadline`,
`driveDate`, `status` (`DRAFT | OPEN | CLOSED`), `createdBy`.

**`PlacementApplication`** — `drive`, `student`, `status`
(`APPLIED | SHORTLISTED | SELECTED | REJECTED | WITHDRAWN`), `appliedAt`.
Unique `{ drive, student }`.

### Rules

- Students only ever receive `OPEN` drives; a draft is invisible, not merely
  unlinked.
- Applying requires: open drive, deadline not passed, programme in
  `eligiblePrograms` (empty means all), semester in `eligibleSemesters`.
- One application per drive per student; withdrawal is allowed from `APPLIED` or
  `SHORTLISTED` only.
- Drive status transitions are explicit: `DRAFT → OPEN | CLOSED`,
  `OPEN → CLOSED`, and `CLOSED` is terminal.
- Creating a drive before its application deadline is refused.

### API

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/placement/drives` | own or institution read |
| GET | `/placement/companies` | `placement:manage` |
| POST | `/placement/companies` | `placement:manage` |
| POST | `/placement/drives` | `placement:manage` |
| POST | `/placement/drives/:id/status` | `placement:manage` |
| POST | `/placement/drives/:id/apply` | `placement:apply:own` |
| POST | `/placement/drives/:id/withdraw` | `placement:apply:own` |
| GET | `/placement/me` | `placement:read:own` |
| GET | `/placement/drives/:id/applications` | `placement:read:institution` |
| PATCH | `/placement/applications/:id` | `placement:manage` |

---

## Verification

`tests/campus-services.test.js` — 13 tests:

- hostel capacity, one-active-allocation, leave requires allocation, warden-only
  decision, HTTP 403 for a student allocating;
- library last-copy atomicity, duplicate-borrow rollback, idempotent return;
- placements draft invisibility, duplicate application, withdrawal, programme
  eligibility, deadline, and application progression;
- a direct assertion that the three roles no longer hold the generic request and
  complaint permissions.

Every write records an audit entry (`HOSTEL_*`, `BOOK_*`, `PLACEMENT_*`).

---

## Interface

Three screens, all wired into the sidebar:

- **`/hostel`** — a student sees their room and requests leave, with the status
  of every request; a warden gets tabs for allocations (with an allocate dialog
  that searches students by roll number/name and picks a block and room),
  pending leave decisions, and blocks/rooms setup.
- **`/library`** — everyone searches the catalogue and sees live availability;
  a student sees their own loans and overdue state; staff add titles, issue a
  book to a searched student, and return books from the on-loan list.
- **`/placements`** — a student sees open drives with deadline, location and CTC,
  applies or withdraws, and sees their applications; the placement office
  creates companies and drives, opens/closes them, and moves applications
  through shortlisted, selected or rejected.

The interfaces call the same APIs documented above; no page calculates
availability, percentages or eligibility itself.

### Demo data

The original demo seed predates these roles, so they have no accounts. Run:

```bash
cd campusOs_backend
node scripts/seed-campus-demo.js
```

This is idempotent and creates `demo.hostel@campusos.local`,
`demo.library@campusos.local` and `demo.placement@campusos.local` (password
`Demo@Campus123`), a hostel block and room with an allocation and a pending
leave, a book on loan, and an open drive with one application.

## Verification (interface)

`npm run build` and the frontend suite (181 tests) pass. The three screens were
checked in a real browser as the demo student and the demo warden against the
seeded data:

- placements: open drive, applied state and withdrawal;
- library: catalogue availability (2 of 3) and the student's loan;
- hostel: the warden's allocation table, tabs and allocate action.

## Not built yet

- No library fines, reservations or renewals; overdue is derived only.
- No hostel rent, room change, waitlist or bulk allocation.
- No CGPA eligibility on drives: `Student` has no CGPA field, so a `minCgpa`
  rule could not be enforced.
- No company/drive search or pagination; lists are bounded by the API limits.
- No notification on approval, issue or shortlisting.
