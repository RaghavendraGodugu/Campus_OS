# Deploying CampusOS

CampusOS is deployed as two services: the React SPA on Vercel and the Express
API on Render. MongoDB Atlas stores the application data. Deploy the API first
so its URL can be supplied to the frontend build.

## 1. Deploy the API to Render

Create a Render Blueprint from `render.yaml`. Render runs the backend directly
with Node from `campusOs_backend/`, using its committed backend lockfile. No
Docker settings are required.

Set every `sync: false` value in Render. At minimum, production needs:

- `MONGO_URI` — Atlas connection string including a database name.
- `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, and `CSRF_SECRET` — three different
  random values.
- Cloudinary, Razorpay, and SMTP credentials.
- `CLIENT_URL` and `WEB_URL` — set these after the Vercel production domain is
  known. They must use HTTPS and have no trailing slash.

Wait for `GET /health/ready` on the Render URL to return HTTP 200. Its API base
URL is `https://<your-render-service>.onrender.com/api/v1`.

## 2. Deploy the frontend to Vercel

Import this repository into Vercel and use these Build and Deployment settings:

| Setting | Value |
| --- | --- |
| Root Directory | `.` (repository root) |
| Framework Preset | Vite |
| Node.js Version | 22.x |
| Install Command | Managed by `vercel.json` |
| Build Command | Managed by `vercel.json` |
| Output Directory | Managed by `vercel.json` |

Do not set `campusOs_frontend` as Vercel's Root Directory. Vercel limits builds
to the selected directory, while this repository intentionally has one lockfile
at the root. The root `vercel.json` installs the package named
`campusos-frontend` and writes the static site to `dist` at the repository
root.

Add these Vercel environment variables for **Production**, **Preview**, and
**Development** as appropriate:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | `https://<your-render-service>.onrender.com/api/v1` |
| `VITE_RAZORPAY_KEY_ID` | Razorpay publishable key (`rzp_test_...` or `rzp_live_...`) |
| `VITE_SHOW_DEMO_BANNER` | `false` for a real deployment |

`VITE_` variables are embedded in the browser bundle. Never place secrets in
Vercel's frontend environment variables.

## 3. Link the two services

Once Vercel gives you the production domain, update Render:

```text
CLIENT_URL=https://your-domain.vercel.app
WEB_URL=https://your-domain.vercel.app
```

Redeploy Render, then redeploy Vercel. Test login, a state-changing request
(which confirms CORS and CSRF), file upload, and a password-reset email.

## Deployment checks

Before pushing, run these commands at the repository root:

```bash
npm ci --include=dev --ignore-scripts --workspace=campusos-frontend
npm run build --workspace=campusos-frontend
```

The Vercel build runs these same commands. The configuration uses the canonical
workspace package name, `campusos-frontend`, and therefore remains stable if
the frontend directory is ever renamed.
