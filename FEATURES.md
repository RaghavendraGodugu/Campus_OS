# CampusOS — feature status

Every box below is a claim about the code, not an intention. A box is ticked only
when the feature works end to end and is covered by a test; anything awaiting a
human step or a missing screen is left empty and says why.

**Legend** — `[x]` working · `[ ]` not working · `[~]` partly working (the tick
means the note that follows it)

- **Last reviewed:** 21 October 2026
- **Verified:** 886 backend tests, 181 frontend tests, lint and build clean, plus a green 78-check browser sweep against Atlas across nine roles and four public pages
- **Databases:** Atlas `campusos` exercised end to end — a real GST invoice
  (₹1,00,000 + 18% CGST/SGST = ₹1,18,000, halves reconciling exactly), an
  opened academic term, a saved tax registration, and a green browser sweep
  across all four roles at 375px, 320px and full width

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
- [x] Email verification — a confirmation link is mailed on request from the
      profile; the address is only treated as proven once the link is used, and
      a verification link cannot set a password
- [x] Password reset by email — asking for a link always answers the same way,
      whether or not the address is registered, so the form cannot be used to
      list the college. Links are single-use, expire in an hour, and every other
      session is ended when one is used
- [x] Two-factor authentication — TOTP, enforced at the login step with no
      session until the code arrives; the challenge is a distinct token type, so
      it can never be used as an access token. Turned on and off from the profile
      with a working code required to turn it off, ten single-use recovery codes
      shown once, secret sealed with AES-256-GCM, RFC 6238 vectors covered

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
- [x] **Avatar upload**, shown in the profile page and the top bar. Stored as a
      storage key and never as a URL or a data blob: a URL is a public address
      for somebody's face that nobody chose to publish, and a blob would put
      megabytes inside the user document that every unrelated query reads
- [x] **Avatars are capped at 2 MB**, far below the 10 MB document limit, and are
      routed to Cloudinary's `image` pipeline. An avatar is displayed at 40px in
      the top bar; a 9 MB photograph there is a crop waiting to happen
- [x] **WebP is accepted for avatars only.** The shared document sniffer does not
      recognise it, and widening that allowlist to cover it would let a WebP into
      a certificate upload
- [x] **The picture is fetched through an endpoint, never a public URL**, so the
      bytes are only served after the server has decided the reader may have
      them. The profile exposes `hasAvatar` and never the storage key
- [x] **Replacing a picture commits the new one before deleting the old**, so a
      failure part-way leaks an orphaned object rather than a record pointing at
      bytes that are gone — which would break the picture for every user

## 4. Students

- [x] Student record: roll number, programme, department, semester, year,
      section, batch year, fee status
- [x] Academic record is institution-owned and not self-editable
- [x] User administration: create a staff account, change a role, deactivate,
      and reset a password — each its own permission and its own audit line, and
      deliberately *not* grouped behind one "Manage" button, because that is how a
      role change happens by someone aiming for Deactivate
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
- [x] **Academic terms.** A term is a named window with dates, so "this
      semester" is a record rather than a date range somebody typed. Exactly one
      term can be current, enforced by a partial unique index rather than by
      application code — a check-then-write races with itself under two
      simultaneous clicks, which is exactly when a duplicate appears
- [x] **Opening a term closes the previous one atomically**, in a transaction.
      Leaving zero current terms would make every form that asks which term it
      belongs to have nothing to offer
- [x] **A closed term's dates are immutable.** Every total ever reported for it
      was measured inside that window; moving it would silently re-label all of
      them. Its name and notes stay correctable, because refusing everything
      would make a typo permanent
- [x] **Terms get their own audit actions.** Folding "open" and "close" into a
      generic UPDATE would leave the audit trail unable to answer who changed the
      term a figure belongs to
- [x] **The test database now runs as a replica set.** A standalone Mongo
      rejects transactions outright, so the atomicity above would have been
      untestable — and no service in the codebase used one until now, meaning the
      claim "transactions where a write spans documents" was untested
