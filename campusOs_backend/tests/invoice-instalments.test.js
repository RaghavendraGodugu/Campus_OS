/**
 * Instalments and penalties — over HTTP and through the service.
 *
 * The arithmetic is covered in instalment.test.js. What matters here is the
 * refusals and the sweep, because those are the parts that touch money
 * somebody else owes.
 */

const {
  resetDatabase,
  createUser,
  createStudent,
  loginAs,
} = require("./helpers/factory");

const financeService = require("../src/services/finance.service");
const Invoice = require("../src/models/Invoice");
const AuditLog = require("../src/models/AuditLog");
const { INVOICE_STATUS } = require("../src/config/constants");

async function makeInvoice({
  total = 10000,
  balance = 10000,
  status = INVOICE_STATUS.ISSUED,
  dueAt = null,
} = {}) {
  const { student } = await createStudent();
  const admin = await createUser({ role: "SUPER_ADMIN" });

  return Invoice.create({
    reference: `INV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    student: student._id,
    items: [
      {
        description: "Tuition",
        quantity: 1,
        unitAmount: total,
        amount: total,
        taxAmount: 0,
        taxPercent: 0,
      },
    ],
    purpose: "Semester fee",
    subtotal: total,
    taxTotal: 0,
    total,
    paidAmount: total - balance,
    balanceDue: balance,
    status,
    dueAt: dueAt ?? new Date("2026-08-01T00:00:00.000Z"),
    issuedBy: admin._id,
  });
}

describe("instalment scheduling", () => {
  let admin;

  beforeEach(async () => {
    await resetDatabase();
    admin = await createUser({ role: "SUPER_ADMIN" });
  });

  it("splits an invoice into a schedule summing to its total", async () => {
    const invoice = await makeInvoice({ total: 10000, balance: 10000 });

    const schedule = await financeService.scheduleInstalments({
      user: admin,
      invoiceId: invoice._id,
      instalments: 3,
      firstDueAt: "2026-09-01",
    });

    expect(schedule).toHaveLength(3);
    expect(schedule.reduce((sum, entry) => sum + entry.amount, 0)).toBe(10000);
    expect(schedule.map((entry) => entry.outstanding)).toEqual([3333, 3333, 3334]);
  });

  /**
   * The refusal that matters.
   *
   * Splitting an invoice that has taken a payment means the schedule no longer
   * sums to what the student was told they owe — and the difference comes out
   * of their pocket, silently.
   */
  it("refuses to split an invoice that already has a payment against it", async () => {
    const invoice = await makeInvoice({ total: 10000, balance: 7000 });

    await expect(
      financeService.scheduleInstalments({
        user: admin,
        invoiceId: invoice._id,
        instalments: 3,
        firstDueAt: "2026-09-01",
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses to schedule twice", async () => {
    const invoice = await makeInvoice();
    await financeService.scheduleInstalments({
      user: admin,
      invoiceId: invoice._id,
      instalments: 2,
      firstDueAt: "2026-09-01",
    });

    await expect(
      financeService.scheduleInstalments({
        user: admin,
        invoiceId: invoice._id,
        instalments: 4,
        firstDueAt: "2026-10-01",
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses a cancelled invoice", async () => {
    const invoice = await makeInvoice({ status: INVOICE_STATUS.CANCELLED });
    await expect(
      financeService.scheduleInstalments({
        user: admin,
        invoiceId: invoice._id,
        instalments: 2,
        firstDueAt: "2026-09-01",
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("writes an audit line naming the invoice", async () => {
    const invoice = await makeInvoice();
    await financeService.scheduleInstalments({
      user: admin,
      invoiceId: invoice._id,
      instalments: 3,
      firstDueAt: "2026-09-01",
    });

    const entry = await AuditLog.findOne({ action: "INVOICE_SCHEDULED" }).lean();
    expect(entry).toBeTruthy();
    expect(entry.metadata.instalments).toBe(3);
  });

  it("reports a missing invoice as a 404", async () => {
    await expect(financeService.getSchedule({ invoiceId: "nope" })).rejects.toMatchObject(
      { statusCode: 404 }
    );
  });
});

describe("penalty sweep", () => {
  let admin;

  beforeEach(async () => {
    await resetDatabase();
    admin = await createUser({ role: "SUPER_ADMIN" });
  });

  it("writes nothing on a dry run", async () => {
    // A sweep that silently charges forty students should be opt-in, not the
    // default shape of the operation.
    const invoice = await makeInvoice();
    await financeService.setPenaltyPolicy({
      user: admin,
      invoiceId: invoice._id,
      policy: { rateBps: 100, periodDays: 30, graceDays: 0 },
    });

    const result = await financeService.sweepPenalties({ user: admin, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.charged.length).toBeGreaterThan(0);

    const stored = await Invoice.findById(invoice._id);
    expect(stored.total).toBe(10000);
    expect(stored.balanceDue).toBe(10000);
  });

  it("charges and marks the invoice overdue when not a dry run", async () => {
    const invoice = await makeInvoice();
    await financeService.setPenaltyPolicy({
      user: admin,
      invoiceId: invoice._id,
      policy: { rateBps: 100, periodDays: 30, graceDays: 0, capBps: 2000 },
    });

    const result = await financeService.sweepPenalties({ user: admin, dryRun: false });
    expect(result.charged.length).toBe(1);

    const stored = await Invoice.findById(invoice._id);
    expect(stored.status).toBe(INVOICE_STATUS.OVERDUE);
    expect(stored.balanceDue).toBeGreaterThan(10000);
    expect(stored.penalty.chargedAmount).toBeGreaterThan(0);
  });

  /**
   * The property the whole design exists for.
   *
   * Running the sweep repeatedly must cost one period's penalty, not one per
   * run — otherwise a job that runs hourly charges 24 months of interest on a
   * month of lateness.
   */
  it("is idempotent: a second sweep charges nothing further", async () => {
    const invoice = await makeInvoice();
    await financeService.setPenaltyPolicy({
      user: admin,
      invoiceId: invoice._id,
      policy: { rateBps: 100, periodDays: 30, graceDays: 0 },
    });

    const first = await financeService.sweepPenalties({ user: admin, dryRun: false });
    const second = await financeService.sweepPenalties({ user: admin, dryRun: false });

    expect(first.charged.length).toBe(1);
    expect(second.charged).toHaveLength(0);

    const stored = await Invoice.findById(invoice._id);
    expect(stored.penalty.chargedAmount).toBe(first.charged[0].amount);
  });

  it("skips an invoice with no policy and says why", async () => {
    await makeInvoice();

    const result = await financeService.sweepPenalties({ user: admin, dryRun: false });
    expect(result.charged).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/no penalty policy/i);
  });

  it("never charges a paid invoice", async () => {
    const invoice = await makeInvoice({
      total: 10000,
      balance: 0,
      status: INVOICE_STATUS.PAID,
    });
    await financeService.setPenaltyPolicy({
      user: admin,
      invoiceId: invoice._id,
      policy: { rateBps: 100 },
    });

    await financeService.sweepPenalties({ user: admin, dryRun: false });

    const stored = await Invoice.findById(invoice._id);
    expect(stored.total).toBe(10000);
  });

  it("records the sweep in the audit trail", async () => {
    await financeService.sweepPenalties({ user: admin, dryRun: true });

    const entry = await AuditLog.findOne({ action: "INVOICE_PENALTY_SWEEP" }).lean();
    expect(entry).toBeTruthy();
    expect(entry.metadata.dryRun).toBe(true);
  });
});

describe("permission boundary", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("refuses a student", async () => {
    const student = await createUser({ role: "STUDENT" });
    const { agent } = await loginAs(student);

    const response = await agent
      .post("/api/v1/invoices/penalty-sweep")
      .send({ dryRun: true });
    expect(response.status).toBe(403);
  });
});
