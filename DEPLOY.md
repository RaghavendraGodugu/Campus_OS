# Deploying CampusOS

The supported production layout is:

| Piece                         | Host          |
| ----------------------------- | ------------- |
| Frontend (Vite static bundle) | Vercel        |
| API (Express + Docker)        | Render        |
| Database                      | MongoDB Atlas |

The frontend and API are different sites, so production uses Secure,
SameSite=None session cookies and an exact CORS allowlist. That is deliberate:
the application already implements it, and it avoids making the API public
behind a Vercel proxy with request-size limits.

Docker is also supported for a single host behind TLS. See
[Docker fallback](#docker-fallback) at the end.

---

## 0. What you need

- A GitHub repository containing this code.
- MongoDB Atlas cluster and connection string.
- Cloudinary account (cloud name, API key, API secret).
- SMTP account for verification/password-reset email.
- Razorpay live keys and webhook secret.
- Render account.
- Vercel account.

`VITE_*` values are **public** and are baked into the browser bundle. Never put
a database URL, JWT secret, Cloudinary secret, Razorpay secret, or SMTP password
in a Vercel environment variable.

Generate the three application secrets separately:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run it three times. `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, and `CSRF_SECRET`
must all be different.

---

## 1. MongoDB Atlas

1. Create a cluster and a database user with a strong password.
2. Create the database by using a URI with a database name, for example:
   `mongodb+srv://user:password@cluster.mongodb.net/campusos?retryWrites=true&w=majority`
3. For Render, allow connections from Render's dynamic egress addresses. The
   simple option is Atlas Network Access `0.0.0.0/0`; protect the database with a
   strong password and never expose it without authentication.
4. Keep the URI private. It contains the database password.

The API refuses a URI with no database path because MongoDB would connect to a
database literally named `test`.

---

## 2. Deploy the API on Render

The repository contains `render.yaml`. In Render:

1. **New → Blueprint**, connect the repository, and apply the blueprint.
2. The service is defined as a Docker web service with:
   - Dockerfile: `campusOs_backend/Dockerfile`
   - Context: repository root
   - Health check: `/health/ready`
3. Fill every `sync: false` value. These are minimum production values:

| Variable                  | Value                                                           |
| ------------------------- | --------------------------------------------------------------- |
| `MONGO_URI`               | Atlas URI with `/campusos` (or your database name)              |
| `JWT_SECRET`              | first generated secret                                          |
| `REFRESH_TOKEN_SECRET`    | second generated secret                                         |
| `CSRF_SECRET`             | third generated secret                                          |
| `CLIENT_URL`              | `https://your-app.vercel.app` (exact origin, no trailing slash) |
| `WEB_URL`                 | `https://your-app.vercel.app`                                   |
| `CLOUDINARY_CLOUD_NAME`   | Cloudinary cloud name                                           |
| `CLOUDINARY_API_KEY`      | Cloudinary API key                                              |
| `CLOUDINARY_API_SECRET`   | Cloudinary API secret                                           |
| `RAZORPAY_KEY_ID`         | live key, begins `rzp_live_`                                    |
| `RAZORPAY_KEY_SECRET`     | live key secret                                                 |
| `RAZORPAY_WEBHOOK_SECRET` | webhook secret from Razorpay                                    |
| `SMTP_HOST`               | SMTP hostname                                                   |
| `SMTP_USER`               | SMTP username                                                   |
| `SMTP_PASSWORD`           | SMTP password                                                   |
| `SMTP_FROM`               | e.g. `CampusOS <no-reply@your-domain>`                          |

`NODE_ENV=production`, `COOKIE_SECURE=true`, `LOG_PRETTY=false`, and
`LOG_LEVEL=info` are already set by the blueprint.

Do **not** set `PORT`; Render assigns it. Do **not** set `MONGOMS_*` in
production; the in-memory database is test-only.

The free Render plan spins down after inactivity. Use a paid instance for a
real college deployment so the first login after a quiet period is not slow.

### First super administrator

There is deliberately no public "make me admin" endpoint. Create the first
account against Atlas from a trusted machine:

```bash
cd campusOs_backend

# Point only this command at Atlas; the rest of the local .env stays untouched.
MONGO_URI='mongodb+srv://user:password@cluster.mongodb.net/campusos?retryWrites=true&w=majority' \
  npm run create-admin
```

The script reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment or the
local `.env`, or prompts for the password. Remove `ADMIN_PASSWORD` after use.
Every later account is created in Administration → People.

### Indexes

A fresh database creates indexes automatically. After deploying schema changes
that change an index, run the deliberate migration:

```bash
cd campusOs_backend
MONGO_URI='...' npm run migrate:indexes -- --force
```

Do not make this an automatic production startup step; it drops indexes the
schema no longer declares.

---

## 3. Deploy the frontend on Vercel

Import the same repository. Root directory must be the **repository root**, not
`campusOs_frontend`, because the workspace lockfile and `vercel.json` live there.

`vercel.json` already supplies:

- install: `npm ci --include=dev --ignore-scripts --workspace campusOs_frontend`
  (`Vite` is a devDependency; `--include=dev` keeps the build working when
  `NODE_ENV=production` is set in the Vercel project)
- build: `npm run build --workspace campusOs_frontend`
- output: `campusOs_frontend/dist`
- SPA fallback for client-side routes
- security headers and long-lived caching for hashed assets

Set these Vercel environment variables for **Production**:

| Variable                | Value                                      |
| ----------------------- | ------------------------------------------ |
| `VITE_API_URL`          | `https://your-service.onrender.com/api/v1` |
| `VITE_RAZORPAY_KEY_ID`  | the live publishable key, `rzp_live_...`   |
| `VITE_SHOW_DEMO_BANNER` | `false`                                    |

`VITE_API_URL` must include `/api/v1` and must not have a trailing slash.
Vite bakes these values in at build time, so redeploy after changing any of
them.

The build injects a Content-Security-Policy that allows the API origin derived
from `VITE_API_URL`, Razorpay checkout, and the hash of the inline theme
bootstrap. If you change the API host, rebuild the frontend.

### Wire the two hosts together

1. Deploy Render first and copy its HTTPS URL.
2. Set `VITE_API_URL` in Vercel and deploy.
3. Copy the Vercel production URL into Render's `CLIENT_URL` and `WEB_URL`.
4. Restart/redeploy Render.
5. Sign in and verify a dashboard page loads.

Preview deployments have different hostnames and will not match `CLIENT_URL`.
Use the production domain, or add each origin to the comma-separated
`CLIENT_URL` list.

For a real college deployment, put both hosts under one registrable domain —
for example `app.college.edu` on Vercel and `api.college.edu` on Render. They are
then same-site, so session cookies are first-party. On the default
`*.vercel.app` + `*.onrender.com` hostnames the cookies are cross-site;
Chrome/Firefox generally allow that with `SameSite=None; Secure`, but Safari's
ITP can block it and cause a sign-in loop. No code change is needed when you
switch to custom subdomains.

---

## 4. Configure the integrations

### Cloudinary

Production refuses to start without all three Cloudinary values. Upload a
certificate or announcement image after deployment to confirm private delivery
works. Local container storage is not used in production.

### SMTP

Verification and password-reset links use `WEB_URL`. Send a password-reset email
to a real inbox and confirm the link opens the Vercel deployment. Without SMTP,
the API writes links to a server-local file nobody can read from the internet.

### Razorpay

1. In Razorpay Dashboard → Webhooks, add:
   `https://your-service.onrender.com/api/v1/payments/webhook/razorpay`
2. Use the same webhook secret in Render as `RAZORPAY_WEBHOOK_SECRET`.
3. Subscribe to the payment and refund events used by the finance module.
4. Run a small live payment and confirm the invoice settles and a receipt is
   generated. The browser callback alone never marks an invoice paid.

---

## 5. Verify the deployment

```bash
curl https://your-service.onrender.com/health
curl https://your-service.onrender.com/health/ready
```

`/health/ready` must return `200`; a `503` means the API cannot reach Atlas.

Then check, in order:

- [ ] Sign in as the super administrator.
- [ ] Create a department/programme/subject/room and schedule a class.
- [ ] Upload a small PDF and open it again.
- [ ] Trigger a password reset and receive the email.
- [ ] Run a Razorpay test/live transaction and confirm settlement.
- [ ] Confirm `https://your-app.vercel.app` has no console CSP errors.
- [ ] Check that no `.env`, secrets, storage files, or backups are in git.

Atlas backups should be enabled. The repository also provides:

```bash
npm run backup --prefix campusOs_backend -- --with-files
npm run restore --prefix campusOs_backend -- --from backups/campusos-… --drill
```

A dump contains grievances, certificates, and receipts in clear. Encrypt the
destination and never commit `backups/`.

---

## 6. Tests before a release

Tests are not required at runtime, and they are not part of the production
bundle. They are a release gate: run them in CI or before promoting a deploy.

```bash
npm run lint
npm run format:check --workspace campusOs_backend
npm run format:check --workspace campusOs_frontend
npm test
npm run test:frontend
npm run build
```

The frontend build is the same build Vercel runs. The backend tests use an
in-memory MongoDB and never touch Atlas.

---

## Docker fallback

The Docker stack is for a single VPS with a domain and TLS terminator. It is not
the Vercel/Render path.

```bash
cp campusOs_backend/.env.example .env
# Fill in real values. Set CLIENT_URL and WEB_URL to the public HTTPS origin.
docker compose up --build
```

Put Caddy, nginx, or a load balancer in front of the `web` container and
terminate TLS there. Production cookies are Secure, so login over plain HTTP
will fail by design.

The Dockerfiles build from the root npm workspace lockfile. If you build the
frontend for a different API origin:

```bash
docker build \
  --build-arg VITE_API_URL=https://api.example.edu/api/v1 \
  -f campusOs_frontend/Dockerfile .
```

For a single-host deployment, Atlas is still preferable to the bundled Mongo
container. Set `MONGO_URI` to the Atlas URI and remove or ignore the `db`
service.

---

## Scaling notes

Not configured deliberately:

- Rate limiting is in-process; multiple API nodes need a shared store.
- Refresh sessions are in MongoDB and survive multiple nodes.
- The Docker volume is single-host storage; production uses Cloudinary.
- Atlas should be a replica set for transactions and backups.
