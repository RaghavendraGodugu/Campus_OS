/**
 * Seeded records must be openable.
 *
 * The seeder wrote references in its own shape (`DEMO-CMP-0001`) while every
 * identifier schema requires `[A-Z]+-\d{4}-\d{4,}`. Nothing rejected them at
 * write time: they listed perfectly and 400'd on open. Three of five requests
 * and all three complaints were unreachable, with no clue why.
 *
 * The general rule this encodes: demo data goes through the same generators the
 * application uses, so it exercises the real paths and cannot drift from the
 * validators. Found by clicking every seeded record in a browser, not by any
 * test — which is why it is pinned now.
 */

const path = require("path");

const IDENTIFIER = /^[A-Z]+-\d{4}-\d{4,}$/;

/**
 * Run the seeder against the ephemeral test database.
 *
 * Called once, in `beforeAll`. Seeding per test spawns a process that opens its
 * own connection to the same database the test is already reading, and the two
 * race each other's writes.
 */
async function seed() {
  const { execFile } = require("node:child_process");
  const { promisify } = require("node:util");
  const run = promisify(execFile);

  await run("node", [path.join(__dirname, "..", "scripts", "seed-demo.js"), "--force"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env },
    timeout: 180000,
  }).catch((e) => {
    // Surface the seeder's own message rather than a bare exit code.
    throw new Error(`seeder failed: ${String(e.stderr ?? e.message).slice(-500)}`);
  });
}

beforeAll(async () => {
  await seed();
}, 200000);

describe("seeded references", () => {
  it("uses the canonical format for every record type", async () => {
    const models = [
      ["requests", require("../src/models/Request")],
      ["complaints", require("../src/models/Complaint")],
      ["certificates", require("../src/models/Certificate")],
    ];

    for (const [label, Model] of models) {
      const records = await Model.find({}).select("reference").lean();
      expect(records.length).toBeGreaterThan(0);

      for (const record of records) {
        expect(
          record.reference,
          `${label} "${record.reference}" is not openable by reference`
        ).toMatch(IDENTIFIER);
      }
    }
  });

  it("leaves no record from a previous run behind", async () => {
    const Complaint = require("../src/models/Complaint");
    const before = await Complaint.countDocuments();

    // Re-seeding must be idempotent rather than cumulative.
    await seed();

    expect(await Complaint.countDocuments()).toBe(before);
  });

  it("produces references a real request could never collide with", async () => {
    const Request = require("../src/models/Request");
    const records = await Request.find({}).select("reference").lean();

    // Demo and production counters are separate, so the demo prefix has to
    // differ or both series emit REQ-2026-000001 and collide on a unique index.
    expect(records.every((r) => r.reference.startsWith("DM"))).toBe(true);
  });
});
