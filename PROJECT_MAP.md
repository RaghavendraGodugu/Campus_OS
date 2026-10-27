# CampusOS — Project Map

A navigational map of the repository: what every directory and file is for, how a
request travels from a browser click to MongoDB and back, and where to make a
change without hunting.

- **Product:** a college management and student-services platform — requests,
  complaints/grievances, certificates, fees, announcements, reports.
- **Shape:** npm workspaces monorepo with two apps and one root manifest.
- **Size:** ~70,600 lines of JS/JSX (excluding `node_modules`, `dist`, `build`,
  runtime storage), 150+ source files, 35 backend test suites and 18 frontend
  test suites.

| Workspace            | Package name        | Stack                                                          | Entry point     |
| -------------------- | ------------------- | -------------------------------------------------------------- | --------------- |
| `campusOs_backend/`  | `campusos-backend`  | Node 22, Express 5, Mongoose 9, Zod 4, Vitest                  | `src/server.js` |
| `campusOs_frontend/` | `campusos-frontend` | React 19, Vite 8, React Router 7, TanStack Query 5, Tailwind 4 | `src/main.jsx`  |

Where the ~70k lines live:

| Area                                            | Files |  Lines |
| ----------------------------------------------- | ----: | -----: |
| `campusOs_backend/src/services`                 |    32 | 13,030 |
| `campusOs_backend/src/models`                   |    20 |  3,872 |
| `campusOs_backend/src/controllers`              |    15 |  2,968 |
| `campusOs_backend/src/utils`                    |    12 |  2,790 |
| `campusOs_backend/src/routes`                   |    16 |  2,108 |
| `campusOs_backend/src/validators`               |    16 |  1,991 |
| `campusOs_backend/src/config`                   |     6 |  1,839 |
| `campusOs_backend/src/middleware`               |     6 |    926 |
| `campusOs_backend/src/jobs`                     |     1 |    268 |
| `campusOs_backend/tests`                        |    37 | 14,909 |
| `campusOs_backend/scripts`                      |    12 |  2,868 |
| `campusOs_frontend/src/pages`                   |    37 | 11,346 |
| `campusOs_frontend/src/components`              |    24 |  3,871 |
| `campusOs_frontend/src/test`                    |    20 |  4,880 |
| `campusOs_frontend/src/context` + `lib` + `api` |     5 |  1,084 |
| `campusOs_frontend/scripts`                     |     2 |    729 |

---

## Contents

