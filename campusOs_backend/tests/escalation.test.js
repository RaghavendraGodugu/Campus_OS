/**
 * SLA escalation sweep tests.
 *
 * The property that matters is **idempotency**: the spec (§10) requires that
 * duplicate escalation and duplicate notification jobs not occur where retries
 * happen. A scheduled job retries by definition — a crash, a redeploy, a manual
 * re-run — so these tests run the sweep repeatedly and assert nothing is
 * duplicated.
 */

const { resetDatabase, createStudent } = require("./helpers/factory");
const { ROLES, COMPLAINT_STATUS } = require("../src/config/constants");
const Complaint = require("../src/models/Complaint");
const Notification = require("../src/models/Notification");
const User = require("../src/models/User");
const { runEscalationSweep, escalationDedupeKey } = require("../src/jobs/escalation.job");
const slaPolicy = require("../src/utils/slaPolicy");

beforeEach(resetDatabase);

/**
 * Create an overdue complaint whose response clock is still running.
 *
 * A past `dueAt` alone is not enough: the sweep also requires `respondedAt` and
 * `resolvedAt` to be unset, which is what "nobody has dealt with it" means.
 */
async function createOverdueComplaint({
  user,
  category = "FEES",
  confidential = false,
  hoursOverdue = 6,
}) {
  return Complaint.create({
    reference: `CMP-2026-${Math.floor(Math.random() * 1e9)
      .toString()
      .padStart(6, "0")}`,
    student: user.student,
    subject: "Overdue complaint",
    description: "A sufficiently detailed description of the problem.",
    category,
    confidential,
    priority: "HIGH",
    status: COMPLAINT_STATUS.OPEN,
    dueAt: new Date(Date.now() - hoursOverdue * 60 * 60 * 1000),
    submittedAt: new Date(Date.now() - (hoursOverdue + 48) * 60 * 60 * 1000),
    statusHistory: [
      {
        from: null,
        to: COMPLAINT_STATUS.OPEN,
        actor: user._id,
        actorRole: ROLES.STUDENT,
        at: new Date(),
      },
    ],
  });
}

