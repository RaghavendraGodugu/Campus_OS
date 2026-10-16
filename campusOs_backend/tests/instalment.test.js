/**
 * Instalments and late-payment penalties.
 *
 * Two things are easy to get wrong here and neither shows up as an exception:
 * money in floats, and a penalty that compounds by being *added* rather than
 * recomputed. Both produce a plausible-looking number, which is worse than an
 * obvious fault.
 */

const {
  buildSchedule,
  calculatePenalty,
  chargePenalty,
  allocatePayment,
  presentInstalments,
  elapsedPeriods,
} = require("../src/services/instalment.service");

const DUE = new Date("2026-08-01T00:00:00.000Z");
const POLICY = { rateBps: 100, periodDays: 30, graceDays: 7, capBps: 2000 };
const at = (iso) => new Date(`${iso}T00:00:00.000Z`);

describe("instalment schedules", () => {
  /**
   * The one case where an equal split is wrong.
   *
   * 1000 / 3 is 333.33…, and three of those is 999.99 — a student short by a
   * paisa through no fault of their own.
   */
  it("sums to the total exactly, giving the remainder to the last one", () => {
    const schedule = buildSchedule(10000, 3, DUE);
    expect(schedule.reduce((sum, entry) => sum + entry.amount, 0)).toBe(10000);
    expect(schedule.map((entry) => entry.amount)).toEqual([3333, 3333, 3334]);
  });

  it("splits an amount that divides evenly into equal parts", () => {
    const schedule = buildSchedule(9000, 3, DUE);
    expect(schedule.map((entry) => entry.amount)).toEqual([3000, 3000, 3000]);
  });

  it("spaces due dates by the period", () => {
    const schedule = buildSchedule(9000, 3, DUE, { periodDays: 30 });
    expect(schedule[0].dueAt.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(schedule[1].dueAt.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(schedule[2].dueAt.toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("handles a single instalment, which is the whole amount", () => {
    const schedule = buildSchedule(5000, 1, DUE);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].amount).toBe(5000);
  });
});

describe("penalty calculation", () => {
  const invoice = { dueAt: DUE, balanceDue: 10000, total: 10000 };

  it("charges nothing before the due date", () => {
    const result = calculatePenalty(invoice, POLICY, at("2026-07-20"));
    expect(result.eligible).toBe(false);
    expect(result.amount).toBe(0);
  });

  it("charges nothing inside the grace period", () => {
    const result = calculatePenalty(invoice, POLICY, at("2026-08-05"));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/grace/i);
  });

  it("charges nothing until a whole period has passed after the grace", () => {
    // 15 days late, but the grace period is 7 and the period is 30 — so
    // charging here would be charging for 8 days.
    const result = calculatePenalty(invoice, POLICY, at("2026-08-16"));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/whole period/i);
  });

  it("charges one percent for one period past the grace", () => {
    // 1% of 10000 paise is 100 paise. The arithmetic is written out rather
    // than delegated to percentageOf, which takes a percent and silently
    // charges a hundredth of this if handed a fraction.
    const result = calculatePenalty(invoice, POLICY, at("2026-09-20"));
    expect(result.periods).toBe(1);
    expect(result.amount).toBe(100);
  });

  it("compounds across periods", () => {
    const one = calculatePenalty(invoice, POLICY, at("2026-09-20"));
    const two = calculatePenalty(invoice, POLICY, at("2026-10-25"));
    expect(two.periods).toBe(2);
    // 1.01² - 1 = 0.0201, so 201 paise.
    expect(two.amount).toBe(201);
    expect(two.amount).toBeGreaterThan(one.amount * 2 - 1);
  });

  it("never charges more than the cap", () => {
    // Ten years late: without a cap this would be ruinous, and a penalty larger
    // than the debt would produce a negative balance.
    const result = calculatePenalty(invoice, POLICY, at("2036-01-01"));
    expect(result.capped).toBe(true);
    expect(result.amount).toBe(2000); // 20% of 10000
  });

  /**
   * The most damaging bug this function could have.
   *
   * A penalty on a settled invoice charges a student money they do not owe, and
   * it is the kind of error that reaches a real person before anybody notices.
   */
  it("never charges a settled invoice", () => {
    const result = calculatePenalty(
      { ...invoice, balanceDue: 0 },
      POLICY,
      at("2029-01-01")
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/settled/i);
    expect(result.amount).toBe(0);
  });

  it("never charges more than the outstanding balance", () => {
    const result = calculatePenalty(
      { ...invoice, balanceDue: 50, total: 10000 },
      { ...POLICY, capBps: 0 },
      at("2030-01-01")
    );
    expect(result.amount).toBeLessThanOrEqual(50);
  });

  it("charges nothing when the invoice carries no penalty policy", () => {
    const result = calculatePenalty(invoice, { rateBps: 0 }, at("2030-01-01"));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/no penalty/i);
  });

  it("charges nothing on an invoice with no due date", () => {
    const result = calculatePenalty(
      { ...invoice, dueAt: null },
      POLICY,
      at("2030-01-01")
    );
    expect(result.reason).toMatch(/no due date/i);
  });

  it("counts whole periods only", () => {
    expect(elapsedPeriods(DUE, at("2026-07-31"), 30)).toBe(0);
    expect(elapsedPeriods(DUE, at("2026-08-31"), 30)).toBe(1);
  });
});