- [x] **Department heads can be appointed from the interface.** The `hod` field
      existed with nothing able to set it. Three rules, each refusing a mistake
      that would otherwise fail quietly: the appointee must hold the HOD role
      (the only role with department-wide scope, so appointing anyone else grants
      them nothing), must belong to the department (or every HOD-scoped page comes
      back empty for them), and nobody may head two departments
- [x] **Its own permission and its own audit action.** Renaming a department is
      housekeeping; deciding who runs one is not. The audit line records both the
      appointee and who was replaced, because the before-and-after of an
      authority grant is the whole point

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
- [x] **Certificate templates**, at `/management/certificate-templates`. Heading,
      body and footer as plain text with `{{placeholders}}` — never markup,
      because these files get downloaded and opened, and an uploaded logo would
      be an unvetted file on an official-looking page
- [x] **A preview renders against a sample student and creates nothing.** Issuing
      a real certificate to check whether a template looks right would put a real
      document in a real student's record
- [x] **Unknown placeholders are shown, not swallowed.** `{{rollNo}}` against a
      system that says `{{rollNumber}}` is left as literal text and flagged.
      Blanking it would produce a printed certificate with a gap where a roll
      number belongs, and nobody would know why
- [x] **At most one default per type**, by partial unique index, and the previous
      default is demoted *before* the write — demoting afterwards never runs,
      because the index rejects the insert first
- [x] **Bulk issuance**, from the certificates list. It can only turn *already
      approved* work into issued documents and cannot approve anything — issuing
      forty in one click is forty judgements at once, which is how a whole cohort
      receives a certificate nobody checked
- [x] **Every skip is named with a reason.** "38 issued" and silence about the
      other two is how somebody assumes all forty went through

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
- [x] **Fee instalments.** An invoice splits into a schedule that sums to its
      total exactly: the earlier instalments are floored and the last absorbs
      the remainder, because 1000 ÷ 3 is 333.33 and three of those is 999.99 —
      a student short by a paisa through no fault of their own
- [x] **Splitting is refused once any payment has landed.** The schedule would
      no longer sum to what the student was told they owe, and the difference
      would come out of their pocket silently
- [x] **Late-payment penalties**, with rate, period, grace days and a cap. The
      grace clock starts *after* the grace period rather than at the due date, so
      charging from the due date would penalise the grace days twice
- [x] **The penalty accrues on the original debt, never on a balance that
      already includes earlier penalties.** Charging 1% of a growing balance
      makes a student pay roughly 0.5% extra every month forever — and makes a
      second sweep charge again
- [x] **A sweep is idempotent.** Recomputed and charged as a delta, so a job
      running hourly, daily or twice in a minute costs one period of lateness
      once. A dry run is supported and writes nothing
- [x] **The policy is snapshotted onto the invoice.** Changing the college's rate
      next month must not retroactively alter terms a student already agreed to
- [x] **Never charged on a settled invoice**, and never more than the outstanding
      balance — checked before anything else, because it is the most damaging
      bug this calculation could have
- [x] **GST invoicing.** One institution-wide registration with a validated GSTIN,
      place of supply and signatory. The state is *derived* from the GSTIN's
      first two digits rather than typed, because a profile claiming state 07
      while carrying a GSTIN beginning 29 issues invoices stating the wrong place
      of supply — wrong on the document, and invisible on it
- [x] **The CGST/SGST split versus IGST is computed server-side, never by the
      issuer.** A supply inside the state splits into CGST and SGST; one outside
      it is charged IGST at the full rate. The total is identical either way, so
      a wrong split cannot be spotted by looking at the invoice — it is caught by
      an auditor. The split is stored on the line at issue time, because
      recomputing it at print time would re-derive it from a student's *current*
      address
