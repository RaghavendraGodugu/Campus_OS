#!/usr/bin/env node
/**
 * Reconcile a database's indexes with the current schemas.
 *
 * Run this deliberately after changing an index definition:
 *
 *     npm run migrate:indexes
 *
 * `autoIndex` only creates missing indexes, so a corrected schema never
 * reaches an existing database on its own. This drops the indexes the schemas
 * no longer declare and builds the ones they do.
 *
 * It is a blocking migration and is never run automatically in production,
 * because it drops indexes. Review the diff it prints before applying it.
 */

const readline = require("readline");

const { connectDB, disconnectDB, syncIndexes } = require("../src/config/db");
const { getEnv } = require("../src/config/env");
const { logger } = require("../src/config/logger");

async function main() {
  const force = process.argv.includes("--force") || process.argv.includes("--yes");
  const env = getEnv();

  logger.info({ db: env.MONGO_URI ? "(from MONGO_URI)" : "(none)" }, "Connecting");

  await connectDB();

  if (env.NODE_ENV === "production" && !force) {
    logger.warn(
      "This will run against a production database and DROP indexes that the schemas no longer declare. Re-run with --force to proceed."
    );
    process.exit(1);
  }

  if (!force && !process.stdin.isTTY) {
    logger.warn("Non-interactive: re-run with --force to confirm index changes.");
    process.exit(1);
  }

  if (!force) {
    const answer = await ask(
      `This will synchronise indexes on database "${mongoose_db_name()}". Continue? (yes/no) `
    );
    if (!/^y(es)?$/i.test(answer.trim())) {
      logger.info("Aborted. No changes were made.");
      await disconnectDB();
      process.exit(0);
    }
  }

  const result = await syncIndexes({ force: true });

  if (result.synced.length === 0) {
    logger.info("Indexes already match the schemas. Nothing to do.");
  } else {
    for (const { model, dropped } of result.synced) {
      logger.info({ model, dropped }, "Replaced stale indexes");
    }
  }

  await disconnectDB();
}

function mongoose_db_name() {
  return require("mongoose").connection.name;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, resolve));
}

main().catch(async (error) => {
  logger.error({ err: error, message: error.message }, "Index migration failed");
  await disconnectDB().catch(() => {});
  process.exit(1);
});
