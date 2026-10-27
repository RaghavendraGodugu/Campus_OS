# syntax=docker/dockerfile:1

# ===== build =====
# The repository is an npm workspace with one lockfile at the root. Copy both
# workspace manifests as well as the root lockfile so `npm ci` can resolve the
# backend workspace without inventing a second, drifting lockfile.
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY campusOs_backend/package.json ./campusOs_backend/package.json
COPY campusOs_frontend/package.json ./campusOs_frontend/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace=campusos-backend

# ===== runtime =====
FROM node:22-alpine AS runtime

# `tini` gives us a real init, so a container stop reaches Node and the graceful
# shutdown in server.js actually runs. Without it, SIGTERM is delivered to PID 1
# (which is Node) and the drain is skipped under load.
RUN apk add --no-cache tini

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5050

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY campusOs_backend/package.json ./campusOs_backend/package.json
COPY campusOs_backend/src ./campusOs_backend/src
COPY campusOs_backend/scripts ./campusOs_backend/scripts

# Run from the backend directory so scripts and the relative `.env` lookup match
# a normal checkout. Node still resolves dependencies from /app/node_modules.
WORKDIR /app/campusOs_backend

# Never root. A container escape should not start from uid 0.
USER node

EXPOSE 5050

# Readiness, not liveness: a process that cannot reach MongoDB must not be
# reported healthy to an orchestrator that will send it traffic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5050)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
