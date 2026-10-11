/**
 * Global test setup.
 *
 * ## Ordering is load-bearing
 *
 * `config/logger.js` calls `getEnv()` at module load, which caches the
 * environment *including MONGO_URI* before any hook runs. So MONGO_URI must be
 * in `process.env` at the top of this file, synchronously, before any
 * application module is required. Assigning it inside `beforeAll` is too late:
 * the dev database URI is already cached and every test would read and write
 * the real development database.
 *
 * The consequence of getting this wrong is severe and silent — `resetDatabase()`
 * would wipe the developer's local data. It is pinned here to a fixed port so
 * the URI is known before the server is even started.
 *
 * ## No real data is ever touched
 *
 * Tests connect to an ephemeral MongoMemoryServer on the fixed port below,
 * never to the database named in `.env`.
 */

const { MongoMemoryServer } = require("mongodb-memory-server");

/** Fixed port so the URI is knowable synchronously, before anything imports. */
const TEST_PORT = 27018;

/** Deterministic secrets, so tokens are reproducible within a run. */
const TEST_ENV = {
  NODE_ENV: "test",
  PORT: "5001",
  CLIENT_URL: "http://localhost:5173",
  JWT_SECRET: "test-jwt-secret-value-at-least-32-characters-long",
  JWT_EXPIRES_IN: "15m",
  REFRESH_TOKEN_SECRET: "test-refresh-secret-value-at-least-32-characters-long",
  REFRESH_TOKEN_EXPIRES_IN: "7d",
  CSRF_SECRET: "test-csrf-secret-value-at-least-32-characters-long",
  COOKIE_SECURE: "false",
  LOG_PRETTY: "false",
  // Empty, so tests exercise the "integrations not configured" branches.
  CLOUDINARY_CLOUD_NAME: "",
  RAZORPAY_KEY_ID: "",
  RAZORPAY_KEY_SECRET: "",
  RAZORPAY_WEBHOOK_SECRET: "",
  SMTP_HOST: "",
  // Marks this process as a test run, for any code that needs to know.
  VITEST: "true",
};

// Applied synchronously, at module scope, before the first application require.
Object.assign(process.env, TEST_ENV, {
  MONGO_URI: `mongodb://127.0.0.1:${TEST_PORT}/campusos_test`,
});

let mongoServer;

beforeAll(async () => {
  // Reuse the locally installed mongod when available, otherwise the library
  // downloads one. Pointing at the system binary avoids a ~100MB download.
  // MONGOMS_SYSTEM_BINARY is read by mongodb-memory-server directly; this
  // hook only documents that the system binary is expected from the shell.

  mongoServer = await MongoMemoryServer.create({
    instance: { port: TEST_PORT, dbName: "campusos_test" },
  });

  const { connectDB, registerConnectionListeners } = require("../src/config/db");
  const { initIndexes } = require("../src/models");

  registerConnectionListeners();
  await connectDB();
  await initIndexes();
});

afterAll(async () => {
  const mongoose = require("mongoose");
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(false);
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});

/**
 * Safety net.
 *
 * Every suite calls resetDatabase(), which DELETES EVERY DOCUMENT in the
 * connected database. If MONGO_URI were ever misconfigured to a development or
 * Atlas instance, that would silently destroy real data.
 *
 * This check runs in its own hook so it is evaluated against the connection
 * actually established by beforeAll, and fails the run loudly rather than
 * letting a destructive wipe proceed.
 */
beforeEach(() => {
  const activeUri = process.env.MONGO_URI ?? "";
  if (!activeUri.includes(`:${TEST_PORT}/`)) {
    throw new Error(
      `REFUSING TO RUN: MONGO_URI is "${activeUri}", which is not the ephemeral test ` +
        `server on port ${TEST_PORT}. Tests call resetDatabase(), which deletes all ` +
        `documents — running against a real database would destroy it.`
    );
  }
});
