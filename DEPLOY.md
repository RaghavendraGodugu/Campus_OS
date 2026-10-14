# Running CampusOS

Two ways: on one machine with Docker, or as two services against a managed
database. The first is what most people want.

---

## 1. Docker (one host)

```bash
cp campusOs_backend/.env.example .env       # then edit it — see below
docker compose up --build
open http://localhost:8080
```

Three containers: `db` (Mongo), `api`, and `web` (nginx serving the built
bundle and proxying `/api` to the API).

### The first super administrator

There is deliberately no "register" endpoint and no way to make yourself an
administrator over HTTP. Whoever finds a fresh deployment first would claim it.
The first account comes from a script, run on the server:

```bash
docker compose exec api node scripts/create-admin.js
```

Every subsequent account is made in the app, under **Administration → People**.

---

## 2. Without Docker

```bash
npm ci

# backend
cd campusOs_backend
npm run migrate:indexes
npm start                       # PORT 5050

# frontend, in another shell
cd campusOs_frontend
npm run build
npx vite preview                # or any static server
```

Serve `campusOs_frontend/dist` from nginx, Caddy, or a CDN, and proxy `/api` to
the backend on the same origin. The session cookies are `SameSite`, so the
browser will only send them to the origin that loaded the page; a client
pointed at a different API host would need cross-site cookies or a CORS
exception, and both are worse than a proxy.

---

## Environment

`campusOs_backend/.env` — see `.env.example` for the full contract. The
application validates it at startup and **exits with a readable message** rather
than failing later inside Mongoose.

| Variable | Required | Notes |
|---|---|---|
| `MONGO_URI` | yes | Atlas SRV string or `mongodb://host/db`. |
| `PORT` | no | Defaults to 5050. The dev proxy reads it. |
| `JWT_ACCESS_SECRET` | yes | Min 32 characters. |
| `JWT_REFRESH_SECRET` | yes | Min 32 characters, and **different** from the access one. |
| `CSRF_SECRET` | yes | Signs the readable CSRF token. |
| `RAZORPAY_KEY_ID` | no | Without these, payments are unavailable and the finance pages say so. |
| `RAZORPAY_KEY_SECRET` | no | |
| `RAZORPAY_WEBHOOK_SECRET` | no | Needed only for live webhook delivery. Direct server-side verification works without it. |
| `TRUST_PROXY` | no | `true` only when TLS terminates in front of the API. |
| `LOG_LEVEL` | no | `info` by default. |

### Behind a proxy

Set `TRUST_PROXY=true` **only** when the API genuinely sits behind a reverse
proxy. It makes Express trust `X-Forwarded-For`, which a client can forge —
with it on and no proxy in front, anyone can bypass the rate limiters and the
per-IP audit records by setting a header.

---

## Backups

```bash
npm run backup --prefix campusOs_backend -- --with-files
npm run restore --prefix campusOs_backend -- --from backups/campusos-… --drill
```

`--drill` restores into a throwaway database, compares every collection's count
and the index list against the manifest, drops it, and exits non-zero on any
mismatch. Run it on a schedule — a backup nobody has restored is a claim, not a
fact.

Restoring over a live database needs `--confirm`. That flag is a pause: without
it the tool refuses, rather than destroying three years of grievances.

`mongodump`/`mongorestore` come from `mongodb-database-tools`, which is *not*
bundled with the Mongo server. On macOS `brew install mongodb-community@7.0`,
on Debian `apt install mongodb-database-tools`.

**A dump is unencrypted.** It contains every grievance, certificate and receipt
in clear. Encrypt the destination, not the file, and keep `backups/` out of the
image (`.dockerignore` already does).

---

## Before going live

- [ ] `MONGOMS_SYSTEM_BINARY` unset in the backend environment — the in-memory
      database used by the tests has no business in production.
- [ ] Real secrets, generated per deployment, not copied from an example.
- [ ] TLS terminating in front of the web container, with HSTS set there. The
      container deliberately does not send HSTS, because it is served over plain
      HTTP and a browser would pin the host to HTTPS permanently.
- [ ] `VITE_SHOW_DEMO_BANNER=false` (the default in the Dockerfile).
- [ ] Razorpay keys set, and a real webhook endpoint configured if you want live
      webhooks.
- [ ] Backups scheduled, and a drill run once.
- [ ] `npm run verify:roles` run against the deployment, not just locally.

---

## Scaling beyond one host

Not configured, deliberately. Each of these needs a decision rather than a
setting:

- **Rate limiting** is in-process, so two API nodes give every visitor twice
  the limit they should have. Move to a shared store (Redis) first.
- **Sessions** are refresh tokens in Mongo, so they survive multiple nodes — but
  the in-memory limiter above does not.
- **Storage** is a Docker named volume on one disk. Move to object storage.
- **Database** is a single node. Point `MONGO_URI` at a replica set or Atlas.