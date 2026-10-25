/**
 * Scheduled penalty run.
 *
 * Finds every unpaid invoice that carries a penalty policy (rateBps > 0) and
 * applies the delta since the last run. The `chargePenalty` function already
 * computes the difference from `chargedAmount`, so re-running is safe — a
 * student is never charged twice for the same period of lateness.
 *
 * In production this is invoked by a scheduler (cron, Render Cron Job, a
 * systemd timer). It is safe to run repeatedly: the write filter requires
 * `chargedAmount < newAmount`, so concurrent or retried runs only apply the
 * difference.
 */

const Invoice = require("../models/Invoice");
const { chargePenalty } = require("../services/instalment.service");
const { logger } = require("../config/logger");
const auditService = require("../services/audit.service");
const { AUDIT_ACTION } = require("../config/constants");

/**
 * Run the penalty sweep once.
 *
 * @param {object} [options]
 * @param {Date} [options.now]      Injectable clock, for deterministic tests.
 * @param {boolean} [options.dryRun] Report what would happen without writing.
 * @returns {Promise<{scanned:number, updated:number, skipped:number, details:Array}>}
 */
async function runPenaltySweep({ now = new Date(), dryRun = false } = {}) {
  // Only unpaid invoices that actually have a penalty rate.
  const candidates = await Invoice.find({
    status: { $nin: ["PAID", "CANCELLED", "REFUNDED"] },
    "penalty.rateBps": { $gt: 0 },
    "penalty.chargedAmount": { $lt: 1e11 }, // sanity ceiling
  })
    .select(
      "_id reference total balanceDue dueAt penalty invoiceNumber student"
    )
    .limit(500)
    .lean();

  const result = { scanned: candidates.length, updated: 0, skipped: 0, details: [] };

  for (const invoice of candidates) {
    const calculation = chargePenalty(invoice, invoice.penalty, now);

    if (!calculation.eligible || calculation.charged <= 0) {
      result.skipped += 1;
      continue;
    }

    const newChargedAmount = (invoice.penalty.chargedAmount ?? 0) + calculation.charged;

    if (dryRun) {
      result.updated += 1;
      result.details.push({
        reference: invoice.reference,
        invoiceNumber: invoice.invoiceNumber,
        charged: calculation.charged,
        newChargedAmount,
        newBalance: calculation.newBalance,
      });
      continue;
    }

    // Atomic: match only while chargedAmount is still the old value.
    // If another run already applied a charge, the filter fails and we skip.
    const updated = await Invoice.findOneAndUpdate(
      {
        _id: invoice._id,
        "penalty.chargedAmount": invoice.penalty.chargedAmount,
        status: { $nin: ["PAID", "CANCELLED", "REFUNDED"] },
      },
      {
        $inc: {
          "penalty.chargedAmount": calculation.charged,
          balanceDue: calculation.charged,
          total: calculation.charged,
        },
        $set: { "penalty.chargedAt": now },
      },
      { new: true }
    );

    if (!updated) {
      // Another run won the race. Not an error — the sweep is idempotent.
      result.skipped += 1;
      continue;
    }

    result.updated += 1;
    result.details.push({
      reference: updated.reference,
      invoiceNumber: updated.invoiceNumber,
      charged: calculation.charged,
      newChargedAmount,
      newBalance: updated.balanceDue,
    });

    await auditService.record({
      action: AUDIT_ACTION.INVOICE_PENALTY_APPLIED,
      entity: "Invoice",
      entityId: updated._id,
      entityRef: updated.reference,
      metadata: {
        charged: calculation.charged,
        newChargedAmount,
        periods: calculation.calculation.periods,
        reason: calculation.calculation.reason,
      },
      req: null,
    });

    logger.info(
      { reference: updated.reference, charged: calculation.charged },
      "Penalty applied to overdue invoice"
    );
  }

  return result;
}

module.exports = {
  runPenaltySweep,
};
