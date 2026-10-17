# CampusOS

College requests, complaints, certificates and fees in one place.

A student raises a request once. It gets an owner, a workflow, a status and an
audit trail. Everyone who needs to act on it can see the same thing.

---

## Contents

- [What it does](#what-it-does)
- [Running it](#running-it)
- [Signing in](#signing-in)
- [Commands](#commands)
- [What is built](#what-is-built)
- [What is not built](#what-is-not-built)
- [How it is put together](#how-it-is-put-together)
- [Testing](#testing)
- [Deploying](#deploying)
- [Where the detail lives](#where-the-detail-lives)

---

## What it does

| Area | What a user can actually do |
| --- | --- |
| **Requests** | Raise one against a published service. Assigned staff accept it, add progress notes, resolve, reject or forward it. SLA breaches escalate, and the dean sees them. |
| **Complaints** | Raise one with attachments. Confidential complaints are invisible to staff until assigned. Anyone can file anonymously at `/grievance` with no account, no name and no IP stored, and track it by a code that is stored only as a hash. |
| **Certificates** | Apply for any of nine types. Staff issue, verify and revoke. A PDF is generated, stored privately and served only after an authorisation check. Anyone can verify a paper certificate at `/verify` without an account. |
| **Finance** | Invoices in integer paise, totals computed server-side. Razorpay orders, webhook *and* direct verification, receipts, partial and full refunds, reconciliation. Instalments, late-payment penalties, and GST with the correct CGST/SGST-versus-IGST split. |
| **Announcements** | Compose and publish to a whole audience, with an image, and see who was notified. |
| **Reports** | Role-scoped figures that omit what you may not see rather than showing zero. Export to CSV or PDF. |
| **Directory** | Departments, programmes and services, with retirement blocked while anything still depends on them. Head of department appointed from the interface. |
| **Administration** | Create staff, change a role, deactivate, reset a password, deactivate, import students in bulk. |
| **Accounts** | Each person owns their profile. The academic record is institution-owned and cannot be self-edited. |

Every role is real and different. Nine of them, plus a super administrator.
Permissions are computed on the server and re-checked on every request.

---

## Running it

**You need:** Node 22+, a MongoDB Atlas connection string, and npm.

```bash
git clone <this repo> && cd CampusOS
npm install                      # installs both workspaces

cp campusOs_backend/.env.example campusOs_backend/.env
```

Edit `campusOs_backend/.env`. Four values are required:

| Variable | What it is |
| --- | --- |
| `MONGO_URI` | Your Atlas connection string. |
| `JWT_SECRET` | Any long random string. |
| `REFRESH_TOKEN_SECRET` | A different long random string. |
| `CSRF_SECRET` | A third one, different again. |

The rest have working defaults in development.

Two things it will refuse to start without:

- **`JWT_SECRET` and `REFRESH_TOKEN_SECRET` must be different.** Reusing one
  means a stolen refresh token is also a valid signing key.
- **In production**, `COOKIE_SECURE=true` and the Razorpay secrets become
  required, and `MONGO_URI` must point at Atlas. The app fails loudly at boot
  rather than starting half-configured.

**Frontend and backend, in two terminals:**

```bash
npm run dev:backend     # API on :5005
npm run dev:frontend    # interface on :5173
```

Open **http://localhost:5173**.

The frontend reads the backend's `.env` when it starts, to know which port to
proxy to. If you change `PORT`, restart the frontend too.

### Seed demo data

```bash
npm run seed:demo -- --force
```

Creates nine accounts covering every role, plus students, departments,
programmes, services, requests, complaints, certificates and invoices. Every
account uses the password `Demo@Campus123`, and the interface shows a
`DEMO DATA` banner while any of it exists.

`--force` is required, and it will not run against a database that has real
documents in it. That check is deliberate.

### Create a real administrator

```bash
npm run create-admin
```

---

## Signing in

**Demo accounts** — all use `Demo@Campus123`:

| Email | Sees |
| --- | --- |
| `demo.student.democs001@campusos.local` | Own requests, complaints, certificates, fees |
| `demo.faculty@campusos.local` | Department requests and approvals |
| `demo.hod@campusos.local` | Whole-department scope |
| `demo.exam@campusos.local` | Examinations |
| `demo.accounts@campusos.local` | Invoices, payments, refunds, tax registration |
| `demo.support@campusos.local` | Service desk |
| `demo.dean@campusos.local` | Escalations, institution-wide oversight |
| `demo.principal@campusos.local` | Institution-wide |
| `demo.admin@campusos.local` | Structure, roles, academic terms, certificate templates |

**Two public pages need no account:**

- `/verify` — check a certificate someone handed you
- `/grievance` — file something anonymously

---

## Commands

Run from the repository root unless it says otherwise.

### Everyday

| Command | Does |
| --- | --- |
| `npm run dev:backend` | API with file watching |
| `npm run dev:frontend` | Interface with hot reload |
| `npm test` | Backend tests |
| `npm run test:frontend` | Frontend tests |
| `npm run lint` | ESLint, both projects |
| `npm run format` | Prettier, both projects |
| `npm run build` | Production bundle |

### Checks that use a real browser

| Command | Does |
| --- | --- |
| `npm run verify:login -w campusos-frontend` | Signs in and confirms each role lands correctly |
| `npm run verify:roles -w campusos-frontend` | Every page, per role, plus the public pages with no session, plus a 375px and 320px overflow check |

### Operations

| Command | Does |
| --- | --- |
| `npm run backup -w campusos-backend` | Writes a timestamped archive |
| `npm run restore -w campusos-backend` | Restores one, and asks first |
| `npm run migrate:indexes -w campusos-backend` | Syncs indexes on the cluster |
| `npm run run:escalations -w campusos-backend` | Applies SLA escalation rules |

### Drills

These hit real integrations and print what happened. Start with the dry-run
version.

| Command | Does |
| --- | --- |
| `npm run razorpay:check -w campusos-backend` | Checks Razorpay connectivity, no charges |
| `npm run razorpay:live -w campusos-backend` | A real order and payment, then a refund |
| `npm run finance:drill -w campusos-backend` | Invoice, partial payment, refund |
| `npm run reports:drill -w campusos-backend` | Generates reports for every scope |
| `npm run comms:drill -w campusos-backend` | Notification fan-out |

---

## What is built

**Accounts and sessions.** Login, HttpOnly cookies with no token in
`localStorage`, HMAC-bound CSRF, rotating refresh tokens with reuse detection and
family revocation, sign-out-everywhere, login throttling and lockout.

**Privacy.** A confidential complaint is invisible to staff until assigned, and
that access is *deliberately not* granted to the super administrator. Anonymous
grievances store no name and no IP address. Audit entries are redacted of free
text, so reading the trail cannot leak a complaint's contents.

**Documents.** Magic-byte allowlist, generated storage keys, private delivery
after an authorisation check. Images route to Cloudinary's `image` pipeline;
documents are delivered byte for byte as `raw`, because recompressing a signed
certificate is indefensible.

**Money.** Integer paise throughout, never a float at any step. Instalments sum
to the total exactly. Penalties compound on the original debt, never on a
balance that already includes earlier penalties, and a sweep is idempotent.

**Correctness that is checked rather than assumed.** 775 backend tests and 170
frontend tests. Contrast ratios computed, not eyeballed. Spreadsheet exports
neutralise formula injection. CSV exports reuse the same service the screen
uses, so the two cannot disagree about who may see what.

---

## What is not built

Being explicit, because a system that claims to be finished when it is not is
worse than one that is not finished.

**Needs a provider or a host** — the code is not written:

- Email verification and password reset by email
- Email delivery of announcements
- Live Razorpay webhook delivery (needs a public URL and a signing secret)
- Uptime monitoring and error tracking
- Malware scanning of uploads

**Not started:**

- Avatar upload is built; **staff directory** is built; searching it by name,
  department or skill is not
- **Academic term** setup is built; **rollover automation** is not
- **Certificate templates** are built; **bulk issuance** is built; **per-college
  branding** is not
- **Penalty sweeps** are built; **scheduled runs** are not
- Attendance, timetable, exams, hostel, library, placements, events

`FEATURES.md` has every single item, ticked or not, with the reason for each
unticked one.

---

## How it is put together

```
campusOs_backend/     Express API
  src/routes/        URL and middleware
  src/controllers/   Request and response shape
  src/services/      All the rules
  src/models/        Mongoose schemas
  src/validators/    Zod, on every write

campusOs_frontend/    React and Vite
  src/pages/         One file per screen
  src/components/    Shared UI
  src/api/           The HTTP client
  scripts/           Real-browser checks
```

**Two rules the code actually follows:**

1. **Money is never a float.** Integer paise everywhere, rounding is explicit
   and documented, and the rounding decision is visible in the return value.

2. **The server decides.** The interface hides things for convenience; it never
   authorises. Every route re-checks permissions per request.

---

## Testing

```bash
npm test                    # 775 backend
npm run test:frontend       # 170 frontend
npm run lint                # both, clean
npm run build               # production bundle
```

Backend tests run against an **in-memory MongoDB replica set** — a replica set
rather than a standalone, because a standalone rejects transactions outright and
the atomicity in the term and payment paths would then be untested. No database
of yours is touched.

Browser checks need both servers running and are the only tests that need them.

```bash
npm run verify:roles -w campusos-frontend
```

That one signs in as every role, visits every page, checks the two public pages
with no session at all, and fails if any page scrolls sideways at 375px or 320px.

---

## Deploying

See **[DEPLOY.md](DEPLOY.md)** for the full walkthrough.

The short version: two Dockerfiles, a compose file, an nginx config that
proxies the API and sets the security headers, and an environment contract the
app refuses to start without.

```bash
docker compose up -d
```

`COOKIE_SECURE=true` and real Razorpay secrets are required in production, and
the app fails loudly at boot rather than starting half-configured.

**One thing to be honest about:** the images have never been built, because
Docker was not installed on the machine this was written on. See `FEATURES.md`.

---

## Where the detail lives

| File | For |
| --- | --- |
| **[FEATURES.md](FEATURES.md)** | Every feature, ticked or not, with reasons. The honest inventory. |
| **[DEPLOY.md](DEPLOY.md)** | Deployment, backups, restore, the environment contract. |
| `.env.example` | Every variable, with what it is for. |

---

## Licence

Private. All rights reserved.