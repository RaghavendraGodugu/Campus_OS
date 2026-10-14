# syntax=docker/dockerfile:1

# ===== build =====
# A build-time Vite app: the bundle is static files, and nothing at runtime
# needs Node. So the runtime image serves those files with nginx rather than
# carrying a second copy of node_modules for no reason.
FROM node:22-alpine AS build

WORKDIR /app

COPY campusOs_frontend/package.json campusOs_frontend/package-lock.json* ./
RUN npm ci --ignore-scripts

COPY campusOs_frontend/ ./

# The backend's port only matters for the dev proxy, so the build never reads a
# .env from the backend — which is exactly what should happen in a build that
# runs before any environment exists.
ENV VITE_SHOW_DEMO_BANNER=false
RUN npm run build

# ===== runtime =====
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY campusOs_frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]