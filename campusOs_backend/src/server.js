/**
 * HTTP server entry point.
 *
 * Responsibilities kept deliberately narrow: validate the environment, connect
 * to the database, start listening, and shut down gracefully. All application
 * wiring lives in `app.js` so the Express app can be constructed in tests
 * without opening a socket.
 */

const { createApp } = require("./app");
const { getEnv } = require("./config/env");
const { logger } = require("./config/logger");
const {
  connectDB,
  disconnectDB,
  registerConnectionListeners,
  syncIndexes,
} = require("./config/db");

/**
 * Boot sequence.
 * @param {object} [options]
 * @param {string} [options.mongoUri] Override for the database URI.
 */
async function startServer({ mongoUri } = {}) {
  // Validate configuration before anything else. A misconfigured deployment
  // must exit with a readable message, not a stack trace from deep in Mongoose.
  const env = getEnv();

  registerConnectionListeners();

  await connectDB(mongoUri);

  // Development and test only — `syncIndexes()` refuses to run in production.
  //
  // `autoIndex` creates missing indexes but never removes stale ones, so a
  // corrected index definition would otherwise never reach a database that
  // already exists. See the comment on syncIndexes() in config/db.js.
  await syncIndexes();

  const app = createApp();

  // Express 5 passes listen errors to the callback rather than throwing, so the
  // EADDRINUSE case must be handled here or the process exits silently.
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, environment: env.NODE_ENV },
      `CampusOS API listening on http://localhost:${env.PORT}`
    );
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      logger.error(
        { port: env.PORT },
        `Port ${env.PORT} is already in use. Stop the other process or set PORT in .env.`
      );
      process.exit(1);
    }
    logger.error({ err: error }, "HTTP server error");
    process.exit(1);
  });

  // ===== Graceful shutdown =====
  // Stop accepting connections, let in-flight requests finish, then close the
  // DB. Without this, a deploy can sever a request mid-write.
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down gracefully");

    // Force-exit if connections refuse to drain.
    const forceExit = setTimeout(() => {
      logger.error("Graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, 10000);
    forceExit.unref();

    server.close(async () => {
      try {
        await disconnectDB();
        logger.info("Shutdown complete");
        clearTimeout(forceExit);
        process.exit(0);
      } catch (err) {
        logger.error({ err }, "Error during shutdown");
        process.exit(1);
      }
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // An unhandled rejection means a promise failed with no handler. Log it and
  // shut down rather than continuing in an unknown state.
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "Unhandled promise rejection");
    shutdown("unhandledRejection");
  });

  return server;
}

// Only auto-start when executed directly, not when required by a test.
if (require.main === module) {
  startServer().catch((error) => {
    // The logger may itself be unusable if the environment is invalid, so
    // fall back to stderr for that specific case.
    try {
      const { logger: log } = require("./config/logger");
      log.fatal({ err: error }, "Failed to start CampusOS API");
    } catch {
      process.stderr.write(`Failed to start CampusOS API: ${error.message}\n`);
    }
    process.exit(1);
  });
}

module.exports = { startServer };