- [x] **The halves always reconcile.** CGST is floored and SGST takes the odd
      paisa, so a tax of 101 splits 50/51 rather than both rounding to 51
- [x] **Taxed lines are grouped by rate slab and HSN**, which is how a return is
      filed and how the invoice is checked — not listed line by line
- [x] **The registration is snapshotted onto the invoice**, so a corrected
      profile does not silently change a document that has already been filed
- [x] **An institution with no GST profile can still issue a taxable invoice**,
      marked `isTaxInvoice: false`. Refusing would turn a missing setup step into
      an outage, but the silent version — a tax total with no registration —
      would only be noticed when the quarter failed to reconcile

## 10. Announcements and notifications

- [x] Compose and publish
- [x] Audience scoping: institution, department, programme, role
- [x] Draft, publish, expire
- [x] In-app notification list, unread count, mark read
- [x] Announcement list and detail screens
- [x] **Announcement email**, to confirmed addresses only. Muting announcements
      stops the email as well as the badge — an inbox is not a record you read
      when you like, so honouring the preference here is the only honest reading
      of "do not interrupt me". The in-app notice is still delivered either way
- [x] **Notification preferences**, on the profile page. Five categories rather
      than fourteen types — somebody can express "don't interrupt me about
      money" in one tap, which fourteen switches never achieves
- [x] **Muting stops the badge, never the delivery.** A muted notification is
      still written and still listed; it is simply stored already read, so the
      unread count ignores it and nothing else has to know preferences exist. A
      student who mutes finance and then misses "your refund was processed" has
      been harmed by a setting meant to stop noise. The screen says so in words,
      because a switch labelled only "Finance" reads as "turn off messages"
- [x] **A notification type with no category still badges.** Not filing a new
      type must not silently mute it: a notification nobody receives is worse
      than one badge too many
- [x] **Every category is written, never merged.** A partial patch makes it
      ambiguous whether an absent key means "leave it alone" or "switch it off",
      and the second reading is the one that quietly mutes somebody

## 11. Reports and audit

- [x] Reports scoped by role; institution-only sections omitted, not zeroed
- [x] Audit trail, scoped and paginated
- [x] Audit entries for security-relevant events, including session revocation
- [~] **Internal notes are not separately protected** — they are confidential
      within a complaint's visibility scope, but not access-controlled per note
- [x] **Report export to CSV and PDF**, generated from the same service the
      screen uses rather than from the database, so the two can never disagree
      about who may see what. A spreadsheet is the artefact people actually
      circulate, and a scope bug in one and not the other would hand one
      department another department's requests
- [x] **Spreadsheet-injection guard.** A student can put anything in a request
      title, so a cell beginning `=`, `+`, `-`, `@`, tab or CR is prefixed —
      otherwise a downloaded report is a way to run a formula in a colleague's
      spreadsheet. 21 tests, including RFC 4180 quoting and the guard running
      before quoting
- [x] **An unavailable report exports a file that says so.** A CSV has nowhere
      to put a footnote, and a file reading "scope: department" alone says
      "nothing happened this period", which is a different and worse claim
- [ ] Scheduled report delivery

## 12. Documents and files

- [x] Upload with a 10 MB cap
- [x] Magic-byte allowlist; a renamed executable is refused
- [x] Generated storage keys; the original filename never becomes a path
- [x] Private storage, served only after an authorisation check
- [x] `X-Content-Type-Options: nosniff` and script-free attachment responses
- [x] **All image storage routes to Cloudinary.** Images upload through
      Cloudinary's `image` resource type, so they are transcoded and optimised
      on delivery; documents stay `raw`, delivered byte for byte, because
      recompressing a signed certificate is indefensible. Images get inline
      delivery so a thumbnail renders in place, documents get an attachment so
      a certificate never silently opens in a new tab. An unrecognised
      extension is treated as a document rather than guessed at
