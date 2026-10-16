/**
 * Instalments and late-payment penalties.
 *
 * ## Money is integer minor units, and never a float at any step
 *
 * Every amount is paise. `1000 / 3` is 333.33…, and storing that is how an
 * invoice ends up a paisa out from what the student was told. Everything here
 * rounds deliberately and the rounding is visible in the return value.
 *
 * ## The last instalment absorbs the remainder
 *
 * Splitting 1000 into three gives 333.33 × 3 = 999.99. The first two are
 * floored and the last takes exactly what is left, so the schedule sums to the
 * invoice total to the paisa. This is the one case where the "obvious" equal
 * split is wrong.
 *
 * ## Penalties are recomputed, never accumulated by adding
 *
 * A penalty is a function of how late the invoice is, so it is *calculated*
 * from the elapsed periods and the cap, not incremented each time a sweep runs.
 * A sweep that adds 1% today and another that adds 1% tomorrow would charge 2%
 * for one month of lateness.
 *
 * `chargedAmount` records what has already been taken, so the money is charged
 * once — the calculation may run as often as you like.
 *
 * ## The policy is snapshotted onto the invoice
 *
 * If the college raises its penalty rate next month, invoices issued this month
 * must still be governed by the terms that were on them when they were issued.
 * Looking the rate up at charge time means charging somebody a rate nobody told
 * them about.
 */

const { add, subtract, percentageOf, round } = require("../utils/money");

/** Basis points: 100 bps = 1%. */
const BPS_PERCENT = 100;
const DAYS_PER_YEAR = 365;

/**
 * Split an amount into n equal instalments that sum to it exactly.
 *
 * @param {number} total Minor units.
 * @param {number} count
 * @param {Date} firstDueAt
 * @param {{periodDays?: number}} [options]
 * @returns {Array<{sequence: number, amount: number, dueAt: Date}>}
 */
function buildSchedule(total, count, firstDueAt, { periodDays = 30 } = {}) {
  const base = Math.floor(total / count);
  const schedule = [];
  let allocated = 0;

  for (let index = 0; index < count; index += 1) {
    // The final instalment takes the remainder so the schedule sums exactly.
    const isLast = index === count - 1;
    const amount = isLast ? total - allocated : base;
    allocated += amount;

    const dueAt = new Date(firstDueAt);
    dueAt.setDate(dueAt.getDate() + index * periodDays);

    schedule.push({ sequence: index + 1, amount, dueAt });
  }

  return schedule;
}

/** Whole periods elapsed since `from`, never fractional. */
function elapsedPeriods(from, to, periodDays) {
  const days = Math.floor((to.getTime() - from.getTime()) / 86400000);
  if (days <= 0) return 0;
  return Math.floor(days / periodDays);
}

/**
 * What the penalty on an invoice would be right now.
 *
 * Pure: it reads the invoice and a clock, and writes nothing. `chargePenalty`
 * is the thing that persists the result.
 *
 * @param {object} invoice
 * @param {object} policy The invoice's snapshotted policy.
 * @param {Date} now
 * @returns {{eligible: boolean, reason: string|null, periods: number, amount: number, capped: boolean}}
 */