describe("escalation sweep", () => {
  it("escalates an overdue complaint", async () => {
    const student = await createStudent();
    await createOverdueComplaint({ user: student.user });

    const result = await runEscalationSweep();

    expect(result.scanned).toBe(1);
    expect(result.escalated).toBe(1);

    const complaint = await Complaint.findOne({}).lean();
    expect(complaint.escalationLevel).toBeGreaterThanOrEqual(1);
    expect(complaint.escalations).toHaveLength(1);
  });

  it("is idempotent across repeated runs", async () => {
    const student = await createStudent();
    const complaint = await createOverdueComplaint({ user: student.user });

    // Five consecutive runs, as a retrying scheduler would produce.
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await runEscalationSweep());
    }

    // Exactly one escalation happened in total.
    expect(results[0].escalated).toBe(1);
    expect(results.slice(1).every((r) => r.escalated === 0)).toBe(true);
    expect(results.slice(1).every((r) => r.skipped >= 1)).toBe(true);

    const fresh = await Complaint.findById(complaint._id).lean();
    expect(fresh.escalations).toHaveLength(1);
  });

  it("does not duplicate notifications on repeated runs", async () => {
    const student = await createStudent();
    // A long-overdue complaint reaches level 3, which notifies the dean.
    await createOverdueComplaint({ user: student.user, hoursOverdue: 48 });
    await User.create({
      email: `dean.${Date.now()}@test.local`,
      fullName: "Test Dean",
      role: ROLES.DEAN,
      passwordHash: "x".repeat(60),
    });

    for (let i = 0; i < 4; i++) {
      await runEscalationSweep();
    }

    const notifications = await Notification.find({ type: "COMPLAINT_ESCALATED" }).lean();
    const unique = new Set(notifications.map((n) => n.dedupeKey));

    // Each (complaint, level) pair appears at most once.
    expect(notifications.length).toBe(unique.size);
  });

  it("concurrent sweeps escalate only once", async () => {
    const student = await createStudent();
    await createOverdueComplaint({ user: student.user });

    // Three sweeps racing, as after a redeploy with overlapping timers.
    const results = await Promise.all([
      runEscalationSweep(),
      runEscalationSweep(),
      runEscalationSweep(),
    ]);

    const total = results.reduce((sum, r) => sum + r.escalated, 0);
    expect(total).toBe(1);

    const complaint = await Complaint.findOne({}).lean();
    expect(complaint.escalations).toHaveLength(1);
  });

  it("ignores complaints that are already answered", async () => {
    const student = await createStudent();
    await Complaint.create({
      reference: "CMP-2026-000901",
      student: student.student,
      subject: "Already answered",
      description: "A sufficiently detailed description.",
      category: "FEES",
      status: COMPLAINT_STATUS.ACKNOWLEDGED,
      respondedAt: new Date(),
      dueAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
      submittedAt: new Date(Date.now() - 96 * 60 * 60 * 1000),
    });

    const result = await runEscalationSweep();

    // The response clock stopped, so an overdue deadline must not escalate.
    expect(result.escalated).toBe(0);
  });

  it("ignores complaints inside their deadline", async () => {
    const student = await createStudent();
    await Complaint.create({
      reference: "CMP-2026-000902",
      student: student.student,
      subject: "Not yet overdue",
      description: "A sufficiently detailed description.",
      category: "FEES",
      status: COMPLAINT_STATUS.OPEN,
      dueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      submittedAt: new Date(),
    });

    const result = await runEscalationSweep();
    expect(result.escalated).toBe(0);
  });

  it("escalates further as the overdue time grows", async () => {
    const student = await createStudent();
    const mild = await createOverdueComplaint({ user: student.user, hoursOverdue: 2 });
    const severe = await createOverdueComplaint({ user: student.user, hoursOverdue: 72 });

    await runEscalationSweep();

    const mildAfter = await Complaint.findById(mild._id).lean();
    const severeAfter = await Complaint.findById(severe._id).lean();

    expect(mildAfter.escalationLevel).toBeGreaterThanOrEqual(1);
    expect(severeAfter.escalationLevel).toBeGreaterThan(mildAfter.escalationLevel);
  });

  it("never exceeds the configured maximum level", async () => {
    const student = await createStudent();
    const complaint = await createOverdueComplaint({
      user: student.user,
      hoursOverdue: 24 * 365,
    });

    for (let i = 0; i < 10; i++) {
      await runEscalationSweep();
    }

    const fresh = await Complaint.findById(complaint._id).lean();
    expect(fresh.escalationLevel).toBeLessThanOrEqual(slaPolicy.MAX_ESCALATION_LEVEL);
  });

  it("does not notify department roles about a confidential complaint", async () => {
    const student = await createStudent();
    await createOverdueComplaint({
      user: student.user,
      category: "HARASSMENT",
      confidential: true,
      hoursOverdue: 72,
    });

    // An HOD would normally be notified at level 2, but this complaint is
    // confidential and the HOD may not read it.
    await User.create({
      email: `hod.${Date.now()}@test.local`,
      fullName: "Test HOD",
      role: ROLES.HOD,
      passwordHash: "x".repeat(60),
    });
    await User.create({
      email: `dean2.${Date.now()}@test.local`,
      fullName: "Test Dean",
      role: ROLES.DEAN,
      passwordHash: "x".repeat(60),
    });

    await runEscalationSweep();

    const recipients = await Notification.find({ type: "COMPLAINT_ESCALATED" }).lean();
    const hod = await User.findOne({ role: ROLES.HOD }).lean();

    recipients.forEach((notification) => {
      expect(notification.user.toString()).not.toBe(hod._id.toString());
    });
  });

  it("does not put the complaint description in a notification", async () => {
    const student = await createStudent();
    await Complaint.create({
      reference: "CMP-2026-000903",
      student: student.student,
      subject: "Sensitive matter",
      description: "A HIGHLY SENSITIVE description that must not be disclosed.",
      category: "HARASSMENT",
      confidential: true,
      status: COMPLAINT_STATUS.OPEN,
      dueAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
      submittedAt: new Date(),
    });

    await User.create({
      email: `dean3.${Date.now()}@test.local`,
      fullName: "Test Dean",
      role: ROLES.DEAN,
      passwordHash: "x".repeat(60),
    });

    await runEscalationSweep();

    const notifications = await Notification.find({ type: "COMPLAINT_ESCALATED" }).lean();
    const asText = JSON.stringify(notifications);

    // The notification carries the reference and the delay, not the grievance.
    expect(asText).not.toContain("HIGHLY SENSITIVE");
  });

  it("supports a dry run without writing", async () => {
    const student = await createStudent();
    await createOverdueComplaint({ user: student.user });

    const result = await runEscalationSweep({ dryRun: true });

    expect(result.escalated).toBe(1);
    const complaint = await Complaint.findOne({}).lean();
    expect(complaint.escalations).toHaveLength(0);
  });

  it("produces a stable dedupe key per complaint and level", () => {
    const id = "507f1f77bcf86cd799439011";
    expect(escalationDedupeKey(id, 2)).toBe(escalationDedupeKey(id, 2));
    expect(escalationDedupeKey(id, 2)).not.toBe(escalationDedupeKey(id, 3));
    expect(escalationDedupeKey(id, 1)).not.toBe(
      escalationDedupeKey("507f1f77bcf86cd799439012", 1)
    );
  });
});
describe("escalation guard semantics", () => {
  it("escalates a complaint that has never been escalated before", async () => {
    // Regression guard for a silent MongoDB behaviour: `escalations:
    // {$not: {$elemMatch: ...}}` does not match a document whose array is
    // EMPTY, so the first escalation of every complaint matched nothing and the
    // sweep reported "skipped". The first escalation must work.
    const student = await createStudent();
    const complaint = await createOverdueComplaint({ user: student.user });

    expect(complaint.escalations).toHaveLength(0);

    await runEscalationSweep();

    const fresh = await Complaint.findById(complaint._id).lean();
    expect(fresh.escalations.length).toBeGreaterThanOrEqual(1);
    expect(fresh.escalationLevel).toBeGreaterThanOrEqual(1);
  });

  it("escalates progressively as the overdue business time grows", async () => {
    const student = await createStudent();

    // 2 wall-clock hours of delay is a small amount of *business* time.
    const mild = await createOverdueComplaint({ user: student.user, hoursOverdue: 2 });
    // 10 days crosses several nights and a weekend, so a lot of business time.
    const severe = await createOverdueComplaint({
      user: student.user,
      hoursOverdue: 10 * 24,
    });

    await runEscalationSweep();

    const mildAfter = await Complaint.findById(mild._id).lean();
    const severeAfter = await Complaint.findById(severe._id).lean();

    // Both are overdue, so both escalate; the more overdue one escalates
    // further along the ladder.
    expect(mildAfter.escalationLevel).toBeGreaterThanOrEqual(1);
    expect(severeAfter.escalationLevel).toBeGreaterThan(mildAfter.escalationLevel);
  });
});