describe("charging a penalty", () => {
  const invoice = { dueAt: DUE, balanceDue: 10000, total: 10000 };

  /**
   * A sweep can run hourly, daily, or twice in a minute. Recomputing and
   * charging only the difference is what makes one period of lateness cost one
   * period's penalty, however often the sweep runs.
   */
  it("charges only the difference from what has already been taken", () => {
    const policy = { ...POLICY, chargedAmount: 0 };

    const first = chargePenalty(invoice, policy, at("2026-10-25"));
    expect(first.charged).toBe(201);

    const second = chargePenalty(
      invoice,
      { ...policy, chargedAmount: 201 },
      at("2026-10-25")
    );
    expect(second.charged).toBe(0);
  });

  /**
   * The penalty accrues on the original debt, so the total is slightly *less*
   * than 201 once 100 has already been taken.
   *
   * 9900 × 2.01% = 198.99 → 199, less the 100 already charged is 99. Charging
   * the increase on a balance that already includes last month's penalty would
   * make a student pay 1% a month and roughly 0.5% extra every month forever.
   */
  it("charges only the increase, measured against the original debt", () => {
    const policy = { ...POLICY, chargedAmount: 100 };
    const result = chargePenalty(invoice, policy, at("2026-10-25"));
    expect(result.charged).toBe(99);
  });

  it("does not compound on its own penalties", () => {
    const fresh = calculatePenalty(invoice, POLICY, at("2026-10-25"));
    const afterOne = calculatePenalty(
      invoice,
      { ...POLICY, chargedAmount: 100 },
      at("2026-10-25")
    );
    // The second calculation is against 9900, not 10100.
    expect(afterOne.amount).toBeLessThan(fresh.amount);
  });

  it("adds the penalty to both the balance and the total", () => {
    const result = chargePenalty(
      invoice,
      { ...POLICY, chargedAmount: 0 },
      at("2026-09-20")
    );
    expect(result.newBalance).toBe(10100);
    expect(result.newTotal).toBe(10100);
  });
});

describe("allocating a payment", () => {
  const schedule = buildSchedule(10000, 3, DUE);

  it("lands on the oldest instalment first", () => {
    // A payment that skips an overdue instalment and settles a future one
    // leaves the student penalised on money they have effectively paid.
    const result = allocatePayment(
      { instalments: schedule.map((entry) => ({ ...entry, paidAmount: 0 })) },
      5000
    );

    expect(result.allocations).toEqual([
      { sequence: 1, amount: 3333 },
      { sequence: 2, amount: 1667 },
    ]);
  });

  it("skips an instalment that is already settled", () => {
    const result = allocatePayment(
      {
        instalments: schedule.map((entry, index) => ({
          ...entry,
          paidAmount: index === 0 ? entry.amount : 0,
        })),
      },
      1000
    );

    expect(result.allocations[0]).toEqual({ sequence: 2, amount: 1000 });
  });

  it("reports what could not be allocated to a schedule", () => {
    const result = allocatePayment(
      { instalments: schedule.map((entry) => ({ ...entry, paidAmount: entry.amount })) },
      1000
    );
    // Everything is already paid, so this simply reduces the balance.
    expect(result.allocations).toHaveLength(0);
    expect(result.unallocated).toBe(1000);
  });

  it("handles an invoice with no schedule at all", () => {
    const result = allocatePayment({ instalments: [] }, 2500);
    expect(result.unallocated).toBe(2500);
  });
});

describe("presenting a schedule", () => {
  it("derives paid-ness from the amounts rather than storing it", () => {
    // A stored flag can disagree with paidAmount the first time a payment lands
    // against it, and there is then no way to tell which is right.
    const shown = presentInstalments([
      { sequence: 1, amount: 1000, dueAt: DUE, paidAmount: 1000 },
      { sequence: 2, amount: 1000, dueAt: DUE, paidAmount: 400 },
      { sequence: 3, amount: 1000, dueAt: DUE, paidAmount: 0 },
    ]);

    expect(shown.map((entry) => entry.isPaid)).toEqual([true, false, false]);
    expect(shown.map((entry) => entry.outstanding)).toEqual([0, 600, 1000]);
  });

  it("handles an absent schedule", () => {
    expect(presentInstalments(undefined)).toEqual([]);
  });
});
