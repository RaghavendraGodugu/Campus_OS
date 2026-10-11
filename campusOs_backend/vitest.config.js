/**
 * Test configuration.
 *
 * Two settings carry most of the weight:
 *
 *  - `pool: "forks"` and `fileParallelism: false` run suites sequentially in
 *    separate processes. The auth suites share module-level state (the Mongoose
 *    connection and the env cache), so concurrent suites in one process would
 *    interfere. Correctness of the security tests matters more than speed.
 *
 *  - `setupFiles` loads tests/setup.js, which points MONGO_URI at an ephemeral
 *    in-memory server *before* config/env.js is first required. Tests therefore
 *    never touch a development or Atlas database.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.js"],
    include: ["tests/**/*.test.js"],
    // Long timeout: the first run downloads the MongoDB binary.
    testTimeout: 60000,
    hookTimeout: 120000,
    teardownTimeout: 30000,
    fileParallelism: false,
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.js"],
      exclude: ["src/server.js", "src/config/db.js"],
    },
  },
});
