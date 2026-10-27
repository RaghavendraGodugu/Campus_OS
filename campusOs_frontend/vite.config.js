import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { cspPlugin, DEV_CSP } from "./build/csp.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The backend's port, read from its own .env.
 *
 * Hard-coding 5000 here means the two halves drift the moment PORT changes, and
 * the symptom is a 502 on every API call with the backend looking perfectly
 * healthy — the same class of failure as a base URL missing its version.
 *
 * Parsed rather than imported through dotenv so the frontend needs no extra
 * dependency for one line, and so a missing .env degrades to the documented
 * default instead of throwing at startup.
 */
function backendPort() {
  const envPath = resolve(here, "..", "campusOs_backend", ".env");

  try {
    const match = readFileSync(envPath, "utf8").match(
      /^\s*PORT\s*=\s*(\d+)\s*$/m,
    );
    if (match) return Number(match[1]);
  } catch {
    // No .env yet: fall through to the default.
  }

  return 5000;
}

const BACKEND = `http://localhost:${process.env.VITE_PROXY_TARGET_PORT ?? backendPort()}`;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // cspPlugin injects the strict production policy into the built HTML.
    cspPlugin(),
  ],
  server: {
    port: 5173,
    // Dev needs 'unsafe-inline' for Vite's Fast Refresh preamble; production
    // never sees it. See build/csp.js.
    headers: { "Content-Security-Policy": DEV_CSP },
    // Proxying keeps every call same-origin, so the session cookies keep their
    // strict SameSite defaults. A cross-origin API would force SameSite=None.
    proxy: {
      "/api": { target: BACKEND, changeOrigin: false },
      "/health": { target: BACKEND, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
    css: false,
  },
});
