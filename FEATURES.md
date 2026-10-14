# CampusOS — feature status

Every box below is a claim about the code, not an intention. A box is ticked only
when the feature works end to end and is covered by a test; anything awaiting a
human step or a missing screen is left empty and says why.

**Legend** — `[x]` working · `[ ]` not working · `[~]` partly working (the tick
means the note that follows it)

- **Last reviewed:** 13 October 2026
- **Verified:** 541 backend tests, 125 frontend tests, lint and build clean

---

## 1. Foundation

- [x] Node/Express API, layered as route → controller → service → model
- [x] MongoDB via Mongoose, with transactions where a write spans documents
- [x] Server-side validation on every write (Zod); unknown input refused
- [x] Uniform response envelope, and errors that carry a usable message
- [x] Helmet, CORS, rate limiting, compression, request logging
- [x] Content-Security-Policy, differing between development and production
- [x] Unhandled rejections and uncaught exceptions shut the server down cleanly
- [x] Tests run against an in-memory MongoDB, so the suite needs no live database

## 2. Accounts and sessions

- [x] Login with email and password
- [x] HttpOnly access and refresh cookies; no token in `localStorage`
- [x] Readable `cos_ct` CSRF token, HMAC-bound, checked on every write
- [x] Refresh-token rotation, with reuse detection and family revocation
- [x] Sign out (single session) — button present in the shell
- [x] Sign out everywhere — API and profile button; every refresh token revoked
- [x] Change password — API and form on the profile page; revokes other sessions
- [x] Roles: student, faculty, HOD, exam admin, finance, dean, principal, admin
- [x] Permissions computed on the server and re-checked per request
- [x] `GET /auth/me` is the single source of truth for the frontend
- [x] Login throttling, and lockout after repeated failures
- [ ] Email verification of new accounts
- [ ] Password reset by email
- [ ] Two-factor authentication

## 3. Profile (every role)

- [x] `GET /profile` — own record only; no route accepts a user id, so one
      person's profile cannot be reached in place of another's
- [x] Self-editable: full name, phone
- [x] Refused, by name and with a reason: roll number, semester, programme,
      department, batch, role, email, fee status
- [x] Email is not self-editable — it is the login and recovery identifier
- [x] Academic record shown to students, read-only, with an explanation of who
      maintains it
- [x] Department shown to staff
- [x] Change password and sign-out-everywhere on the same page
- [x] Membership, last sign-in and sign-in count
- [x] The role's permission list, labelled as informational
- [x] Every update audited by field name, never by value
- [x] Profile page at `/profile`, in the sidebar for every role
- [ ] Avatar upload

## 4. Students

- [x] Student record: roll number, programme, department, semester, year,
      section, batch year, fee status
- [x] Academic record is institution-owned and not self-editable
- [ ] User administration: create, deactivate, change role (permissions exist;
      no API and no screen)
- [x] Bulk import of students from CSV — check, then import; a dry run reports
      every bad row with its line number and writes nothing
- [x] All-or-nothing: one bad row refuses the whole file, and a mid-write
      failure rolls back rather than leaving half a cohort
- [x] A hand-written RFC 4180 reader (quotes, embedded commas and newlines,
      CRLF, BOM), tested against the cases a naive `split(",")` gets wrong
- [x] Each imported student gets a generated password, stored only as a bcrypt
      hash and downloadable once as a CSV; never in the audit trail

## 5. Departments, programmes, request types

- [x] Read via the directory API, and readable by any signed-in role because
      request forms need the list
- [x] Request types: read, create, deactivate (`POST /request-types`)
- [x] Request-type administration screen, with the shape of each service's form
      shown at a glance (questions, which are mandatory, documents required)
- [x] Editing a service's name no longer wipes its questions — the edit schema
      drops the create schema's defaults, and a test says so
- [x] Departments: create, rename, retire and restore — refusing to retire one
      that still has staff, programmes or students on it
- [x] Programmes: create, edit, retire and restore — refusing to retire one with
      students still enrolled
- [ ] Academic term/session setup and rollover
- [ ] Department heads can be assigned from the interface (the field exists)

## 6. Requests

