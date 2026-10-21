/**
 * `npm run dev` must work even when the shell's Node cannot.
 *
 * A `mongodb+srv://` URI is resolved through c-ares inside Node. Some builds
 * ship without it — on this machine, `/usr/local/bin/node` — and every SRV
 * lookup then fails with EBADRESP, which looks exactly like MongoDB being
 * down and is nothing of the kind. Rather than demand a busy human notice the
 * difference, the launcher checks for the missing library and, absent, re-execs
 * under the version pinned in the repository's .nvmrc, which is known to work.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER_ARGS = ["--watch", "src/server.js"];

/** The absolute path of the Node binary the repository pins, if installed. */
function pinnedNode() {
  let raw;
  try {
    raw = fs.readFileSync(path.join(__dirname, "..", "..", ".nvmrc"), "utf8");
  } catch {
    return null;
  }
  const version = raw.trim();
  if (!/^v?\d+\.\d+\.\d+$/.test(version)) return null;
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  const candidate = path.join(nvmDir, "versions", "node", version, "bin", "node");
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Run the server under the given binary and exit hard when it does, so
 * `npm run dev` behaves like calling `node --watch src/server.js` directly.
 */
function run(nodeBin) {
  const { status } = spawnSync(nodeBin, SERVER_ARGS, { stdio: "inherit" });
  process.exit(status ?? 0);
}

// A Node with c-ares runs the server itself.
if (process.versions.cares !== undefined) run(process.execPath);

// Otherwise hand the job to the pinned build, which has the library.
const pinned = pinnedNode();
if (pinned) {
  run(pinned);
}

// No pinned build: say exactly what to install, because nothing can proceed.
process.stderr.write(
  `This Node build cannot resolve DNS SRV records (no c-ares), so the backend\n` +
    `cannot connect to Atlas through mongodb+srv://. Nothing here could start it.\n` +
    `Install the version the repository pins, from the repository root:\n\n` +
    `    nvm install "$(cat .nvmrc)" && nvm use\n\n` +
    `Then run this again.\n`
);
process.exit(1);
