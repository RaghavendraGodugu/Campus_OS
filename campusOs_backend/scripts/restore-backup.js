#!/usr/bin/env node
/**
 * Restore a backup, and prove it restored.
 *
 *     npm run restore -- --from backups/campusos-2026-10-14-09-15-00
 *     npm run restore -- --from ... --drill          # restore to a scratch DB
 *     npm run restore -- --from ... --confirm         # overwrite the real one
 *
 * ## Why a drill mode exists
 *
 * A backup that has never been restored is a claim, not a fact. `--drill`
 * restores into a throwaway database, checks the document counts and indexes
 * against the manifest, and drops it again — so "we have backups" can be
 * replaced by "we restored the most recent one on Tuesday and it matched".
 *
 * ## Why `--confirm` is required to touch the real database
 *
 * Restoring over a live database destroys it. Not asking is how a well-meant
 * `npm run restore` deletes three years of grievances. The flag is the pause.
 */

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const { getEnv } = require("../src/config/env");

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
};
const flag = (name) => args.includes(`--${name}`);

const SCRATCH = "campusos_restore_drill";

async function main() {
  const from = value("from");

  if (!from) {
    console.error(
      "Usage:\n" +
        "  npm run restore -- --from <backup-dir> --drill\n" +
        "  npm run restore -- --from <backup-dir> --confirm"
    );
    process.exitCode = 1;
    return;
  }

  const dir = path.resolve(from);

  if (!fs.existsSync(dir)) {
    console.error(`No such backup: ${dir}`);
    process.exitCode = 1;
    return;
  }

  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(
      `That directory has no manifest.json, so it is not a CampusOS backup: ${dir}`
    );
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const drill = flag("drill");
  const confirmed = flag("confirm");

  if (!drill && !confirmed) {
    console.error(
      "Refusing to guess.\n" +
        "  --drill    restore into a throwaway database, check it, drop it\n" +
        "  --confirm  overwrite the configured database with this backup"
    );
    process.exitCode = 1;
    return;
  }

  const env = getEnv();
  const targetUri = drill ? withDatabase(env.MONGO_URI, SCRATCH) : env.MONGO_URI;

  if (!drill) {
    console.error(
      `\nThis will REPLACE the database in ${redact(env.MONGO_URI)}.\n` +
        "If that is what you meant, re-run with --confirm.\n"
    );
    process.exitCode = 1;
    return;
  }

  const sourceDatabase = manifest.database;

  console.log(`Restoring ${manifest.createdAt} into the scratch database…`);
  console.log(`  from:   ${dir}`);
  console.log(`  rename: ${sourceDatabase}.* -> ${SCRATCH}.*`);

  try {
    await execFileAsync(
      "mongorestore",
      [
        `--uri=${targetUri}`,
        /*
         * `--nsFrom`/`--nsTo`, not just `--uri`.
         *
         * A dump directory is named after the database it came from, and
         * mongorestore restores it *there* whatever `--uri` says. With `--drop`
         * alongside it, a drill that "succeeded" would have wiped the live
         * database and reported no error at all — the exact disaster this mode
         * exists to prevent. Mapping the namespaces makes the target
         * unambiguous.
         */
        `--nsFrom=${sourceDatabase}.*`,
        `--nsTo=${SCRATCH}.*`,
        "--drop",
        "--gzip",
        // The database subdirectory, not the backup root: given the parent,
        // mongorestore reports "don't know what to do with subdirectory" and
        // restores nothing while still exiting zero.
        path.join(dir, sourceDatabase),
      ],
      {
        maxBuffer: 1024 * 1024 * 64,
      }
    );
  } catch (error) {
    const message = (error.stderr || error.message || "").toString();

    if (/ENOENT|not found/i.test(message)) {
      console.error(
        "\nmongorestore was not found. It ships with the same tools as mongodump."
      );
      process.exitCode = 1;
      return;
    }

    console.error(`\nRestore failed: ${message.trim()}`);
    process.exitCode = 1;
    return;
  }

  // ===== Check it actually came back =====
  const mongoose = require("mongoose");
  await mongoose.connect(targetUri, { serverSelectionTimeoutMS: 15000 });

  const problems = [];
  // Declared out here and filled in inside the try, because the summary is
  // printed after the connection has been closed.
  let collections;
  let documents = 0;
  let indexes = 0;

  try {
    const list = await mongoose.connection.db
      .listCollections({}, { nameOnly: true })
      .toArray();
    collections = list.length;

    for (const { name } of list) {
      const count = await mongoose.connection.db.collection(name).countDocuments();
      documents += count;

      const expected = manifest.counts?.[name];
      // A collection absent from the manifest is one created after the backup,
      // which is expected in a drill database and not a failure.
      if (expected !== undefined && expected !== count) {
        problems.push(`${name}: expected ${expected} documents, found ${count}`);
      }

      indexes += (await mongoose.connection.db.collection(name).indexes()).length;
    }

    for (const name of Object.keys(manifest.counts ?? {})) {
      if (!list.some((c) => c.name === name)) {
        problems.push(`${name}: missing from the restored database`);
      }
    }
  } finally {
    await mongoose.disconnect();
  }

  // Phrased as what happened rather than as success: the counts below are what
  // decides whether the restore worked.
  console.log("\nRestore command finished. Checking it…");
  console.log(`  collections: ${collections}`);
  console.log(`  documents:   ${documents}`);
  console.log(`  indexes:     ${indexes}`);

  if (manifest.files) {
    console.log(
      `  files:       ${manifest.files} (restore these from ${path.join(dir, "storage")})`
    );
  }

  // Always drop the scratch database, even on failure — leaving it would mean
  // the next drill restores into a database that already has the old data.
  const mongoose2 = require("mongoose");
  await mongoose2.connect(targetUri, { serverSelectionTimeoutMS: 15000 });
  await mongoose2.connection.dropDatabase();
  await mongoose2.disconnect();
  console.log("\nScratch database dropped.");

  if (problems.length > 0) {
    console.error("\nThe restore did NOT match the manifest:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nThe backup restores correctly.");
}

/** Same URI, different database — the credentials and host are untouched. */
function withDatabase(uri, name) {
  const parsed = new URL(uri);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** Never print a password. */
function redact(uri) {
  try {
    const parsed = new URL(uri);
    if (parsed.password) parsed.password = "***";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "(unparseable URI)";
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
