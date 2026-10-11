#!/usr/bin/env node
/**
 * Run the SLA escalation sweep once, from the command line.
 *
 * In production this is invoked by a scheduler (cron, Render Cron Job, a
 * systemd timer). It is safe to run repeatedly: the sweep is idempotent, so a
 * retry after a crash escalates nothing twice.
 */
const { connectDB, disconnectDB } = require("../src/config/db");
const { runEscalationSweep, freezeBreaches } = require("../src/jobs/escalation.job");

async function main() {
  await connectDB();
  const frozen = await freezeBreaches();
  const result = await runEscalationSweep();

  console.log("\n=== SLA escalation sweep ===");
  console.log(`  overdue candidates : ${result.scanned}`);
  console.log(`  newly escalated    : ${result.escalated}`);
  console.log(`  already handled    : ${result.skipped}`);
  console.log(`  breaches frozen    : ${frozen}`);

  if (result.breaches.length) {
    console.log("\n  escalated:");
    result.breaches.forEach((b) =>
      console.log(
        `    ${b.reference} -> level ${b.level} (${b.overdueBusinessMinutes} business min overdue)`
      )
    );
  }

  await disconnectDB();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(`\nEscalation sweep failed: ${error.message}\n`);
  try {
    await disconnectDB();
  } catch {
    /* already disconnected */
  }
  process.exit(1);
});