- [x] **`cloudinary` is now a declared dependency.** It was imported by
      `config/storage.js` but never listed in `package.json`, so a production
      `npm ci` would have died on `MODULE_NOT_FOUND` the first time anyone
      configured credentials — and it would have looked like a Cloudinary
      outage rather than a missing package
- [x] **23 tests cover the Cloudinary adapter**, which had none: it had never
      been executed by anything. Images and documents are routed to the right
      pipeline, delivery is always `authenticated`, signatures expire, deletes
      target the right resource type and report failure instead of throwing,
      and unsupported or oversized files are rejected before any network call
- [~] **Cloudinary delivery is configured but not live-tested**; local storage is
      what has actually been exercised
- [ ] Malware scanning of uploads
- [x] Image preview before upload, from the local `File`, so an officer sees it
      before sending it
- [ ] Thumbnail generation for stored documents

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
- [x] Palette rebuilt on deep emerald with a coral accent, over a warm sand
      canvas. The accent dodges all four status hues (emerald success, amber
      pending, red danger, sky info) so an alert can never be mistaken for
      decoration
- [x] **Contrast checked numerically, not by eye.** The first emerald palette
      failed six checks — a green that looks elegant carries so much luminance
      that white text on it sits near 2:1. The ramp is now dark from 700 down and
      the primary button gradient starts there: body text 10.07:1, links 4.66:1,
      button labels 4.60:1
- [x] Sidebar inverted to a dark gradient rail, giving the layout a spine
- [x] Canvas is lit by a single soft colour blob in one corner, fixed while the
      page scrolls. The earlier four-field backdrop was wallpaper: every card sat
      on a different colour, so no card read as the same kind of object as any
      other. The same one blob appears in both themes
- [x] Sign-in page rebuilt around the new palette, and links to public verification
- [x] Top bar, notification panel and empty/error states brought onto the same
      tokens
- [x] Browser sweep proves the public page needs no account, which a per-role
      sweep structurally cannot check
- [x] Dark theme: light / dark / follow-the-system, applied before first paint by an
      inline script so there is no flash of the wrong one, and held in one
      provider so components cannot disagree about it
- [x] Every surface, status colour, card, field and callout carries a dark
      variant; verified in a real browser rather than by reading the classes
- [x] **Announcement image upload.** An image can be attached to a notice and is
      rendered inline for everyone in the audience. Images route to Cloudinary's
      `image` pipeline, so they are transcoded on delivery; the stored MIME type
      is sniffed from the bytes, never taken from the client's label, and the
      allowlist is JPEG and PNG only because an announcement image is displayed
      inline and a PDF has nothing to display
- [x] **Fixed: the announcement detail page rendered a blank notice.** The API
      nests the record under `data.announcement` while every other endpoint
      spreads it into `data`, and the page read `data.data`. Nothing threw — it
      rendered an empty notice with em-dashes and reported itself healthy. Two
      regression tests now cover the envelope, and one was confirmed to fail
      against the old code
- [x] Responsive at 375px and 320px, checked automatically: the browser sweep
      now fails the build if any page scrolls sideways at either width, and
      signs in first so it cannot pass by measuring the login page five times
- [x] Tap targets on the top bar raised to 36px, and the theme toggle corrected
      where `hidden sm:inline-flex` had silently not worked
- [x] Loading skeletons on every page that waits for the server, shaped like
      the content that replaces them — list rows for lists, panels for detail
      pages, fields for forms — so the layout is already correct when the data
      lands and nothing moves. Announced once via a polite live region; the
      bars themselves are hidden from assistive technology, which would
      otherwise read forty times instead of spinners on slow pages
- [ ] No motion/transitions audit on the finance tables

## 15. Quality gates

