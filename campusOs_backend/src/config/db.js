/**
 * MongoDB connection management.
 *
 * Design constraint that shaped this module: **no multi-document
 * transactions anywhere in slices 0-3**. Transactions require a replica set;
 * a local `mongod` is a standalone and rejects them outright. Atomicity is
 * therefore achieved with single-document operations (`findOneAndUpdate`,
 * `findOneAndDelete`) plus unique indexes, both of which are atomic on every
 * deployment topology. This keeps development, the in-memory test database and
 * production Atlas on identical code paths.
 */

const mongoose = require("mongoose");
const { getEnv } = require("./env");
const { logger } = require("./logger");

/**
 * Mongoose 9 / driver v7 connection options.
 *
 * Note: `strictQuery` is deliberately absent. It was removed as a *connection*
 * option in Mongoose 9 — passing it makes driver v7 throw
 * "option strictquery is not supported". Strict query casting is now applied
 * per schema instead; see `models/index.js` where `strictQuery: true` is set
 * on schemas that need it.
 */
const BASE_OPTIONS = {
  // Fail fast rather than buffering queries for 10s when the DB is unreachable.
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  autoIndex: true,
};

let connectPromise = null;

/**
 * Connect to MongoDB, once.
 *
 * Caches the in-flight promise so concurrent callers (a request arriving while
 * the process is booting, plus a script) share one connection attempt instead
 * of opening several.
 *
 * @param {string} [uri] Overrides MONGO_URI. Used by the test harness to point
 *   at an ephemeral in-memory server.
 */
async function connectDB(uri) {
  const env = getEnv();
  const connectionString = uri ?? env.MONGO_URI;

  if (!connectionString) {
    throw new Error(
      "Cannot connect: no MongoDB URI. Set MONGO_URI in campusOs_backend/.env."
    );
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectPromise) {
    connectPromise = mongoose
      .connect(connectionString, BASE_OPTIONS)
      .then((m) => {
        connectPromise = null;

        // Never log the URI — it embeds the database password.
        const host = m.connection.host;
        const dbName = m.connection.name;
        logger.info(
          { host, dbName },
          `MongoDB connected (${m.connection.readyState === 1 ? "open" : "?"})`
        );

        return m.connection;
      })
      .catch((error) => {
        connectPromise = null;
        logger.error({ err: error, message: error.message }, "MongoDB connection failed");
        throw error;
      });
  }

  return connectPromise;
}

/** Close the connection and reset state. Used by scripts and test teardown. */
async function disconnectDB() {
  connectPromise = null;
  if (mongoose.connection.readyState === 0) {
    return;
  }
  await mongoose.connection.close(false);
}

/**
 * True when the connection is usable.
 *
 * Note: readyState 1 is "connected". Because CampusOS issues no writes on
 * disconnected sockets (Mongoose buffers), health checks treat a non-ready
 * state as unhealthy rather than letting requests hang.
 */
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Register process-level connection listeners.
 *
 * `strict: false` is intentional for `disconnected`: buffering reconnects make
 * this fire routinely on Atlas failover and it is expected, not an emergency.
 */
function registerConnectionListeners() {
  const { connection } = mongoose;

  connection.on("connected", () => {
    logger.info("MongoDB connection established");
  });

  connection.on("error", (err) => {
    logger.error({ err, message: err.message }, "MongoDB connection error");
  });

  connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected — driver will attempt to reconnect");
  });

  connection.on("reconnected", () => {
    logger.info("MongoDB reconnected");
  });
}

module.exports = {
  connectDB,
  disconnectDB,
  isDbConnected,
  registerConnectionListeners,
  BASE_OPTIONS,
};
