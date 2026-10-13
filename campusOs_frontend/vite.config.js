import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { cspPlugin, DEV_CSP } from "./build/csp";

/**
 * The dev server proxies /api to the backend rather than calling it from a
 * different origin.
 *
 * This is not a convenience. Session and CSRF cookies are the entire auth
 * mechanism, and a cross-origin setup would make the browser treat them as
 * third-party: SameSite would have to be relaxed to None, which exposes the
 * session to cross-site request scenarios the same-origin design simply cannot
 * have. Proxying keeps everything first-party, so the cookies keep their strict
 * defaults.
 */
export default defineConfig({
  // cspPlugin injects the strict production policy into the built HTML.
  plugins: [react(), tailwindcss(), cspPlugin()],
  server: {
    port: 5173,
    // Dev needs 'unsafe-inline' for Vite's Fast Refresh preamble; production
    // never sees it. See build/csp.js.
    headers: { "Content-Security-Policy": DEV_CSP },
    proxy: {
      "/api": {
        target: process.env.VITE_PROXY_TARGET ?? "http://localhost:5000",
        changeOrigin: false,
      },
      "/health": {
        target: process.env.VITE_PROXY_TARGET ?? "http://localhost:5000",
        changeOrigin: false,
      },
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
