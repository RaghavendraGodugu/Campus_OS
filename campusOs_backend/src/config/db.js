/**
 * MongoDB connection management.
 *
 * Design constraint that shaped this module: **multi-document transactions are
 * avoided wherever a single-document operation will do**. Transactions require
 * a replica set; a local `mongod` is a standalone and rejects them outright.
 * Atomicity is therefore normally achieved with single-document operations
 * (`findOneAndUpdate`, `findOneAndDelete`) plus unique indexes, both of which
 * are atomic on every deployment topology. This keeps development, the in-memory
 * test database and production Atlas on identical code paths.
 *
 * There is exactly one transaction in the codebase — `academicTerm.open()`,
 * where closing the old term and opening the new one must not be observable
 * half-done. Every other invariant in this system is carried by a unique index
 * rather than by a transaction, which is the more portable of the two.
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

        const explained = explainDnsFailure(error, connectionString);
        if (explained) {
          logger.fatal({ message: explained }, "MongoDB connection failed");
        } else {
          logger.error(
            { err: error, message: error.message },
            "MongoDB connection failed"
          );
        }

        throw error;
      });
  }

  return connectPromise;
}

/**
 * Explain a DNS failure that is about this machine, not about MongoDB.
 *
 * A `mongodb+srv://` URI is resolved by `dns.resolveSrv`, which is backed by
 * c-ares. Some Node builds ship without it, and then *every* SRV lookup fails
 * with `EBADRESP` — including ones `dig` answers correctly. The connection
 * refused, Atlas is fine, and the error names a hostname nobody can do anything
 * about, so it reads like an outage at MongoDB.
 *
 * Saying so, and naming the fix, is the whole value here. Returns null for a
 * failure that is not this one.
 */
function explainDnsFailure(error, connectionString) {
  if (!String(connectionString).startsWith("mongodb+srv://")) return null;

  const code = error?.code ?? "";
  const message = String(error?.message ?? "");

  const srvLookupFailed =
    code === "EBADRESP" || code === "ESERVFAIL" || /querySrv|ENOTFOUND/i.test(message);

  // Only worth claiming when SRV really is the broken part here; a missing
  // atlas host is a different problem with a different fix.
  if (!srvLookupFailed) return null;
  if (process.versions.cares === undefined || process.versions.cares === null) {
    return (
      "This Node build cannot resolve DNS SRV records (it ships without c-ares), " +
      "so a mongodb+srv:// connection cannot work. MongoDB and Atlas are both " +
      "fine — this is local. Run `nvm use` from the repository root to switch to " +
      "the pinned version, then start again."
    );
  }

  return (
    "The SRV record for this MongoDB host could not be resolved from this " +
    "machine. Atlas may be unreachable from your network, or a DNS filter may be " +
    "rewriting the answer. `dig SRV <host>` will show what your resolver returns."
  );
}

/**
 * Reconcile a database's indexes with the schemas.
 *
 * `autoIndex` only *creates* what is missing. It never removes an index that a
 * schema no longer declares, so a schema correction does not reach an existing
 * database — and the stale index keeps enforcing the old rule.
 *
 * That is not hypothetical: several unique fields were originally declared
 * `unique: true, sparse: true` alongside `default: null`. Sparse skips documents
 * where a field is missing, not where it is null, so MongoDB indexed every
 * `null` and permitted exactly ONE document per collection. The schemas now use
 * a partial index over string values; without this, any database created before
 * that change would still refuse the second refund it ever received.
 *
 * `syncIndexes()` drops indexes not present in the schema, so it must never run
 * unattended in production: run `npm run migrate:indexes` as a deliberate step.
 */
async function syncIndexes({ force = false } = {}) {
  const env = getEnv();

  if (!force && env.NODE_ENV === "production") {
    logger.warn(
      "Index sync skipped in production. Run `npm run migrate:indexes` deliberately."
    );
    return { skipped: true };
  }

  // `modelNames()` is empty unless something has required the models. Loading
  // them here means this works no matter which entry point called it, rather
  // than silently doing nothing.
  require("../models");

  const models = mongoose.modelNames();
  const synced = [];

  for (const name of models) {
    const model = mongoose.model(name);

    try {
      // Declared indexes, keyed by their key paths. Mongoose 9 does not put a
      // name on the options returned by schema.indexes(), so the shape of the
      // key — not its generated name — is what a live index is matched on.
      const declared = model.schema.indexes().map(([keys, options]) => ({
        paths: keyPaths(keys),
        options,
      }));

      // Drop indexes the schema no longer declares.
      const dropped = await model.syncIndexes();

      // `syncIndexes()` only compares index NAMES. An index whose name is still
      // declared but whose definition changed — here, a unique index that
      // gained a partialFilterExpression — is left in place, so the old rule
      // keeps being enforced. Those have to be dropped and rebuilt by hand.
      const existing = await model.collection.indexes();
      const replaced = [];

      for (const index of existing) {
        const wanted = declared.find((d) => samePaths(d.paths, keyPaths(index.key)));
        if (!wanted) continue;

        if (indexBelongsToSchema(wanted.options, index)) continue;

        await model.collection.dropIndex(index.name);
        replaced.push(index.name);
      }

      if (replaced.length) {
        await model.syncIndexes();
      }

      if (dropped.length || replaced.length) {
        synced.push({ model: name, dropped, replaced });
      }
    } catch (error) {
      logger.error({ err: error, model: name }, "Index sync failed for model");
      throw error;
    }
  }

  if (synced.length) {
    logger.info({ synced }, "Replaced stale indexes with the current schema");
  } else {
    logger.info("Indexes already match the schemas.");
  }

  return { skipped: false, synced };
}

/**
 * Whether a live index already matches what the schema asks for.
 *
 * Compares only the properties that change enforcement: uniqueness and the
 * partial filter. MongoDB echoes key order back differently from how it was
 * written, so key shapes are deliberately not compared.
 */
/** The field paths an index covers, order-independent. */
function keyPaths(keys) {
  const flat = Array.isArray(keys) ? Object.assign({}, ...keys) : keys;
  return Object.keys(flat).sort().join(",");
}

function samePaths(a, b) {
  return a === b;
}

function indexBelongsToSchema(wanted, existing) {
  if (Boolean(wanted.unique) !== Boolean(existing.unique)) {
    return false;
  }

  const wantedPartial = wanted.partialFilterExpression;
  const existingPartial = existing.partialFilterExpression;

  if (!wantedPartial && !existingPartial) {
    return true;
  }
  if (!wantedPartial || !existingPartial) {
    return false;
  }

  return JSON.stringify(wantedPartial) === JSON.stringify(existingPartial);
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
  syncIndexes,
  // Exported for its own test: the whole value of this function is the wording,
  // and wording is the thing that goes stale unnoticed.
  explainDnsFailure,
  connectDB,
  disconnectDB,
  isDbConnected,
  registerConnectionListeners,
  BASE_OPTIONS,
};
