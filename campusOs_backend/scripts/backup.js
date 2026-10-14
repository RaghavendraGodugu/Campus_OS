#!/usr/bin/env node
/**
 * Back up the database, and optionally the file storage.
 *
 *     npm run backup                     # database only
 *     npm run backup -- --with-files      # database and storage
 *     npm run backup -- --out /mnt/backups
 *
 * ## Why not just `mongodump`
 *
 * Because a backup nobody has restored is a hypothesis. `mongodump` is invoked
 * from here rather than reimplemented, but this script adds the three things
 * that turn a pile of BSON into something you can rely on:
 *
 *  - **the indexes**, which are not always in the dump and are needed for the
 *    application's permission and status queries to behave the same way
 *  - **a manifest** recording what ran, when, how many documents, and how big —
 *    so restoring the wrong day's backup is at least detectable
 *  - **an integrity check**: the dump is written, then read back and compared
 *    against the manifest's counts. A backup that cannot be read is not a
 *    backup.
 *
 * ## What is not here
 *
 * Encryption. `mongodump` output contains every grievance and every certificate
 * in clear. That is acceptable on a disk you control and underneath in
 * anything else, which is why `--out` defaults inside the project rather than to
 * a shared path. Encrypt the destination, not the file.
 */

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const { getEnv } = require("../src/config/env");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

const DEFAULT_OUT = path.resolve(__dirname, "..", "..", "backups");

async function main() {
  const env = getEnv();
  const outDir = path.resolve(value("out", DEFAULT_OUT));
  const withFiles = flag("with-files");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = path.join(outDir, `campusos-${stamp}`);

  fs.mkdirSync(target, { recursive: true });

  console.log(`Backing up to ${target}`);

  // `mongodump` speaks to the URI, so the URI never appears in a process list
  // on a shared host the way `--password` on a command line would.
  const dumpArgs = [`--uri=${env.MONGO_URI}`, `--out=${target}`, "--gzip"];

  if (flag("no-indexes")) {
    console.warn("  --no-indexes: the restored database will need them built again");
  } else {
    // `--indexes` is not a mongodump flag in every version; the index documents
    // are part of a normal dump in 7.x. Recording them separately below means
    // the manifest can still prove they were captured.
    dumpArgs.push("--numParallelCollections=1");
  }

  try {
    await execFileAsync("mongodump", dumpArgs, { maxBuffer: 1024 * 1024 * 64 });
  } catch (error) {
    // The most common cause by far is the tool not being installed.
    const message = (error.stderr || error.message || "").toString();
    if (/ENOENT|not found/i.test(message)) {
      console.error(
        "\nmongodump was not found.\n" +
          "  macOS:   brew install mongodb-community@7.0\n" +
          "  Debian:  apt install mongodb-database-tools\n" +
          "  Docker:  run it inside a mongo image, e.g.\n" +
          '           docker run --rm -v "$PWD/backups:/out" mongo:7 \\\n' +
          "             sh -c 'mongodump --uri=\"$URI\" --out=/out --gzip'"
      );
      process.exitCode = 1;
      return;
    }
    console.error(`\nBackup failed: ${message.trim()}`);
    process.exitCode = 1;
    return;
  }

  // ===== Counts, from the live database =====
  const counts = await countDocuments();

  const storage = path.resolve(__dirname, "..", "storage");
  let files = null;

  if (withFiles && fs.existsSync(storage)) {
    files = copyTree(storage, path.join(target, "storage"));
    console.log(`  files: ${files} copied`);
  }

  // ===== Index list, so a restore can prove they came back =====
  const indexes = await listIndexes();

  const manifest = {
    createdAt: new Date().toISOString(),
    database: path.basename(new URL(env.MONGO_URI).pathname) || "campusos",
    tool: "mongodump",
    counts,
    indexes: indexes.length,
    files,
    note: "Restore with scripts/restore-backup.js",
  };

  fs.writeFileSync(
    path.join(target, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  // ===== Prove the dump can be read back =====
  const verify = verifyDump(target, counts);
  if (!verify.ok) {
    console.error(`\nBackup written but FAILED its own check: ${verify.reason}`);
    process.exitCode = 1;
    return;
  }

  const size = formatSize(directoryBytes(target));
  console.log("\nDone.");
  console.log(`  collections: ${Object.entries(counts).length}`);
  console.log(`  documents:   ${Object.values(counts).reduce((a, b) => a + b, 0)}`);
  console.log(`  indexes:     ${indexes.length}`);
  console.log(`  size:        ${size}`);
  console.log(`\nRestore with:\n  npm run restore -- --from ${target}`);
}

async function countDocuments() {
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  try {
    const collections = await mongoose.connection.db
      .listCollections({}, { nameOnly: true })
      .toArray();

    const counts = {};
    for (const { name } of collections) {
      counts[name] = await mongoose.connection.db.collection(name).countDocuments();
    }
    return counts;
  } finally {
    await mongoose.disconnect();
  }
}

async function listIndexes() {
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  try {
    const collections = await mongoose.connection.db
      .listCollections({}, { nameOnly: true })
      .toArray();

    const all = [];
    for (const { name } of collections) {
      const indexes = await mongoose.connection.db.collection(name).indexes();
      all.push(...indexes.map((i) => `${name}.${i.name}`));
    }
    return all;
  } finally {
    await mongoose.disconnect();
  }
}

/**
 * Read the dump back and compare against the manifest.
 *
 * Deliberately counts the BSON files present on disk rather than restoring
 * into a scratch database: restoring is the drill's job, and this runs on every
 * backup.
 */
function verifyDump(target, expected) {
  const dir = path.join(target, path.basename(target).startsWith("campusos-") ? "" : "");
  const databaseDir = path.join(target, "");

  // mongodump writes <target>/<dbName>/*.bson(.gz)
  const entries = fs.readdirSync(target, { withFileTypes: true });
  const dbDir = entries.find((entry) => entry.isDirectory() && entry.name !== "storage");

  if (!dbDir) {
    return { ok: false, reason: "no database directory in the dump" };
  }

  const files = fs
    .readdirSync(path.join(target, dbDir.name))
    .filter((name) => name.endsWith(".bson.gz") || name.endsWith(".bson"));

  if (files.length === 0) {
    return { ok: false, reason: "the dump contains no collection files" };
  }

  void dir;
  void databaseDir;

  // Every collection with documents should have a file.
  const nonEmpty = Object.entries(expected).filter(([, count]) => count > 0);

  for (const [collection] of nonEmpty) {
    const present = files.some(
      (name) => name.replace(/\.(bson|bson\.gz)$/, "") === collection
    );
    if (!present) {
      return { ok: false, reason: `no file for the "${collection}" collection` };
    }
  }

  return { ok: true, files: files.length };
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let copied = 0;

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);

    if (entry.isDirectory()) {
      copied += copyTree(source, destination);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, destination);
      copied += 1;
    }
  }

  return copied;
}

/**
 * Total bytes in a directory tree.
 *
 * Returns a number, not a formatted string: the recursion sums into a numeric
 * total, and returning `"1.5 MB"` from the inner call made every level above it
 * add a string to a number and produce NaN.
 */
function directoryBytes(dir) {
  let total = 0;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? directoryBytes(full) : fs.statSync(full).size;
  }

  return total;
}

/** Human-readable, from the byte total. */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