- [x] Raise a request against a request type, with attachments
- [x] Assigned processing: accept, progress note, resolve, reject, forward
- [x] Status history and full audit trail
- [x] Escalation on SLA breach, and dean visibility
- [x] Filtering and scoping by role — own, assigned, department, institution
- [x] Screens for students and for approvers

## 7. Complaints

- [x] Raise a complaint, with attachments
- [x] **Confidential by default**: staff see it only once assigned
- [x] Acknowledgement SLA with escalation
- [x] Resolve, reject and withdraw
- [x] **Anonymous reporting** at `/grievance`, public and unauthenticated: no
      account, no name, and no IP address stored
- [x] Tracking by code — returns the state of the report and nothing else: no
      subject, no category, no description, no assigned officer
- [x] The code is stored only as a SHA-256 hash, so a database dump is not a
      list of working codes; shown once, and lookup tolerates a mistyped case or
      a missing hyphen
- [x] What anonymity costs is stated before the first keystroke, with the
      signed-in route offered for anyone who needs a reply
- [x] Confidential categories cannot be downgraded by the caller; the model
      derives it and the API refuses the field
- [~] Anonymous grievances reach an officer's queue, but there is no way to
      reply to one — inherent to the feature, and said so on the page
- [x] Screens for complainant and handler
- [ ] Anonymous complaint tracking code

## 8. Certificates

- [x] Apply for a certificate (`POST /certificates`)
- [x] Issue, verify and revoke
- [x] Generated PDF, stored privately and served only after authorisation
- [x] Public verification endpoint (`GET /certificates/verify`)
- [x] Student certificate list and detail screens
- [x] Staff issuance screen
- [x] **Application form** — nine types as a card picker, with live summary;
      a real radiogroup (arrow keys, roving tab index, one concise name per
      option), and it creates a real record end to end in the browser
- [x] Entry points to it from the certificates list, the empty state and the
      dashboard
- [x] **Public verification page** at `/verify`, outside the signed-in shell, for
      someone holding a paper certificate with no account; it keeps "not
      recognised", "revoked" and "authentic" apart, and discloses no holder name
- [ ] Certificate templates beyond the built-in one
- [ ] Bulk issuance

## 9. Finance

- [x] Invoices with lines in integer paise; totals computed server-side only
- [x] Student invoice list and detail, with private PDF download
- [x] Razorpay order creation against the real API (test keys, verified live)
- [x] Settlement by webhook signature verification
- [x] Settlement by direct server-side verification, for deployments with no
      public URL
- [x] A fabricated or mismatched payment ID cannot settle an invoice
- [x] Amounts are never taken from the client at any point
- [x] Receipts and refunds (partial and full) through the real SDK
- [x] Refund requests and finance approval
- [x] Reconciliation view
- [x] **Razorpay capture → receipt → refund verified end to end** against the live
      API, including a real payment and a real refund. Verified by hand through
      the checkout flow; the automated suites cover the server-side paths and the
      drill scripts cover the API calls, so this one rests on that manual pass
      rather than on a test.
- [ ] Live webhook delivery (needs a public URL and `RAZORPAY_WEBHOOK_SECRET`)
- [ ] Late-payment penalties and fee instalments
- [ ] Tax/GST invoicing

## 10. Announcements and notifications

- [x] Compose and publish
- [x] Audience scoping: institution, department, programme, role
- [x] Draft, publish, expire
- [x] In-app notification list, unread count, mark read
- [x] Announcement list and detail screens
- [ ] Email or push delivery of announcements
- [ ] Notification preferences

## 11. Reports and audit

- [x] Reports scoped by role; institution-only sections omitted, not zeroed
- [x] Audit trail, scoped and paginated
- [x] Audit entries for security-relevant events, including session revocation
- [~] **Internal notes are not separately protected** — they are confidential
      within a complaint's visibility scope, but not access-controlled per note
- [ ] Report export to PDF/CSV
- [ ] Scheduled report delivery

## 12. Documents and files

- [x] Upload with a 10 MB cap
- [x] Magic-byte allowlist; a renamed executable is refused
- [x] Generated storage keys; the original filename never becomes a path
- [x] Private storage, served only after an authorisation check
- [x] `X-Content-Type-Options: nosniff` and script-free attachment responses
- [~] **Cloudinary delivery is configured but not live-tested**; local storage is
      what has actually been exercised
