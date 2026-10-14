# syntax=docker/dockerfile:1

# ===== build =====
# Dependencies first, in their own layer. Editing application code must not
# reinstall the world — that turns every deploy into a ten-minute cache miss.
FROM node:22-alpine AS deps

WORKDIR /app

COPY campusOs_backend/package.json campusOs_backend/package-lock.json* ./
# `npm ci` fails rather than guessing when the lockfile and the manifest
# disagree, which is exactly what should happen in a build.
RUN npm ci --omit=dev --ignore-scripts

# ===== runtime =====
FROM node:22-alpine AS runtime

# `tini` gives us a real init, so a container stop reaches Node and the graceful
# shutdown in server.js actually runs. Without it, SIGTERM is delivered to PID 1
# (which is Node) and the drain is skipped under load.
RUN apk add --no-cache tini

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY campusOs_backend/package.json ./
COPY campusOs_backend/src ./src
COPY campusOs_backend/scripts ./scripts

# Never root. A container escape should not start from uid 0.
USER node

EXPOSE 5050

# The orchestrator restarts on this, and it fails if the database is unreachable
# — a "healthy" API that cannot serve a request is not healthy, and reporting it
# as healthy is how an outage goes unnoticed for an hour.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5050)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]