function calculatePenalty(invoice, policy, now = new Date()) {
  const { rateBps = 0, periodDays = 30, graceDays = 0, capBps = 0 } = policy ?? {};

  const due = invoice.dueAt ?? null;
  const balance = invoice.balanceDue ?? 0;

  /*
   * The penalty accrues on the *original* debt, never on a balance that
   * already includes previously charged penalties.
   *
   * Charging 1% of a growing balance means the second month's penalty is
   * 1% of (debt + last month's penalty), the third is 1% of that, and so on.
   * A student pays 1% a month and gets charged roughly 0.5% extra every month
   * forever — and, worse, the second run of the sweep charges something, so a
   * job that runs hourly multiplies.
   */
  const alreadyCharged = policy?.chargedAmount ?? 0;
  const principal = Math.max(0, subtract(invoice.total ?? balance, alreadyCharged));

  if (rateBps <= 0) {
    return {
      eligible: false,
      reason: "This invoice carries no penalty",
      periods: 0,
      amount: 0,
      capped: false,
    };
  }

  if (!due) {
    return {
      eligible: false,
      reason: "This invoice has no due date",
      periods: 0,
      amount: 0,
      capped: false,
    };
  }

  if (balance <= 0) {
    // Charging a penalty on a paid invoice is the single most damaging bug this
    // function could have, so it is checked before anything else.
    return {
      eligible: false,
      reason: "This invoice is already settled",
      periods: 0,
      amount: 0,
      capped: false,
    };
  }

  const graceEnds = new Date(due.getTime() + graceDays * 86400000);
  if (now < graceEnds) {
    return {
      eligible: false,
      reason: `Within the ${graceDays}-day grace period`,
      periods: 0,
      amount: 0,
      capped: false,
    };
  }

  // The clock starts after the grace period, not at the due date. Charging from
  // the due date would penalise the grace days twice.
  const chargeableFrom = new Date(graceEnds);
  const periods = elapsedPeriods(chargeableFrom, now, periodDays);

  if (periods < 1) {
    return {
      eligible: false,
      reason: "Not yet a whole period past the grace period",
      periods: 0,
      amount: 0,
      capped: false,
    };
  }

  /*
   * Compounded across the periods elapsed.
   *
   * The arithmetic is written out rather than delegated to `percentageOf`,
   * which takes a *percent* (18 for 18%). Passing it a growth fraction — 0.01
   * where it wanted 1 — silently charges one hundredth of the intended penalty,
   * which is the kind of error that looks like a plausible number on an invoice
   * rather than an obvious fault.
   */
  const perPeriodRate = rateBps / BPS_PERCENT; // 100 bps -> 1 (i.e. 1%)
  let growth = 1;
  for (let index = 0; index < periods; index += 1) {
    growth *= 1 + perPeriodRate / 100;
  }

  // Round once, at the end. Rounding each period and compounding the rounded
  // values drifts, and the drift is the student's money.
  let total = round(principal * (growth - 1));

  let capped = false;
  if (capBps > 0) {
    const cap = round(percentageOf(invoice.total ?? balance, capBps / BPS_PERCENT));
    if (total > cap) {
      total = cap;
      capped = true;
    }
  }

  // Never more than what is outstanding: a penalty larger than the debt is not a
  // penalty, and it would produce a negative balance.
  if (total > balance) total = balance;
  // And never more than the original debt, even on a schedule with no balance.
  if (total > principal) total = principal;

  return { eligible: true, reason: null, periods, amount: total, capped };
}

/**
 * Apply the penalty, charging only the difference from what has already been
 * taken.
 *
 * Recomputing and taking the delta means a sweep can run hourly, daily, or
 * twice in the same minute, and the student is charged once for one period of
 * lateness.
 *
 * @returns {{charged: number, calculation: object}}
 */
function chargePenalty(invoice, policy, now = new Date()) {
  const calculation = calculatePenalty(invoice, policy, now);
  const alreadyCharged = policy?.chargedAmount ?? 0;

  const delta = calculation.amount - alreadyCharged;
  if (!calculation.eligible || delta <= 0) {
    return { charged: 0, calculation: { ...calculation, alreadyCharged } };
  }

  const balance = add(invoice.balanceDue ?? 0, delta);
  const total = add(invoice.total ?? 0, delta);

  return {
    charged: delta,
    newBalance: balance,
    newTotal: total,
    calculation: { ...calculation, alreadyCharged },
  };
}

/**
 * Where a payment should land.
 *
 * Oldest due first. A payment that skips an overdue instalment and settles a
 * future one leaves the student penalised on money they have effectively paid.
 */
function allocatePayment(invoice, amount) {
  let remaining = amount;
  const allocations = [];

  const ordered = [...(invoice.instalments ?? [])].sort(
    (a, b) => new Date(a.dueAt) - new Date(b.dueAt)
  );

  for (const instalment of ordered) {
    if (remaining <= 0) break;
    const outstanding = Math.max(0, instalment.amount - (instalment.paidAmount ?? 0));
    if (outstanding === 0) continue;

    const applied = Math.min(outstanding, remaining);
    remaining -= applied;
    allocations.push({ sequence: instalment.sequence, amount: applied });
  }

  // Anything left over is not an instalment payment — it simply reduces the
  // invoice balance, which matters for an invoice with no schedule at all.
  return { allocations, unallocated: remaining };
}

/** A schedule with paid-ness derived on read. */
function presentInstalments(instalments) {
  return (instalments ?? []).map((instalment) => ({
    sequence: instalment.sequence,
    amount: instalment.amount,
    dueAt: instalment.dueAt,
    paidAmount: instalment.paidAmount ?? 0,
    outstanding: Math.max(0, instalment.amount - (instalment.paidAmount ?? 0)),
    isPaid: instalment.amount > 0 && (instalment.paidAmount ?? 0) >= instalment.amount,
  }));
}

module.exports = {
  buildSchedule,
  elapsedPeriods,
  calculatePenalty,
  chargePenalty,
  allocatePayment,
  presentInstalments,
  BPS_PERCENT,
  DAYS_PER_YEAR,
};