- [ ] Malware scanning of uploads
- [ ] Image preview and thumbnail generation

## 13. Security

- [x] Passwords hashed (bcrypt) and never logged
- [x] Helmet headers, CSP, HSTS in production
- [x] CORS restricted to the known origins
- [x] Rate limiting on auth and write routes
- [x] No secrets, `.env`, `node_modules`, `dist` or `storage` in version control
- [x] Server-authoritative permissions; hidden links are convenience, not control
- [x] Headless browser checks for sign-in and per-role navigation
- [ ] Account lockout notification to the account owner
- [ ] Security headers report run against a live host
- [ ] Dependency audit recorded as a gate

## 14. Interface

- [x] One design system: layered tinted elevation, consistent 1rem radii, a
      single motion scale
- [x] Card, button, field and badge primitives restyled; every page that uses
      them updated at once
- [x] Page background carries a light source rather than a flat grey sheet
- [x] Palette rebuilt on violet with a coral accent, chosen because blue-on-white
      is the default of every admin panel ever built; neutrals carry the brand hue
      so white has something to sit against
- [x] Sidebar inverted to a dark gradient rail, giving the layout a spine
- [x] Canvas is lit — four colour fields plus fixed attachment — rather than a
      flat painted sheet
- [x] Sign-in page rebuilt around the new palette, and links to public verification
- [x] Top bar, notification panel and empty/error states brought onto the same
      tokens
- [x] Browser sweep proves the public page needs no account, which a per-role
      sweep structurally cannot check
- [ ] A dark theme
- [ ] Responsive re-check below 375px
- [ ] Loading skeletons instead of spinners on slow pages
- [ ] No motion/transitions audit on the finance tables

## 15. Quality gates

- [x] Backend: 541 tests passing
- [x] Frontend: 125 tests passing
- [x] ESLint clean on both projects
- [x] Production build succeeds
- [x] `npm run verify:login` — real-browser sign-in sweep
- [x] `npm run verify:roles` — real-browser per-role sweep including the
      super administrator, whose pages no other role can reach
- [x] The sweep detects a failed page by `role="alert"`, not by searching for
      words, and is itself covered by a test so it cannot quietly stop failing
- [~] CI workflow running lint, format, tests, the browser sweep and an image
      build on every push — written, but never executed, because it has only
      ever run locally
- [ ] Coverage thresholds enforced

## 16. Operations

- [x] Structured logging
- [x] Health endpoint
- [x] Database connection guard that refuses a non-Atlas URI in production
- [x] Indexes synchronised on the Atlas cluster
- [x] Demo seeder producing canonical references, with `--force` cleanup
- [~] Deployment configuration written: two multi-stage Dockerfiles, a compose
      file with health-gated startup, an nginx config with the API proxy and
      security headers, and DEPLOY.md documenting the environment contract. The
      images have **not been built** — Docker is not installed on the machine
      this was written on, so "it builds" is unproven.
- [ ] Uptime monitoring and alerting (needs a host and an alert destination)
- [ ] Error tracking service (needs a DSN)

---

## Known blockers

1. **Live webhooks** need a public URL and a signing secret. Direct server-side
   verification works and is what the deployment uses by default.
2. **Cloudinary** is configured but has never served a real file; local storage
   is what has actually been exercised.
3. **Malware scanning** is not installed. Uploads are allow-listed by magic
   bytes, size-capped and served from private storage, but not scanned.

Razorpay was verified by hand and is no longer on this list.

## What is genuinely finished

Authentication and sessions, the permission model, requests, complaints,
certificate issuance and PDFs, invoices, refunds and reconciliation, document
upload and private delivery, announcements and notifications, scoped reports and
audit, and the profile section for every role.

## What is not

The items still marked above with no box: email verification, password reset by
email, two-factor authentication, avatar upload, academic term setup, report
export and scheduling, malware scanning, dark theme, responsive re-checking below
375px, loading skeletons, uptime monitoring and error tracking. Some need a host
or a third-party account; the rest are simply not built.
