# Academic core — slices 1, 2 and 3

Phase 2 of CampusOS. The platform managed requests, fees and certificates but
not teaching; this adds the domain behind the roles that had none.

- **Slice 1 — structure and timetable:** subjects, rooms and a weekly schedule,
  role-scoped reads, department-scoped writes.
- **Slice 2 — attendance:** one register per class meeting, derived
  percentages, reasoned and audited corrections, faculty marking, student view,
  HOD roll-up, and a colour-coded attendance card on the student dashboard.
- **Slice 3 — marks and results:** assessment components, per-student marks,
  derived percentages and grades, arrears, and a per-programme release gate so
  nothing is visible to a student before it is published.

The hostel, library and placement domains are **not** here; see
[What comes next](#what-comes-next).

---

## Data model

### `Subject` — one teachable paper

| Field | Type | Notes |
| --- | --- | --- |
| `code` | string | `CS301`. Unique **per programme**, not globally. |
| `name` | string | |
| `department` | ref `Department` | Drives HOD scope and reporting. |
| `program` | ref `Program` | Must belong to the same department. Enforced in the service. |
| `semester` | 1–12 | |
| `credits` | 0–20 | Default 3. |
| `kind` | `THEORY \| LAB \| PROJECT \| SEMINAR` | |
| `isActive` | boolean | Retirement, never deletion. |

Indexes: `{ program, code }` unique, `{ department, semester, isActive }`.

**Why retire instead of delete:** a timetable entry — and later an attendance
record — points at the subject. Deleting it orphans the history that explains a
student's attendance percentage.

### `Room` — a schedulable space

`block`, `name`, `capacity`, `kind` (`CLASSROOM | LAB | SEMINAR | AUDITORIUM`),
`isActive`. Unique on `{ block, name }` — "Seminar Hall" legitimately exists in
two buildings. Rooms are institution-wide; a room does not belong to a
department.

### `TimetableEntry` — one weekly meeting

| Field | Type | Notes |
| --- | --- | --- |
| `term` | ref `AcademicTerm` | Must not be `CLOSED`. |
| `subject` | ref `Subject` | Must be active. |
| `faculty` | ref `User` | Role must be `FACULTY` or `HOD`. |
| `room` | ref `Room` | Must be active. |
| `dayOfWeek` | 1–7 | ISO weekday. |
| `startMinute`, `endMinute` | 0–1440 | Minutes from midnight. |
| `isActive` | boolean | Soft removal. |

Indexes: `{ term, dayOfWeek, startMinute }`, `{ faculty, term, dayOfWeek }`,
`{ subject, term }`, `{ room, term, dayOfWeek, startMinute }`.

**Why minutes, not `"09:00"`:** the clash check is interval arithmetic. Formatted
times cannot be subtracted reliably, and the frontend can format a number but
cannot reliably parse every string a client might send.

---

## Clash rules

An entry is refused when it intersects an active entry in the same term on the
same weekday and:

1. **the same room** — `start < other.end && end > other.start`;
2. **the same faculty member**;
3. **the same cohort** — any subject with the same `program` and `semester`,
   because those students take all of them.

Back-to-back classes (`end === start`) are allowed.

The check is service-layer, not a unique index: MongoDB can enforce "same start
minute", not "intersecting intervals". Two simultaneous inserts could both pass
the check; the window is small and a duplicate is immediately visible. This is
recorded as a limitation rather than hidden behind an index that does not do the
job.

---

## Permissions

| Permission | Held by | Meaning |
| --- | --- | --- |
| `subject:read:institution` | student, faculty, HOD, exam, dean, principal, super | reference data |
| `subject:manage:institution` | exam admin, super admin | any subject |
| `subject:manage:department` | HOD | only their department's subjects |
| `room:read:institution` | faculty, HOD, exam, dean, principal, super | |
| `room:manage:institution` | exam admin, super admin | |
| `timetable:read:own` | student, faculty | student → their programme + semester; faculty → classes they teach |
| `timetable:read:department` | HOD | every class in the department |
| `timetable:read:institution` | exam, dean, principal, super | |
| `timetable:manage:institution` | exam admin, super admin | |
| `timetable:manage:department` | HOD | only classes for their department's subjects |

Route middleware answers "may this role manage?"; the service re-checks the
record's department. Both are required: the first prevents an unrelated role
from reaching the endpoint, the second prevents a HOD from editing another
department's timetable by guessing an id.

`SUPER_ADMIN` receives academic **configuration** (subjects, rooms, timetable)
but not attendance or marks — platform administration should not confer access
to a student's academic record.

---

## API

All under `/api/v1`, cookie-authenticated, CSRF required on writes.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/subjects` | `subject:read` | filters `program`, `department`, `semester`, `q`, `active` |
| GET | `/subjects/:id` | `subject:read` | |
| POST | `/subjects` | manage (inst/dept) | department must own the programme |
| PATCH | `/subjects/:id` | manage (inst/dept) | scope checked on current **and** next department |
| DELETE | `/subjects/:id` | manage (inst/dept) | retires; returns `activeEntries` |
| GET | `/rooms` | `room:read` | filters `q`, `kind`, `active` |
| GET | `/rooms/:id` | `room:read` | |
| POST | `/rooms` | `room:manage` | unique `{block, name}` |
| PATCH | `/rooms/:id` | `room:manage` | |
| DELETE | `/rooms/:id` | `room:manage` | retires; returns `activeEntries` |
| GET | `/timetable` | any timetable read | returns `{ term, entries }`; scope applied |
| GET | `/timetable/staff` | any timetable manage | staff a class can be assigned to |
| GET | `/timetable/:id` | any timetable read | |
| POST | `/timetable` | manage (inst/dept) | clash-checked |
| PATCH | `/timetable/:id` | manage (inst/dept) | re-checks clashes excluding itself |
| DELETE | `/timetable/:id` | manage (inst/dept) | soft removal |

Response envelope is the house contract: `{ success, message, data, meta }`.
`GET /timetable` returns `{ term, entries }` and `meta.canManage`, because "no
classes" and "no term open" are different states for the UI.

Every write records an audit entry (`SUBJECT_*`, `ROOM_*`,
`TIMETABLE_ENTRY_*`).

---

## Frontend

- **`/timetable`** — one page for every audience. Six day columns, class cards
  with time, subject, teacher, room and kind. Managers get **Add class** and a
  remove action; the dialog lists only active subjects, rooms and teaching
  staff. Empty states distinguish "no term open" from "nothing scheduled".
- **`/management/academics`** — subjects and rooms, with create dialogs. Gated
  on any academic manage permission; a HOD sees the page but can only create
  subjects for their own department and cannot create rooms.

Both pages use the existing glass surface, status chips and form primitives, so
they are visually part of the product rather than bolted on.

---

## Verification

- `tests/timetable.test.js` — 15 tests: overlap vs identical start, room /
  faculty / cohort clashes, back-to-back allowance, student scope, faculty
  scope, HOD department scope (allow + deny), retired subject, closed term, room
  retirement count, audit entry, programme/department mismatch, HTTP 403 for a
  student.
- Full backend suite: 36 files / 843 tests.
- Frontend: 18 files / 181 tests, production build.
- Manual: seeded 3 subjects, 2 rooms and 6 classes through the real API;
  signed in as `demo.student.democs001@campusos.local` and confirmed the student
  sees exactly their six classes (and gets 403 for `/rooms` and
  `/timetable/staff`).

---

## Slice 2 — attendance

### `AttendanceSession` — one register per class meeting

| Field | Type | Notes |
| --- | --- | --- |
| `entry` | ref `TimetableEntry` | Which class met. |
| `term`, `subject`, `faculty` | refs | Denormalised from the entry; summary queries filter on them. |
| `date` | Date | UTC midnight of the calendar date. |
| `records` | `[{ student, status }]` | One per roster student. `PRESENT \| ABSENT \| LATE \| EXCUSED`. |
| `markedBy`, `markedAt` | | Who recorded it, when. |
| `revision` | number | 0 until corrected. |
| `corrections` | `[{ at, by, reason }]` | Why a register changed. |

Indexes: `{ entry, date }` **unique**, `{ records.student, term }`,
`{ term, subject, date }`.

**There is no percentage field anywhere.** Every figure is an aggregation over
records: `held` counts sessions where the student is on the roster, `attended`
counts `PRESENT` and `LATE`. `EXCUSED` still counts as an absence for the 75%
rule. The threshold (75) is a policy constant used to flag students, never a
hard block.

### Rules

- A register must cover **exactly** the roster. Partial registers are refused
  rather than defaulting anyone to absent — a teacher's omission should not
  punish a student, and defaulting to present would be worse.
- A class can only be marked on a date whose weekday matches the timetable
  entry.
- One register per entry per date, enforced by a unique index; the service
  check makes the common duplicate a clear 409 rather than a raw driver error.
- A closed term cannot receive new attendance; corrections remain possible and
  audited.
- Marking: the teacher of that class, or a HOD / examination office marking on
  their behalf.
- Correcting: the teacher, a HOD for the department, or the examination office
  institution-wide. A reason of 5–500 characters is required; it is stored on
  the register and the audit entry records who, when and which revision —
  without copying the free text into the wider-readable audit trail.

### API

| Method | Path | Permission | Returns |
| --- | --- | --- | --- |
| GET | `/attendance/me?term=` | `attendance:read:own` | overall + per-subject derived figures |
| GET | `/attendance/day?date=` | `attendance:mark:own` | the caller's classes that day, marked/unmarked |
| GET | `/attendance/entry/:id?date=` | mark or correct | entry, roster, existing register |
| POST | `/attendance/sessions` | `attendance:mark:own` | created register + counts |
| PATCH | `/attendance/sessions/:id` | mark or correct | corrected register, revision, counts |
| GET | `/attendance/subjects/:subjectId?term=` | any read | per-student breakdown |
| GET | `/attendance/overview?term=` | department or institution read | per-subject roll-up |

### UI

`/attendance` is one route with three views: a student's percentage cards, a
faculty member's day list with a marking/correction dialog (status buttons per
student, bulk present/absent, required reason when correcting), and a HOD /
examination roll-up table.

### Verification

`tests/attendance.test.js` — 14 tests: counts, partial roster, outsider
student, wrong weekday, duplicate marking, non-teaching teacher, closed term,
student isolation, correction + revision + audit, correction denied to another
teacher, day view state, HOD roll-up scoping, subject summary denial, HTTP 403
and required-reason validation. Full backend suite: 37 files / 857 tests.

---

## Slice 3 — marks and results

### Models

**`Assessment`** — one component of a subject in a term.

`term`, `subject`, `name`, `kind` (`INTERNAL | EXTERNAL | PRACTICAL | PROJECT |
VIVA`), `maxMarks`, `sequence`, `isActive`. Unique `{ subject, term, name }`.

**`AssessmentMark`** — one student's mark for one component.

`assessment`, `subject`, `term`, `student`, `marksObtained`, `enteredBy`.
Unique `{ assessment, student }`. `subject` and `term` are denormalised from the
component so the marks sheet is a single-collection query.

**`ResultRelease`** — one programme's release for a term.

`term`, `program`, `publishedBy`, `publishedAt`. Unique `{ term, program }`.

### Derived, never stored

No total, percentage or grade exists on any document. Every figure is computed
from the component marks: `sum(obtained) / sum(maxMarks)`, then the grade scale:

| Grade | Minimum | Points | Passing |
| --- | ---: | ---: | --- |
| O | 90 | 10 | yes |
| A+ | 80 | 9 | yes |
| A | 70 | 8 | yes |
| B+ | 60 | 7 | yes |
| B | 50 | 6 | yes |
| C | 40 | 5 | yes |
| F | 0 | 0 | no |

A missing mark produces `percentage: null` and `grade: null`, never an F —
"not marked" and "failed" are different facts.

### The release gate

Students never query results directly. `GET /results/me` first looks for a
`ResultRelease` for the student's programme and term; without one it returns
`{ published: false, results: [] }`. A result row that exists but is not
released is therefore invisible by construction, not by remembering a flag.

Releasing requires **every component of every subject in the programme to have
a mark for every student on that subject's roster**. The service counts the
gaps and refuses with the number outstanding rather than treating them as zero.

### Who can do what

| Action | Who |
| --- | --- |
| Read own results | student (released only) |
| Read subject results | faculty who teach it, HOD (department), exam/dean/principal/super (institution) |
| Create components / enter marks | faculty for their subjects, HOD for the department, exam office institution-wide |
| Release a programme | HOD for their department, exam office institution-wide |

Super admin reads but never publishes: platform administration is not academic
authority.

### API

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/results/me?term=` | released results, overall, arrears |
| GET | `/results/assessments?subject=&term=` | components |
| POST | `/results/assessments` | create a component |
| DELETE | `/results/assessments/:id` | remove a component with no marks |
| GET | `/results/subjects/:subjectId?term=` | marks sheet + derived results |
| POST | `/results/marks` | upsert one component's marks |
| POST | `/results/publish` | release `{ term, program }` |
| GET | `/results/releases?term=` | releases visible to the caller |

### UI

`/results` is one route with two views. A student sees their released overall,
grade, per-subject components and arrears, or "not released yet". Faculty and
the examination office see a subject picker, the component cards with **Enter
marks**, a derived-results table, **Add component**, and — where permitted —
**Release results** with its completeness warning.

The student dashboard also carries an attendance card: **red below 60%, amber
from 60 to under 75%, green at 75% or above**, with per-subject colours and a
link to `/attendance`.

### Verification

`tests/results.test.js` — 11 tests: component creation and duplicate names,
marks above the maximum, marks from a teacher who does not teach the subject,
invisibility before release, refusal to release with missing marks, release and
derived grades, recomputation after a correction, grade boundaries, HOD
department scoping, institution-wide release, and a student refused over HTTP.

---

## What comes next

**Slice 4 — the three hollow roles.** Hostel, library and placement get real
domains instead of inheriting request/complaint permissions.

### Known limitations in this slice

- No section/division dimension yet: the cohort is `program + semester`. Adding
  divisions later means a `section` filter on `Student` and on the timetable.
- Overlap detection is not atomic under simultaneous inserts (documented above).
- The timetable grid is weekly and repeating; no term-date exceptions, holidays
  or one-off swaps yet.
- `TimetableEntry` is removed softly; there is no restore endpoint yet.
