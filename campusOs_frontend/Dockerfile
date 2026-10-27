# syntax=docker/dockerfile:1

# ===== build =====
# A build-time Vite app: the bundle is static files, and nothing at runtime
# needs Node. So the runtime image serves those files with nginx rather than
# carrying a second copy of node_modules for no reason.
#
# The root lockfile is used because this is an npm workspace. The frontend has
# no package-lock of its own, and `npm ci` must not be pointed at a missing file.
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY campusOs_backend/package.json ./campusOs_backend/package.json
COPY campusOs_frontend/package.json ./campusOs_frontend/package.json
RUN npm ci --ignore-scripts --workspace=campusos-frontend

COPY campusOs_frontend/ ./campusOs_frontend/
WORKDIR /app/campusOs_frontend

# The API origin is baked into the browser bundle and the CSP at build time.
# Pass `--build-arg VITE_API_URL=https://api.example.edu/api/v1` when the API is
# not behind the same origin as this container.
ARG VITE_API_URL=/api/v1
ARG VITE_RAZORPAY_KEY_ID=

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_RAZORPAY_KEY_ID=$VITE_RAZORPAY_KEY_ID
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