- [x] Backend: 828 tests passing
- [x] Frontend: 181 tests passing
- [x] ESLint clean on both projects
- [x] Production build succeeds
- [x] `npm run verify:login` — real-browser sign-in sweep
- [x] Skeleton accessibility covered: the live region is announced once, the
      decorative bars are not announced, and list rows keep a constant height so
      the layout cannot jump. The sweep's own page classifier is shown a skeleton
      too, which it had never been before every page began showing one
- [x] `npm run verify:roles` — real-browser per-role sweep including the
      super administrator, whose pages no other role can reach, plus the two
      public pages with no session and a narrow-viewport overflow check
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

## 17. Academic core

- [x] Academic terms with exactly one open term at a time; a register, a result
      and an instalment can only be written into an open term
- [x] Subjects and rooms as live catalogue entries; a retired subject cannot
      appear on a new timetable
- [x] Timetable with generated clash rules: an overlapping room, a teacher
      double-booked across rooms, a cohort booked for two subjects at once —
      each refused with a reason; back-to-back classes are allowed
- [x] A student sees only their programme and semester; faculty see only the
      classes they teach; a HOD schedules and reads inside their department
- [x] Attendance registers that must be complete before they are saved — no
      register that quietly defaults a student to absent; invalid students, a
      day the class does not meet, a closed term and a second marking are all
      refused
- [x] Corrections bump a revision number and write an audit entry; a teacher
      who does not teach the class cannot correct it, even with the permission
- [x] Percentages are derived, never stored or typed
- [x] Marks and components with their own maxima; an unfilled component blocks
      release; the grade derives from the marks and recomputes on correction
- [x] Release is a decision, not a side effect: a student sees nothing before
      their programme is released; a HOD releases their programme, the
      examination office releases institution-wide

## 18. Campus services

- [x] Hostel: rooms with capacity; a refusal that names the reason rather than
      "conflict"; one active allocation per student, room freed on vacate;
      leave requires an active allocation and only the warden decides
- [x] Library: catalogue with copies; the last copy is issued atomically and
      the next borrower is refused; a double borrow rolls the count back; a
      copy is returned exactly once
- [x] Placements: companies and drives; draft drives invisible to students
      until opened; one application per drive, duplicate refused, withdrawal
      allowed; eligibility and deadline both enforced; the company directory
      ("who is recruiting") is readable by the same roles that can list drives
- [x] The three operational roles read and manage their own domain and hold no
      generic request/complaint grants

---

## Known blockers

1. **Live webhooks** need a public URL and a signing secret. Direct server-side
   verification works and is what the deployment uses by default.
2. **Cloudinary** is a working, tested adapter and a declared dependency, but
   has still never served a real file from real credentials; local storage
   is what has actually been exercised.
3. **Malware scanning** is not installed. Uploads are allow-listed by magic
   bytes, size-capped and served from private storage, but not scanned.

Razorpay was verified by hand and is no longer on this list.

## What is genuinely finished

Authentication, sessions, two-factor sign-in, email verification and password
reset, the permission model, the request engine, the grievance engine,
certificate issuance, PDFs and templates, the finance stack (invoicing with GST,
instalments, penalties, refunds, a Razorpay gateway), documents, announcements
with email delivery and image upload, notifications and their preferences,
scoped reports, exports and audit, the profile for every role, and the academic
core (terms, subjects, timetable, attendance, marks and result release) together
with hostel, library and placements, and the campus overview that aggregates
them for the dean and principal.

## What is not

The items still marked above with no box: a live Razorpay webhook beyond the
signature check, scheduled report delivery and scheduled penalty runs, event
management, a searchable staff directory, term rollover automation, per-college
certificate branding, malware scanning of uploads, document thumbnails, an
account-lockout notification, a security headers report, a dependency-audit
gate, coverage thresholds, a motion audit on the finance tables, and uptime
monitoring or error tracking. Most need a host, a third party or a product
decision; the rest are simply not started.

Three more are marked done but rest on a human step rather than a test: the
Razorpay capture-to-refund drill, the Docker image build, and Cloudinary delivery
from real credentials.