1. [At a glance](#1-at-a-glance)
2. [Repository root](#2-repository-root)
3. [Backend](#3-backend-campusos_backend)
4. [Frontend](#4-frontend-campusos_frontend)
5. [Domain → file index](#5-domain--file-index)
6. [Request lifecycle](#6-request-lifecycle)
7. [Data model map](#7-data-model-map)
8. [Runtime and deployment topology](#8-runtime-and-deployment-topology)
9. [Where to make a change](#9-where-to-make-a-change)
10. [Conventions the code enforces](#10-conventions-the-code-enforces)
11. [Observations and rough edges](#11-observations-and-rough-edges)

---

## 1. At a glance

```
Campus_OS/
├── README.md                  product + run instructions + honest feature list
├── FEATURES.md                every feature, ticked or not, with reasons
├── DEPLOY.md                  Vercel + Render + Atlas deployment, backup, restore
├── LICENSE                    MIT / private
├── package.json               npm workspaces root: dev, test, lint, build, seed
├── package-lock.json          single lockfile for both workspaces
├── docker-compose.yml         db + api + web, one host
├── .github/workflows/
│   └── gates.yml              lint, format, test, browser sweep, image build
├── .dockerignore
├── .gitignore                 ignores .env, dist/, build/, storage/, backups/
│
├── campusOs_backend/          Express REST API, ~30k lines in src/
│   ├── src/
│   │   ├── app.js             Express assembly, middleware order
│   │   ├── server.js          boot: env → DB → listen → graceful shutdown
│   │   ├── config/            env, db, constants, logger, razorpay, storage
│   │   ├── middleware/        auth, csrf, rate limit, upload, validate, errors
│   │   ├── models/            Mongoose schemas (19 models + registry)
│   │   ├── routes/            URL + middleware, mounted under /api/v1
│   │   ├── controllers/       HTTP request/response shaping
│   │   ├── services/          all business rules and authorization
│   │   ├── validators/        Zod schemas for every write
│   │   ├── utils/             money, CSV, SLA, permissions, tokens, workflows
│   │   └── jobs/              SLA escalation sweep
│   ├── scripts/               seed, admin, drill, backup, index migration
│   ├── tests/                 Vitest against in-memory MongoDB
│   └── storage/               gitignored runtime uploads (7k+ local files)
│
└── campusOs_frontend/         React SPA, ~22k lines in src/
    ├── src/
    │   ├── main.jsx           providers: theme, query, router, auth
    │   ├── App.jsx            every route and its permission gate
    │   ├── api/client.js      the only HTTP client (axios + CSRF)
    │   ├── context/           AuthContext, ThemeContext
    │   ├── lib/               formatting, navigation definition
    │   ├── components/        shared UI, layout shell, ui primitives
    │   ├── pages/             one file per screen (37)
    │   ├── test/              Testing Library suites
    │   └── hooks/             (empty — no custom hooks extracted yet)
    ├── scripts/               real-browser verification (login, all roles)
    ├── build/csp.js           CSP plugin for the production build
    ├── nginx.conf             static bundle + same-origin /api proxy
    └── dist/                  gitignored build output (3.5 MB)
```

**Two rules the code keeps.** Money is integer paise everywhere, never a float.
The server decides permission on every request; the UI only hides things.

---

## 2. Repository root

| Path                          | What it is                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                | Workspace root. Scripts fan out with `--workspace`: `dev:backend`, `dev:frontend`, `test`, `test:frontend`, `lint`, `format`, `build`, `seed:demo`, `create-admin`, `run:escalations`. Requires Node ≥ 20.19. |
| `docker-compose.yml`          | Three services: `db` (mongo:7, not published to host), `api` (port 5050 internal), `web` (nginx on `${WEB_PORT:-8080}`). Named volumes `mongo-data`, `app-storage`. Secrets are required via `${VAR:?}`.      |
| `.github/workflows/gates.yml` | Four jobs: **backend** (lint, format, test), **frontend** (lint, format, test, build), **browser** (seed → start API → start Vite → `verify:roles`), **images** (build both Dockerfiles, never push).         |
| `README.md`                   | The product view: what it does, how to run, demo accounts, commands, an explicit "what is not built".                                                                                                         |
| `FEATURES.md`                 | The exhaustive inventory — 16 sections, every item ticked or not, with a reason for every unticked one. Best source for _intent_.                                                                             |
| `DEPLOY.md`                   | Deployment, the environment contract, backup/restore, the first super-admin.                                                                                                                                  |
| `backups/`                    | Empty and gitignored. Output target for `npm run backup`.                                                                                                                                                     |

---

## 3. Backend (`campusOs_backend/`)

### 3.1 Layering

```
route  →  authenticate  →  csrfProtection  →  validate(zod)  →  controller  →  service  →  model
```

The layers are strict and the comments say why:

- **routes** own the URL, the permission gate and middleware order. Nothing else.
- **controllers** are thin: read `req.validated`, call one service, shape the
  response. No business rule and no authorization decision lives here.
- **services** own _all_ rules, including the second authorization check —
  "may this person see _this_ record", not just "may this role use this route".
  Query-level ownership/department/confidentiality filters live here.
- **models** own schema, indexes, invariants and derived fields.
- **validators** are Zod, `.strict()`, and deliberately do not accept
  server-owned fields (`status`, `total`, `confidential`, role, etc.).

### 3.2 Process entry

| File            | Lines | What it does                                                                                                                                                                                                                                                                                 |
| --------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server.js` | 122   | Validates env, registers connection listeners, connects, syncs indexes (dev/test only), starts listening, handles `EADDRINUSE`, drains on SIGTERM/SIGINT.                                                                                                                                    |
| `src/app.js`    | 184   | Builds the Express app. Middleware order is load-bearing and documented: helmet → CORS → pino-http → compression → **raw-body webhook (before JSON)** → `express.json` → cookies → content-type guard → routes → 404 → error handler. Exports `createApp` so tests can run without a socket. |

### 3.3 `src/config/` — 6 files, ~1,840 lines

| File           | Purpose                                                                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env.js`       | Zod-validated environment, parsed once at require time. Requires `MONGO_URI` **with a database name**, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `CSRF_SECRET`; refuses equal secrets; in production requires `COOKIE_SECURE=true`, Razorpay/Cloudinary/SMTP settings, `WEB_URL`, and a database URI with a name. |
| `db.js`        | Mongoose connection with fail-fast timeouts, connection-event logging, `syncIndexes()` (refuses in production), graceful `disconnectDB()`.                                                                                                                                                                    |
| `constants.js` | Every closed set: `ROLES` (12 values), request/complaint statuses, certificate types, document visibility, notification categories, etc.                                                                                                                                                                      |
| `logger.js`    | pino, pretty in dev / JSON in prod, with a redaction list so secrets never reach the log stream.                                                                                                                                                                                                              |
| `razorpay.js`  | Payment gateway interface: real Razorpay client or a **mock** when keys are absent (mock refused in production).                                                                                                                                                                                              |
| `storage.js`   | Private file storage behind one interface: local disk (`storage/`) or Cloudinary. Images → Cloudinary `image` pipeline; documents → `raw` byte-for-byte.                                                                                                                                                      |

### 3.4 `src/middleware/` — 6 files, ~930 lines

| File              | Purpose                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.js`         | `authenticate` re-reads the user from MongoDB on every request (never trusts token claims), plus `requirePermission` and scope helpers. |
| `csrf.js`         | Trusted-Origin guard for browser writes, plus identity-bound HMAC double-submit fallback for non-browser callers.                       |
| `rateLimit.js`    | Login throttling per-IP _and_ per-email, plus limits on other abuse-prone endpoints.                                                    |
| `upload.js`       | multer memory storage, size and count limits — files are never streamed to disk.                                                        |
| `validate.js`     | Runs Zod schemas against params/query/body and writes to `req.validated` (Express 5 made `req.query` read-only).                        |
| `errorHandler.js` | The single place that turns an exception into an HTTP response; `notFoundHandler` alongside it. Redacts internals in production.        |

### 3.5 `src/models/` — 19 models + registry, ~3,870 lines

| Model                      | Represents                                                                                                          | Key relationships                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `User.js`                  | Login identity: email, password hash, role, status, 2FA, refresh-token families                                     | → `Department`, → `Student`                                  |
| `Student.js`               | Academic record: roll number, programme, semester, batch                                                            | → `User`, `Department`, `Program`                            |
| `Department.js`            | Organisational unit; HOD appointment                                                                                | → `User` (HOD)                                               |
| `Program.js`               | Degree programme                                                                                                    | → `Department`                                               |
| `RequestType.js`           | Catalogue of services: field definitions, workflow, SLA, fee                                                        | → `Department`                                               |
| `Request.js`               | A student's application for a service, with status, assignee, SLA                                                   | → `Student`, `User`, `Department`, `RequestType`, `Document` |
| `Complaint.js`             | Grievance, optionally confidential or anonymous                                                                     | → `Student`, `User`, `Department`                            |
| `Certificate.js`           | Application + issued certificate, verification code, file                                                           | → `Student`, `User`, `Department`                            |
| `CertificateTemplate.js`   | Reusable certificate layout for bulk issue                                                                          | → `User`                                                     |
| `Invoice.js`               | Amount owed; items, subtotal, tax, total, instalments                                                               | → `Student`, `User`, `Request`                               |
| `Payment.js`               | One settlement attempt; gateway order/payment ids                                                                   | → `Invoice`, `Student`                                       |
| `Refund.js`                | Requested → approved → processed return of money                                                                    | → `Payment`, `Invoice`, `Student`, `User`                    |
| `InstitutionTaxProfile.js` | GSTIN, legal name, state (CGST/SGST vs IGST)                                                                        | → `User`                                                     |
| `Announcement.js`          | Notice to a computed audience, optional image                                                                       | → `User`, `Department`, `Program`                            |
| `Notification.js`          | In-app message for exactly one user                                                                                 | → `User`                                                     |
| `Document.js`              | File metadata + private storage key                                                                                 | → `Request`, `Certificate`, `Student`, `User`                |
| `AuditLog.js`              | Append-only record of privileged actions, redacted metadata                                                         | → `User`                                                     |
| `Counter.js`               | Concurrency-safe sequence for references (`REQ-2026-000123`)                                                        | —                                                            |
| `AcademicTerm.js`          | Named term with date range and "current" flag                                                                       | → `User`                                                     |
| `index.js`                 | **Model registry** — requires every model so `populate()` never hits `MissingSchemaError`; exports `initIndexes()`. |

### 3.6 `src/routes/` — 15 feature routers + table, ~2,100 lines

All mounted in `routes/index.js`:

- Health is **outside** `/api/v1`: `GET /health`, `/health/live`, `/health/ready`.
- Everything else sits under `/api/v1`.

| Router                     | Endpoints | Notes                                                                                                      |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| `auth.routes.js`           | 15        | login, refresh, logout, logout-all, 2FA enrol/verify/disable, email verify, forgot/reset password          |
| `request.routes.js`        | 10        | create/list/detail, transition, assign, notes, documents                                                   |
| `complaint.routes.js`      | 10        | create (incl. anonymous), list/detail, triage, transition, SLA policy                                      |
| `certificate.routes.js`    | 14        | apply, list/detail, approve, issue, revoke, download, verify, templates, bulk issue                        |
| `finance.routes.js`        | 23        | invoices, payments, orders, verify, refunds, receipts, instalments, penalties, tax profile, reconciliation |
| `paymentWebhook.routes.js` | 1         | Razorpay webhook — mounted in `app.js` **above** the JSON parser for raw-body signature verification       |
| `notification.routes.js`   | 4         | list, unread count, mark read, preferences                                                                 |
| `announcement.routes.js`   | 8         | list/detail, create, publish, image upload                                                                 |
| `report.routes.js`         | 6         | scoped reports + CSV/PDF export                                                                            |
| `audit.routes.js`          | 3         | read-only trail, no write verbs by construction                                                            |
| `academicTerm.routes.js`   | 8         | terms, current term, activate                                                                              |
| `directory.routes.js`      | 1         | staff lookup for the assignment dropdown                                                                   |
| `document.routes.js`       | 6         | upload, metadata, authorised download, delete                                                              |
| `profile.routes.js`        | 8         | own profile, avatar, notification preferences                                                              |
| `admin.routes.js`          | 22        | people, roles, departments, programmes, services, student import                                           |

### 3.7 `src/controllers/` — 15 files, ~2,970 lines

One per domain: `auth`, `profile`, `request`, `complaint`, `certificate`,
`finance`, `announcement`, `notification`, `report`, `audit`, `directory`,
`document`, `admin`, `academicTerm`, `health`. Certificate templates, tax
profile and instalments have **no separate controller** — they live in
`certificate.controller.js` and `finance.controller.js`.

### 3.8 `src/services/` — 32 files, ~13,030 lines (the bulk of the system)

**Accounts & people**
`auth.service.js` (login, rotating refresh tokens, reuse detection, family
revocation), `emailAuth.service.js` (verification + password reset tokens),
`twoFactor.service.js`, `totp.service.js`, `profile.service.js`,
`avatar.service.js`, `admin.service.js` (people, roles, departments,
programmes), `studentImport.service.js` (validate → commit, two calls),
`directory.service.js`.

**Requests & complaints**
`request.service.js`, `workflow.service.js` (the only writer of
`Request.status`), `complaint.service.js` (confidentiality filter),
`academicTerm.service.js`.

**Certificates & documents**
`certificate.service.js` (apply → approve → issue → PDF → verify → revoke),
`certificateTemplate.service.js` (templates + approval-bound bulk issue),
`pdf.service.js` (server-side render with pdfkit), `document.service.js`
(magic-byte allowlist, generated keys, authorised delivery).

**Money**
`finance.service.js` (invoice totals, orders, settlement, reconciliation),
`instalment.service.js` (schedules + penalties on original debt),
`refund.service.js` (request → approve → execute), `receipt.service.js`
(issued once at settlement), `tax.service.js` (CGST/SGST vs IGST),
`taxProfile.service.js`.

**Communication & reporting**
`announcement.service.js` (audience rule), `announcementImage.service.js`,
`notification.service.js`, `notificationPreference.service.js`,
`mailer.service.js` (dev transport writes `dev-mailbox.jsonl`; SMTP via
lazily-required nodemailer when `SMTP_HOST` is set),
`report.service.js` (scope-resolved, absence ≠ everything),
`reportExport.service.js` (CSV/PDF from the same report the screen uses),
`audit.service.js` (writer), `audit-query.service.js` (reader).

### 3.9 `src/utils/` — 12 files, ~2,790 lines

| File                   | Purpose                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissions.js`       | **The RBAC authority.** `ROLES`, permission strings `domain:action:scope`, scope constants, per-role grants, derivation. Every route re-checks it. |
| `workflow.js`          | Request workflow as data: permitted transitions per status/role/actor.                                                                             |
| `complaintWorkflow.js` | Separate complaint lifecycle (acknowledge → investigate → resolve).                                                                                |
| `sla.js`               | SLA arithmetic over a **business calendar**, not `+48h`.                                                                                           |
| `slaPolicy.js`         | Default SLA durations per priority/category.                                                                                                       |
| `money.js`             | Integer-paise arithmetic, explicit rounding, formatting.                                                                                           |
| `tokens.js`            | JWT issue/verify + stateless CSRF token signing.                                                                                                   |
| `cookies.js`           | Cookie attributes in one place so login/refresh/logout cannot drift.                                                                               |
| `csv.js`               | Hand-written state-machine CSV reader (no dependency).                                                                                             |
| `ApiError.js`          | Typed application error + `ERROR_CODE` registry.                                                                                                   |
| `asyncHandler.js`      | Explicit async wrapper (Express 5 forward is automatic; kept for clarity).                                                                         |
| `response.js`          | The `{ success, message, data, meta }` envelope helpers.                                                                                           |

### 3.10 `src/jobs/` — 1 file

`escalation.job.js` — idempotent SLA sweep: finds breached requests, escalates
once, notifies once. Run by `scripts/run-escalation.js` (a cron-shaped script,
not an in-process scheduler).

### 3.11 `scripts/` — 12 files, ~2,870 lines

| Script                                         | Purpose                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-admin.js`                              | The only way to create the first super admin (no HTTP register exists).                                                                                    |
| `seed-demo.js`                                 | Nine demo accounts + departments, programmes, services, requests, complaints, certificates, invoices. Refuses a non-empty non-demo DB; `--force` required. |
| `migrate-indexes.js`                           | Syncs indexes against a real cluster (what `server.js` does in dev/test).                                                                                  |
| `run-escalation.js`                            | One escalation sweep, for cron.                                                                                                                            |
| `backup.js` / `restore-backup.js`              | Timestamped archive; restore asks first.                                                                                                                   |
| `check-razorpay.js` / `check-razorpay-live.js` | Connectivity check; live order + payment + refund.                                                                                                         |
| `live-payment-drill.js`                        | Invoice → partial payment → refund.                                                                                                                        |
| `refund-drill.js`                              | Refund state machine end to end.                                                                                                                           |
| `comms-drill.js`                               | Notification fan-out.                                                                                                                                      |
| `reports-drill.js`                             | Every report scope.                                                                                                                                        |

### 3.12 `tests/` — 37 files, ~14,900 lines

`setup.js` boots **mongodb-memory-server as a replica set**, `helpers/factory.js`
builds fixtures. Suites are per domain: `auth`, `email-auth`, `two-factor`,
`csrf`, `rbac`, `admin`, `student-import`, `hod-assignment`, `request`,
`workflow`, `documents`, `complaint`, `complaint-anonymous`, `certificate`,
`certificate-template`, `finance`, `gst`, `instalment`, `invoice-instalments`,
`razorpay-gateway`, `reports`, `report-export`, `notifications`,
`notification-preferences`, `announcement-email`, `announcement-image`,
`profile`, `avatar`, `directory`, `academic-term`, `escalation`, `csv`,
`env`, `seed-references`, `storage.cloudinary`.

### 3.13 Build & tooling

`Dockerfile` (multi-stage, `npm ci --omit=dev`, tini init), `vitest.config.js`,
`eslint.config.js`, `.prettierrc`, `.prettierignore`, `.env.example`
(the environment contract), `.env` (local, gitignored — `PORT=5005`).

---

## 4. Frontend (`campusOs_frontend/`)

### 4.1 Entry and providers

`main.jsx` composes, in order: `ThemeProvider` → `QueryClientProvider` →
`BrowserRouter` → `AuthProvider` → `App`. React Query defaults are deliberate:
30s stale time, no refetch on window focus, no retry on 4xx.

`App.jsx` is the single route table. It is the best one-screen summary of the
product.

### 4.2 Route map

**Public — no session, outside the app shell**

| URL                | Page                                                     |
| ------------------ | -------------------------------------------------------- |
| `/verify`          | `VerifyCertificate` — verify a paper certificate by code |
| `/grievance`       | `Grievance` — file a complaint anonymously               |
| `/login`           | `Login`                                                  |
| `/forgot-password` | `ForgotPassword`                                         |
| `/reset-password`  | `ResetPassword`                                          |
| `/verify-email`    | `VerifyEmail`                                            |

**Signed in but outside the shell** — `/set-password` (`RequireAuth`
`allowUnchangedPassword`), so a forced password change shows no navigation.

**Inside the shell** (`RequireAuth` → `AppShell`)

| URL                                                               | Page                                                    | Permission gate                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| `/`                                                               | `Dashboard`                                             | —                                                           |
| `/profile`                                                        | `Profile`                                               | —                                                           |
| `/requests`, `/requests/new`, `/requests/:reference`              | `Requests`, `NewRequest`, `RequestDetail`               | `request:read:own` / `request:create:own`                   |
| `/complaints`, `/complaints/new`, `/complaints/:reference`        | `Complaints`, `NewComplaint`, `ComplaintDetail`         | `complaint:create:own`                                      |
| `/certificates`, `/certificates/new`, `/certificates/:reference`  | `Certificates`, `ApplyCertificate`, `CertificateDetail` | `certificate:apply:own`                                     |
| `/finance/invoices`, `/finance/invoices/:reference`               | `Invoices`, `InvoiceDetail`                             | `invoice:read:own` **or** `invoice:read:institution`        |
| `/finance/refunds`                                                | `Refunds`                                               | `refund:request:own`                                        |
| `/announcements`, `/announcements/:reference`                     | `Announcements`, `AnnouncementDetail`                   | `announcement:read:institution`                             |
| `/management/requests`, `/management/requests/:reference`         | `Requests(mode=assigned)`, `RequestDetail`              | `request:read:assigned`                                     |
| `/management/complaints`, `/management/complaints/:reference`     | `Complaints(mode=assigned)`, `ComplaintDetail`          | `complaint:read:assigned`                                   |
| `/management/certificates`, `/management/certificates/:reference` | `Certificates(mode=assigned)`, `CertificateDetail`      | any of `certificate:read:{assigned,department,institution}` |
| `/management/announcements`                                       | `ComposeAnnouncement`                                   | `announcement:manage:institution`                           |
| `/management/tax`                                                 | `GstProfile`                                            | `invoice:manage:institution`                                |
| `/management/certificate-templates`                               | `CertificateTemplates`                                  | `certificate:issue:institution`                             |
| `/management/terms`                                               | `Terms`                                                 | `academic-term:manage:institution`                          |
| `/admin/people`                                                   | `People`                                                | `user:read:institution`                                     |
| `/admin/services`                                                 | `RequestTypes`                                          | `request-type:manage:institution`                           |
| `/admin/students`                                                 | `StudentImport`                                         | `user:manage:institution`                                   |
| `/admin/departments`                                              | `Departments`                                           | `department:manage:institution`                             |
| `/admin/programmes`                                               | `Programmes`                                            | `program:manage:institution`                                |
| `/reports`                                                        | `Reports`                                               | `report:read:institution` **or** `report:read:department`   |
| `/audit`                                                          | `AuditTrail`                                            | `audit:read:institution` **or** `audit:read:department`     |
| `*`                                                               | `NotFound`                                              | —                                                           |

Outside the shell, `*` redirects to `/`.

### 4.3 `src/api/client.js` — 302 lines

The shared HTTP client: an axios instance with `withCredentials: true`, CSRF
header injection when the page can read the cookie, a single refresh-and-retry
path on 401, error normalisation, and helpers `apiGet/apiPost/apiPut/apiPatch/
apiDelete/apiUpload/fetchDocument/downloadReport/apiAssetUrl/readCsrfToken`.
The session cookie is HttpOnly; no token is ever stored in `localStorage`.

`components/DocumentPanel.jsx` downloads with a raw `fetch` because it needs a
blob/object URL; it uses `apiAssetUrl()` and `credentials: "include"` so the
request follows `VITE_API_URL` instead of hard-coding the frontend origin.
rather than the `fetchDocument` helper, so it only works when the API is
same-origin.

### 4.4 `src/context/` — 2 files

- `AuthContext.jsx` — bootstrap "who am I", `user`, `permissions`, `can`,
  `canAny`, login/logout, and the failure states the shell renders.
- `ThemeContext.jsx` — light / dark / system, persisted in `localStorage`; the
  `index.html` inline script applies it before first paint so there is no flash.

### 4.5 `src/lib/` — 2 files

- `format.js` — money (from integer paise), dates, initials, labels. Formats,
  never parses.
- `nav.js` — `NAV_ITEMS` with the **server's** permission strings, section
  headings, `visibleNavItems(canAny)`, and `DEMO_ACCOUNTS` for the sign-in page.

### 4.6 `src/components/` — 24 files, ~3,870 lines

**Shared feature components**

| File                          | What it does                                          | Used by                              |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------ |
| `AvatarPicker.jsx`            | Upload/replace/remove profile picture                 | Profile                              |
| `BulkIssueBar.jsx`            | Select + bulk-issue certificates                      | Certificates                         |
| `DocumentPanel.jsx`           | Attach, list, download, delete documents              | Request/Complaint/Certificate detail |
| `DynamicField.jsx`            | Render a form from a request type's field definitions | NewRequest                           |
| `EmailVerification.jsx`       | Resend/confirm email banner                           | Profile, VerifyEmail                 |
| `InstalmentPanel.jsx`         | Instalment schedule, penalties, pay                   | InvoiceDetail                        |
| `NotificationPreferences.jsx` | Mute categories without losing them                   | Profile                              |
| `PayDialog.jsx`               | Razorpay checkout + verification                      | Invoices, InstalmentPanel            |
| `ReportExport.jsx`            | CSV/PDF export buttons                                | Reports                              |
| `RequireAuth.jsx`             | Session gate (incl. forced password change)           | App                                  |
| `RequirePermission.jsx`       | Any-of permission gate with a named refusal           | App                                  |
| `TransitionPanel.jsx`         | Workflow actions available to this actor              | Request/Complaint detail             |
| `TwoFactorSettings.jsx`       | Enrol, confirm, disable 2FA                           | Profile                              |

**`components/layout/`**

- `AppShell.jsx` — sidebar (built from `NAV_ITEMS`), header, mobile drawer,
  notifications, theme toggle, demo-data banner.
- `NotificationBell.jsx` — unread count + recent list.
- `ThemeToggle.jsx` — light/dark switch.

**`components/ui/`** — primitives: `Badge`, `Button` (`type="button"` by
default, so it never submits a form by accident), `Card`, `Field` (label always
rendered), `Modal`, `Pagination`, `Skeleton`, `States` (empty/error/loading).

### 4.7 `src/pages/` — 37 files, ~11,350 lines

| Group          | Pages                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth & account | `Login`, `ForgotPassword`, `ResetPassword`, `SetPassword`, `VerifyEmail`, `Profile`, `NotFound`                                                                          |
| Landing        | `Dashboard` (role-aware)                                                                                                                                                 |
| Requests       | `Requests`, `NewRequest`, `RequestDetail`                                                                                                                                |
| Complaints     | `Complaints`, `NewComplaint`, `ComplaintDetail`, `Grievance` (public)                                                                                                    |
| Certificates   | `Certificates`, `ApplyCertificate`, `CertificateDetail`, `VerifyCertificate` (public)                                                                                    |
| Finance        | `Invoices`, `InvoiceDetail`, `Refunds`                                                                                                                                   |
| Announcements  | `Announcements`, `AnnouncementDetail`, `ComposeAnnouncement`                                                                                                             |
| Oversight      | `Reports`, `AuditTrail`                                                                                                                                                  |
| `pages/admin/` | `AdminLayout` (shared page frame), `People`, `RequestTypes`, `StudentImport`, `Departments`, `Programmes`, `Terms`, `CertificateTemplates`, `GstProfile`, `constants.js` |

### 4.8 `src/test/` — 20 files, ~4,880 lines

Testing Library + jsdom. `setup.js` registers jest-dom; `helpers.js` renders
with providers. Suites cover `app`, `admin`, `apply-certificate`,
`announcement-detail`, `avatar-picker`, `client`, `email-auth`, `grievance`,
`notification-preferences`, `profile`, `set-password`, `skeleton`,
`student-import`, `terms`, `theme`, `two-factor`, `verify-certificate`,
`verify-script`.

### 4.9 Build, browser checks, serving

| Path                          | Purpose                                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite.config.js`              | Reads `PORT` from the backend `.env` to configure the dev proxy (`/api`, `/health`), so the two halves cannot drift. Dev CSP header, jsdom test config, `dist` output with sourcemaps. |
| `build/csp.js`                | Vite plugin that injects the strict production CSP into `index.html`; exports `DEV_CSP` (allows Vite's inline preamble).                                                               |
| `nginx.conf`                  | Serves the bundle, proxies `/api` to `api:5050`, sets CSP and the other security headers, gzip, `client_max_body_size 12m`.                                                            |
| `scripts/verify-login.mjs`    | Real browser: sign in as each role, confirm the landing page.                                                                                                                          |
| `scripts/verify-roles.mjs`    | Every page × every role, the two public pages with no session, 375px/320px overflow checks.                                                                                            |
| `Dockerfile`                  | Build the bundle, serve from nginx.                                                                                                                                                    |
| `index.html`, `src/index.css` | Shell document and Tailwind entry.                                                                                                                                                     |

---

## 5. Domain → file index

Use this when you know _what_ you are changing but not _where_.

| Domain                            | Backend                                                                                                                                                                                                                                                     | Frontend                                                                                                                                                   | Tests                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Auth / session**                | `models/User`, `services/auth`, `services/emailAuth`, `services/twoFactor`, `services/totp`, `controllers/auth`, `routes/auth`, `validators/auth`, `utils/tokens`, `utils/cookies`, `middleware/csrf`                                                       | `pages/Login`, `ForgotPassword`, `ResetPassword`, `SetPassword`, `VerifyEmail`, `components/EmailVerification`, `TwoFactorSettings`, `context/AuthContext` | `auth`, `email-auth`, `two-factor`, `csrf`; FE `email-auth`, `set-password`, `two-factor`                          |
| **Profile**                       | `models/Student`, `services/profile`, `services/avatar`, `controllers/profile`, `routes/profile`, `validators/profile`                                                                                                                                      | `pages/Profile`, `components/AvatarPicker`, `NotificationPreferences`                                                                                      | `profile`, `avatar`; FE `profile`, `avatar-picker`                                                                 |
| **People / structure**            | `models/User/Department/Program`, `services/admin`, `services/studentImport`, `controllers/admin`, `routes/admin`, `validators/admin`                                                                                                                       | `pages/admin/People`, `Departments`, `Programmes`, `StudentImport`                                                                                         | `admin`, `student-import`, `hod-assignment`, `rbac`; FE `admin`, `student-import`                                  |
| **Academic terms**                | `models/AcademicTerm`, `services/academicTerm`, `controllers/academicTerm`, `routes/academicTerm`, `validators/academicTerm`                                                                                                                                | `pages/admin/Terms`                                                                                                                                        | `academic-term`; FE `terms`                                                                                        |
| **Requests**                      | `models/Request/RequestType/Document`, `services/request`, `services/workflow`, `utils/workflow`, `controllers/request`, `routes/request`, `validators/request`                                                                                             | `pages/Requests`, `NewRequest`, `RequestDetail`, `pages/admin/RequestTypes`, `components/DynamicField`, `TransitionPanel`, `DocumentPanel`                 | `request`, `workflow`, `documents`; FE `app`                                                                       |
| **Complaints**                    | `models/Complaint`, `services/complaint`, `utils/complaintWorkflow`, `utils/sla`, `utils/slaPolicy`, `controllers/complaint`, `routes/complaint`, `validators/complaint`                                                                                    | `pages/Complaints`, `NewComplaint`, `ComplaintDetail`, `Grievance`                                                                                         | `complaint`, `complaint-anonymous`; FE `grievance`                                                                 |
| **Certificates**                  | `models/Certificate/CertificateTemplate`, `services/certificate`, `services/certificateTemplate`, `services/pdf`, `controllers/certificate`, `routes/certificate`, `validators/certificate`, `validators/certificateTemplate`                               | `pages/Certificates`, `ApplyCertificate`, `CertificateDetail`, `VerifyCertificate`, `pages/admin/CertificateTemplates`, `components/BulkIssueBar`          | `certificate`, `certificate-template`; FE `apply-certificate`, `verify-certificate`                                |
| **Finance**                       | `models/Invoice/Payment/Refund/InstitutionTaxProfile`, `services/finance`, `instalment`, `refund`, `receipt`, `tax`, `taxProfile`, `config/razorpay`, `controllers/finance`, `routes/finance`, `routes/paymentWebhook`, `validators/finance/instalment/tax` | `pages/Invoices`, `InvoiceDetail`, `Refunds`, `pages/admin/GstProfile`, `components/PayDialog`, `InstalmentPanel`                                          | `finance`, `gst`, `instalment`, `invoice-instalments`, `razorpay-gateway`                                          |
| **Announcements / notifications** | `models/Announcement/Notification`, `services/announcement`, `announcementImage`, `notification`, `notificationPreference`, `mailer`, `controllers/announcement/notification`, `routes/announcement/notification`, `validators/announcement/notification`   | `pages/Announcements`, `AnnouncementDetail`, `ComposeAnnouncement`, `components/layout/NotificationBell`                                                   | `announcements-email`, `announcement-image`, `notifications`, `notification-preferences`; FE `announcement-detail` |
| **Reports / audit**               | `models/AuditLog`, `services/report`, `reportExport`, `audit`, `audit-query`, `controllers/report/audit`, `routes/report/audit`, `validators/report`                                                                                                        | `pages/Reports`, `AuditTrail`, `components/ReportExport`                                                                                                   | `reports`, `report-export`                                                                                         |
| **Files**                         | `models/Document`, `services/document/avatar`, `config/storage`, `middleware/upload`, `controllers/document`, `routes/document`, `validators/document`                                                                                                      | `components/DocumentPanel`, `AvatarPicker`                                                                                                                 | `documents`, `avatar`, `storage.cloudinary`                                                                        |
| **SLA / escalation**              | `jobs/escalation.job`, `utils/sla`, `utils/slaPolicy`, `scripts/run-escalation`                                                                                                                                                                             | (surfaced inside request/complaint detail)                                                                                                                 | `escalation`                                                                                                       |

---

## 6. Request lifecycle

```
Browser
  │  React component → TanStack Query → api/client.js (axios)
  │  withCredentials: true, X-CSRF-Token on unsafe verbs
  ▼
Vite dev proxy /api  ──or──  nginx /api proxy
  ▼
Express app.js
  helmet → cors → pino-http (X-Request-Id) → compression
  ├─ /api/v1 payments webhook  (express.raw, before JSON)
  ├─ express.json (1mb) → cookies → content-type guard
  ▼
routes/index.js  →  /api/v1/<feature>
  ▼
authenticate  (load user from Mongo, derive permissions from stored role)
  ▼
csrfProtection  (identity-bound HMAC)
  ▼
validate({ body, params, query })  →  req.validated
  ▼
controller  (shape in / shape out only)
  ▼
service  (rules + the second authorization check: may they see THIS record?)
  ▼
Mongoose model  →  MongoDB Atlas
  ▼
{ success, message, data, meta }  →  JSON  →  React Query cache  →  screen
```

**Authorization happens twice.** Route middleware answers "may this _role_ use
this endpoint". The service answers "may _this person_ see _this_ record" by
adding an ownership/department/confidentiality filter to the query itself. The
second is the one that prevents IDOR.

---

## 7. Data model map

```
Department ──< Program ──< Student >── User
     │                        │           │
     │                        ├──< Request >── RequestType ──> Department
     │                        │       │
     │                        │       └──< Document
     │                        ├──< Complaint
     │                        ├──< Certificate >── CertificateTemplate
     │                        │       └──< Document
     │                        └──< Invoice >──< Payment >──< Refund
     │                                │            │
     │                                └──< Document └──> Invoice
     │
     └──< Announcement >── Program (optional, audience scope)

User ──< Notification
User ──< AuditLog
User ──< AcademicTerm (createdBy)
InstitutionTaxProfile (singleton record)
Counter (sequences for human-readable references)
```

`<` means "has many". `Document` is polymorphic: it can hang off a `Request`, a
`Certificate`, a `Student` or a `User` (avatar).

---

## 8. Runtime and deployment topology

```
                 ┌──────────────────────────────┐
  browser ──────►│ web (nginx :8080)            │
                 │  /        → dist/ bundle     │
                 │  /api/    → proxy to api     │
                 └──────────────┬───────────────┘
                                │
                 ┌──────────────▼───────────────┐
                 │ api (Express :5050)          │
                 │  storage volume: certificates│
                 │  uploads, receipts, avatars  │
                 └──────────────┬───────────────┘
                                │
                 ┌──────────────▼───────────────┐
                 │ db (mongo:7, internal only)  │
                 └──────────────────────────────┘
```

- Development is **two processes**: API on the port in
  `campusOs_backend/.env` (currently `5005`), Vite on `5173` proxying `/api`.
- Production is **three containers**, with the web origin and API origin the
  same by construction, which keeps cookies `SameSite` and avoids CORS.
- `/health` (liveness+readiness), `/health/live`, `/health/ready` are
  unversioned so platform probes never move.
- Volumes: `mongo-data`, `app-storage`. Backups are archives of both, written by
  `scripts/backup.js`.

---

## 9. Where to make a change

| I want to…                               | Touch                                                                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a field to a request                 | `models/Request.js` → `validators/request.validator.js` → `services/request.service.js` → `pages/NewRequest.jsx` / `RequestDetail.jsx`                      |
| Add a new service type (e.g. "Bonafide") | Data, not code: `pages/admin/RequestTypes.jsx` (or `scripts/seed-demo.js` for demo data)                                                                    |
| Add a workflow transition                | `utils/workflow.js` (data) → `services/workflow.service.js` (gates) → `tests/workflow.test.js` (denial case)                                                |
| Add a new role or permission             | `config/constants.js` (`ROLES`) → `utils/permissions.js` (minimum grant) → `tests/rbac.test.js` (prove the denial) → `lib/nav.js` if it needs a link        |
| Add a page                               | `pages/Foo.jsx` → `App.jsx` route + `RequirePermission` → `lib/nav.js` if it belongs in the sidebar                                                         |
| Add an endpoint                          | `routes/foo.routes.js` → `controllers/foo.controller.js` → `services/foo.service.js` → `validators/foo.validator.js` → `routes/index.js`                    |
| Change money maths                       | `utils/money.js` and the owning service; never a float; update `tests/finance.test.js`                                                                      |
| Change uploads                           | `middleware/upload.js` (limits), `services/document.service.js` (magic bytes), `config/storage.js` (disk/Cloudinary), `nginx.conf` (`client_max_body_size`) |
| Change the deploy contract               | `campusOs_backend/.env.example` + `config/env.js` (validation) + `DEPLOY.md` + `docker-compose.yml`                                                         |
| Add a test                               | Backend: `tests/<domain>.test.js` using `helpers/factory.js`. Frontend: `src/test/<page>.test.jsx` using `helpers.js`.                                      |

---

## 10. Conventions the code enforces

1. **Money is integer paise.** No float on any financial path. Rounding is
   explicit and visible in the return value.
2. **The server decides.** UI hiding is convenience; every route re-derives
   permissions from the stored role on every request.
3. **Scope lives in the permission string** (`domain:action:scope`), so a
   capability cannot be widened to "everywhere" by accident.
4. **Validators are strict and never accept server-owned fields** — `status`,
   `total`, `confidential`, `verificationCode`, role.
5. **A stored URL is not authorization.** Files are delivered after a service
   check, not by handing out a public link.
6. **Delivery is a side effect, never a precondition.** A failed notification or
   email never rolls back the state change that caused it.
7. **References are human-readable and concurrency-safe** (`REQ-2026-000123`)
   via `Counter`, not `count() + 1`.
8. **Comments explain _why_, and they are the project's documentation.** Most
   modules open with the constraint that shaped them; read the header before
   editing the body.
9. **Every security claim has a test that proves the denial**, not just the
   grant.

---

## 11. Observations and rough edges

Deployment prep fixed the earlier CSP-ignore, secret-name, port, finance-link,
raw-fetch-origin, and compose-path issues. What remains:

1. **`campusOs_frontend/build/csp.js` is still untracked.** It is no longer
   ignored, but it must be added before a clean clone or the CI/Vercel build can
   succeed. `vite.config.js` imports it as `./build/csp.js`.
2. **The working tree is necessarily uncommitted.** Scheduling, deployment,
   formatting, and dependency updates all need a review commit before pushing.
3. **Docker images are not built locally.** Docker is unavailable here; the CI
   `images` job builds both Dockerfiles, and the Render path uses the backend
   image. Dependency installs for both Docker layouts were simulated
   successfully.
4. **Generated artifacts are present but ignored:**
   `campusOs_frontend/dist/`, `campusOs_backend/storage/`, and `backups/`.
5. **`src/hooks/` is empty** — no custom hooks have been extracted; state lives
   in contexts and page components.
6. **Two unreachable route declarations:** `/requests/:reference` is declared
   twice in `App.jsx` (the second is shadowed by the first), and
   `pages/admin/AdminLayout.jsx` is imported by five admin pages but not by the
   route table — it is a layout component, not a page.
7. **`config/db.js`'s header still says "no multi-document transactions anywhere
   in slices 0-3".** Later code does use one real transaction
   (`services/academicTerm.service.js`), which is why the test harness runs an
   in-memory **replica set** rather than a standalone.
8. **Browser sweep has not run in this session.** It needs a server, Vite, and
   Chromium; CI provides all three after the demo seed.
9. **Safari third-party cookie caveat:** the default `*.vercel.app` +
   `*.onrender.com` split makes session cookies cross-site. Use `app.` and
   `api.` subdomains of one registrable domain for a production deployment.
