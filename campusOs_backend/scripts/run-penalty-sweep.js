#!/usr/bin/env node
/**
 * Run the penalty sweep once, from the command line.
 *
 * In production this is invoked by a scheduler (cron, Render Cron Job, a
 * systemd timer). It is safe to run repeatedly: the sweep is idempotent, so a
 * retry after a crash charges nothing twice.
 */
const { connectDB, disconnectDB } = require("../src/config/db");
const { runPenaltySweep } = require("../src/jobs/penalty.job");

async function main() {
  await connectDB();
  const result = await runPenaltySweep();

  console.log("\n=== Penalty sweep ===");
  console.log(`  invoices scanned : ${result.scanned}`);
  console.log(`  penalties applied: ${result.updated}`);
  console.log(`  skipped          : ${result.skipped}`);

  if (result.details.length) {
    console.log("\n  applied:");
    result.details.forEach((d) =>
      console.log(
        `    ${d.reference} (${d.invoiceNumber}) +${d.charged} -> chargedAmount ${d.newChargedAmount}`
      )
    );
  }

  await disconnectDB();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(`\nPenalty sweep failed: ${error.message}\n`);
  try {
    await disconnectDB();
  } catch {
    /* already disconnected */
  }
  process.exit(1);
});
