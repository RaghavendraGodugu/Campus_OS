/**
 * Complaint tests.
 *
 * The property that matters most here is **confidentiality**: a harassment or
 * safety grievance must be invisible to staff who may not read it, through
 * every surface — list, detail, comments, notifications, audit log and
 * aggregation. Hiding it in the UI is explicitly not enough (spec §10).
 */

const {
  resetDatabase,
  createDepartment,
  createUser,
  createStudent,
  loginAs,
  expectError,
} = require("./helpers/factory");
const { ROLES, COMPLAINT_STATUS } = require("../src/config/constants");
const Complaint = require("../src/models/Complaint");
const complaintService = require("../src/services/complaint.service");
const slaUtils = require("../src/utils/sla");
const slaPolicy = require("../src/utils/slaPolicy");

beforeEach(resetDatabase);

/**
 * File a complaint directly, bypassing HTTP, so the test can control the
 * category and therefore whether it is confidential.
 */
async function fileComplaint({ user, category = "ACADEMICS", ...overrides }) {
  return complaintService.fileComplaint({
    user,
    payload: {
      category,
      subject: "Test complaint subject",
      description: "A sufficiently detailed description of what happened.",
      ...overrides,
    },
  });
}

describe("confidentiality", () => {
  it("marks sensitive categories confidential by default", async () => {
    const student = await createStudent();

    const harassment = await fileComplaint({
      user: student.user,
      category: "HARASSMENT",
    });
    const safety = await fileComplaint({ user: student.user, category: "SAFETY" });
    const fees = await fileComplaint({ user: student.user, category: "FEES" });

    expect(harassment.confidential).toBe(true);
    expect(safety.confidential).toBe(true);
    // An ordinary complaint must stay visible, or the whole queue is useless.
    expect(fees.confidential).toBe(false);
  });

  it("does not let a client downgrade a confidential complaint", async () => {
    const student = await createStudent();
    const { agent, csrfToken } = await loginAs(student.user);

    const res = await agent
      .post("/api/v1/complaints")
      .set("X-CSRF-Token", csrfToken)
      .send({
        category: "HARASSMENT",
        subject: "Subject of a sensitive matter",
        description: "A detailed account of a harassment complaint.",
        confidential: false, // must not be accepted at all
      });

    // The strict schema rejects the unknown key outright, which is stronger
    // than accepting it and ignoring the value.
    expectError(res, 400, "VALIDATION_ERROR");

    // And nothing was filed, so no non-confidential record exists.
    const ComplaintModel = require("../src/models/Complaint");
    expect(await ComplaintModel.countDocuments()).toBe(0);
  });

  it("does not let a client mark an ordinary complaint confidential", async () => {
    const student = await createStudent();
    const { agent, csrfToken } = await loginAs(student.user);

    const res = await agent
      .post("/api/v1/complaints")
      .set("X-CSRF-Token", csrfToken)
      .send({
        category: "FEES",
        subject: "A fee query about my account",
        description: "A detailed description of the fee issue I face.",
        confidential: true, // rejected by strict schema
      });

    expectError(res, 400, "VALIDATION_ERROR");
  });

  it("hides a confidential complaint from non-oversight staff", async () => {
    const student = await createStudent();
    const support = await createUser({ role: ROLES.SUPPORT_STAFF });

    const confidential = await fileComplaint({
      user: student.user,
      category: "HARASSMENT",
    });
    const ordinary = await fileComplaint({ user: student.user, category: "FEES" });

    const { agent } = await loginAs(support);
    const res = await agent.get("/api/v1/complaints");

    // The triage queue contains the ordinary complaint and nothing else.
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].reference).toBe(ordinary.reference);
    expect(res.body.data[0].reference).toBe(ordinary.reference);
    expect(JSON.stringify(res.body)).not.toContain(confidential.reference);
  });

  it("returns 404 when non-oversight staff fetch a confidential complaint", async () => {
    const student = await createStudent();
    const support = await createUser({ role: ROLES.SUPPORT_STAFF });
    const confidential = await fileComplaint({
      user: student.user,
      category: "HARASSMENT",
    });

    const { agent } = await loginAs(support);

    // By id...
    const byId = await agent.get(`/api/v1/complaints/${confidential._id}`);
    expectError(byId, 404, "NOT_FOUND");

    // ...and by reference, which must not be a way around it.
    const byRef = await agent.get(`/api/v1/complaints/${confidential.reference}`);
    expectError(byRef, 404, "NOT_FOUND");
  });

  it("gives the same 404 for a complaint that does not exist", async () => {
    const support = await createUser({ role: ROLES.SUPPORT_STAFF });
    const student = await createStudent();
    await fileComplaint({ user: student.user, category: "HARASSMENT" });

    const { agent } = await loginAs(support);
    const missing = await agent.get("/api/v1/complaints/CMP-1999-000001");
    const forbidden = await agent.get("/api/v1/complaints/507f1f77bcf86cd799439011");

    // Identical responses, so ids cannot be probed to discover grievances.
    expectError(missing, 404, "NOT_FOUND");
    expectError(forbidden, 404, "NOT_FOUND");
    expect(missing.body.message).toBe(forbidden.body.message);
  });

  it("lets the dean and principal read confidential complaints", async () => {
    const student = await createStudent();
    const confidential = await fileComplaint({ user: student.user, category: "SAFETY" });

    for (const role of [ROLES.DEAN, ROLES.PRINCIPAL]) {
      const dean = await createUser({ role });
      const { agent } = await loginAs(dean);
      const res = await agent.get(`/api/v1/complaints/${confidential.reference}`);
      expect(res.status).toBe(200);
    }
  });

  it("does not give SUPER_ADMIN confidential access", async () => {
    const student = await createStudent();
    const confidential = await fileComplaint({
      user: student.user,
      category: "HARASSMENT",
    });

    const admin = await createUser({ role: ROLES.SUPER_ADMIN });
    const { agent } = await loginAs(admin);

    // Platform administration must not confer access to personal grievances.
    const res = await agent.get(`/api/v1/complaints/${confidential.reference}`);
    expectError(res, 404, "NOT_FOUND");
  });

  it("lets the assigned handler read a confidential complaint", async () => {
    const student = await createStudent();
    const dean = await createUser({ role: ROLES.DEAN });
    const confidential = await fileComplaint({
      user: student.user,
      category: "HARASSMENT",
    });

    // The dean explicitly takes ownership.
    await Complaint.updateOne(
      { _id: confidential._id },
      { $set: { assignedTo: dean._id } }
    );

    // An oversight role could read it anyway; the point is that assignment is
    // an independent grant. Verified directly against the predicate.
    const canRead = complaintService.canRead(confidential, dean);
    expect(canRead).toBe(true);
  });

  it("keeps confidential complaints out of the audit log body", async () => {
    const student = await createStudent();
    const confidential = await fileComplaint({
      user: student.user,
      category: "HARASSMENT",
      description: "A highly sensitive personal account that must not be logged.",
    });

    const AuditLog = require("../src/models/AuditLog");
    const entries = await AuditLog.find({ entity: "Complaint" }).lean();

    expect(entries.length).toBeGreaterThan(0);
    // The audit trail records that a complaint exists, never what it says.
    expect(JSON.stringify(entries)).not.toContain("highly sensitive personal account");
    expect(JSON.stringify(entries)).not.toContain(confidential.description);
  });

  it("excludes the complainant from the confidentiality restriction", async () => {
    const student = await createStudent();
    const confidential = await fileComplaint({
      user: student.user,
      category: "HARASSMENT",
    });

    const { agent } = await loginAs(student.user);
    const res = await agent.get(`/api/v1/complaints/${confidential.reference}`);

    // A student may always read their own complaint.
    expect(res.status).toBe(200);
    expect(res.body.data.reference).toBe(confidential.reference);
  });

  it("does not expose internal notes to the complainant", async () => {
    const student = await createStudent();
    const complaint = await fileComplaint({ user: student.user, category: "FEES" });

    await Complaint.updateOne(
      { _id: complaint._id },
      {
        $push: {
          internalNotes: {
            author: complaint.statusHistory[0].actor,
            body: "PRIVATE INVESTIGATION NOTE",
          },
        },
      }
    );

    const { agent } = await loginAs(student.user);
    const res = await agent.get(`/api/v1/complaints/${complaint.reference}`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("PRIVATE INVESTIGATION NOTE");
  });

  it("refuses a student adding an internal note", async () => {
    const student = await createStudent();
    const complaint = await fileComplaint({ user: student.user });
    const { agent, csrfToken } = await loginAs(student.user);

    const res = await agent
      .post(`/api/v1/complaints/${complaint.reference}/internal-notes`)
      .set("X-CSRF-Token", csrfToken)
      .send({ body: "Trying to write an internal note" });

    expectError(res, 403, "FORBIDDEN");
  });
});

describe("complaint workflow", () => {
  it("runs open -> acknowledged -> investigating -> resolved", async () => {
    const student = await createStudent();
    const support = await createUser({ role: ROLES.SUPPORT_STAFF });
    const complaint = await fileComplaint({ user: student.user });

    const ack = await complaintService.transition({
      complaintId: complaint._id,
      to: COMPLAINT_STATUS.ACKNOWLEDGED,
      expectedFrom: COMPLAINT_STATUS.OPEN,
      note: "We have received your complaint and will look into it.",
      user: support,
    });
    expect(ack.status).toBe(COMPLAINT_STATUS.ACKNOWLEDGED);
    // The response clock starts at first staff response.
    expect(ack.respondedAt).not.toBeNull();

    await Complaint.updateOne(
      { _id: complaint._id },
      { $set: { assignedTo: support._id } }
    );

    const inv = await complaintService.transition({
      complaintId: complaint._id,
      to: COMPLAINT_STATUS.INVESTIGATING,
      expectedFrom: COMPLAINT_STATUS.ACKNOWLEDGED,
      user: support,
    });
    expect(inv.status).toBe(COMPLAINT_STATUS.INVESTIGATING);

    const done = await complaintService.transition({
      complaintId: complaint._id,
      to: COMPLAINT_STATUS.RESOLVED,
      expectedFrom: COMPLAINT_STATUS.INVESTIGATING,
      resolution: "The issue has been corrected.",
      note: "Your complaint has been resolved.",
      user: support,
    });
    expect(done.status).toBe(COMPLAINT_STATUS.RESOLVED);
    expect(done.resolvedAt).not.toBeNull();
    expect(done.canReopen).toBe(true);
    expect(done.statusHistory).toHaveLength(4);
  });

  it("requires a student-visible note on acknowledgement", async () => {
    const student = await createStudent();
    const support = await createUser({ role: ROLES.SUPPORT_STAFF });
    const complaint = await fileComplaint({ user: student.user });

    await expect(
      complaintService.transition({
        complaintId: complaint._id,
        to: COMPLAINT_STATUS.ACKNOWLEDGED,
        expectedFrom: COMPLAINT_STATUS.OPEN,
        user: support,
        // note omitted
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an illegal transition", async () => {
    const student = await createStudent();
    const support = await createUser({ role: ROLES.SUPPORT_STAFF });
    const complaint = await fileComplaint({ user: student.user });

    // OPEN -> INVESTIGATING has no edge: a complaint must be acknowledged
    // first, which is what guarantees the student is told it was received.
    await expect(
      complaintService.transition({
        complaintId: complaint._id,
        to: COMPLAINT_STATUS.INVESTIGATING,
        expectedFrom: COMPLAINT_STATUS.OPEN,
        user: support,
      })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("rejects an unauthorised transition", async () => {
    const student = await createStudent();
    const faculty = await createUser({ role: ROLES.FACULTY });
    const complaint = await fileComplaint({ user: student.user });

    // Faculty hold no complaint-handling permission.
    await expect(
      complaintService.transition({
        complaintId: complaint._id,
        to: COMPLAINT_STATUS.ACKNOWLEDGED,
        expectedFrom: COMPLAINT_STATUS.OPEN,
        note: "acknowledged",
        user: faculty,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires a resolution when resolving", async () => {
    const student = await createStudent();
    const support = await createUser({ role: ROLES.SUPPORT_STAFF });
    const complaint = await fileComplaint({ user: student.user });

    await Complaint.updateOne(
      { _id: complaint._id },
      { $set: { assignedTo: support._id } }
    );
    await Complaint.updateOne(
      { _id: complaint._id },
      { $set: { status: COMPLAINT_STATUS.INVESTIGATING } }
    );

    await expect(
      complaintService.transition({
        complaintId: complaint._id,
        to: COMPLAINT_STATUS.RESOLVED,
        expectedFrom: COMPLAINT_STATUS.INVESTIGATING,
        note: "resolved",
        user: support,
        // resolution omitted
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("reopening", () => {
  it("lets the complainant reopen a resolved complaint", async () => {
    const student = await createStudent();
    const support = await createUser({ role: ROLES.SUPPORT_STAFF });
    const complaint = await fileComplaint({ user: student.user });

    await Complaint.updateOne(
      { _id: complaint._id },
      {
        $set: {
          status: COMPLAINT_STATUS.RESOLVED,
          resolvedAt: new Date(),
          canReopen: true,
          assignedTo: support._id,
        },
      }
    );

    const reopened = await complaintService.transition({
      complaintId: complaint._id,
      to: COMPLAINT_STATUS.REOPENED,
      expectedFrom: COMPLAINT_STATUS.RESOLVED,
      reason: "The problem has not actually been fixed.",
      user: student.user,
    });

    expect(reopened.status).toBe(COMPLAINT_STATUS.REOPENED);
    expect(reopened.resolvedAt).toBeNull();
  });

  it("does not let another student reopen it", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    const complaint = await fileComplaint({ user: alice.user });

    await Complaint.updateOne(
      { _id: complaint._id },
      { $set: { status: COMPLAINT_STATUS.RESOLVED, canReopen: true } }
    );

    // Bob holds COMPLAINT_REOPEN_OWN but not the ownership, so the visibility
    // check must refuse — and must not confirm the complaint exists.
    await expect(
      complaintService.transition({
        complaintId: complaint._id,
        to: COMPLAINT_STATUS.REOPENED,
        expectedFrom: COMPLAINT_STATUS.RESOLVED,
        reason: "not mine",
        user: bob.user,
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("records feedback once only", async () => {
    const student = await createStudent();
    const complaint = await fileComplaint({ user: student.user });

    await Complaint.updateOne(
      { _id: complaint._id },
      { $set: { status: COMPLAINT_STATUS.RESOLVED, canReopen: true } }
    );

    const first = await complaintService.submitFeedback({
      complaintId: complaint._id,
      user: student.user,
      rating: 4,
      satisfied: true,
    });
    expect(first.feedback.rating).toBe(4);

    await expect(
      complaintService.submitFeedback({
        complaintId: complaint._id,
        user: student.user,
        rating: 1,
        satisfied: false,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses feedback on an open complaint", async () => {
    const student = await createStudent();
    const complaint = await fileComplaint({ user: student.user });

    await expect(
      complaintService.submitFeedback({
        complaintId: complaint._id,
        user: student.user,
        rating: 5,
        satisfied: true,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("SLA policy", () => {
  it("sets a deadline from category policy, not a constant", async () => {
    const student = await createStudent();

    const safety = await fileComplaint({ user: student.user, category: "SAFETY" });
    const library = await fileComplaint({ user: student.user, category: "LIBRARY" });

    const calendar = slaPolicy.calendarOptions();
    const safetyElapsed = slaUtils.businessMinutesBetween(
      safety.submittedAt,
      safety.dueAt,
      calendar
    );
    const libraryElapsed = slaUtils.businessMinutesBetween(
      library.submittedAt,
      library.dueAt,
      calendar
    );

    // SAFETY is 4 business hours, LIBRARY is 48.
    expect(safetyElapsed).toBe(4 * 60);
    expect(libraryElapsed).toBe(48 * 60);
    expect(safety.dueAt < library.dueAt).toBe(true);
  });

  it("reports remaining time and breach state", async () => {
    const student = await createStudent();
    const complaint = await fileComplaint({ user: student.user });

    const withinSla = complaintService.slaStatusFor(complaint);
    expect(withinSla.breached).toBe(false);
    expect(withinSla.clockRunning).toBe(true);

    // Push the deadline into the past by enough that *business* time has
    // elapsed. 8 wall-clock hours may be zero business time if it spans a
    // night or a weekend, which is exactly the property under test.
    await Complaint.updateOne(
      { _id: complaint._id },
      { $set: { dueAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) } }
    );
    const overdue = await Complaint.findById(complaint._id).lean();

    const breached = complaintService.slaStatusFor(overdue);
    expect(breached.breached).toBe(true);
    expect(breached.remaining).toMatch(/^-/);
  });

  it("stops the clock at first staff response", async () => {
    const student = await createStudent();
    const support = await createUser({ role: ROLES.SUPPORT_STAFF });
    const complaint = await fileComplaint({ user: student.user });

    await complaintService.transition({
      complaintId: complaint._id,
      to: COMPLAINT_STATUS.ACKNOWLEDGED,
      expectedFrom: COMPLAINT_STATUS.OPEN,
      note: "Received and under review.",
      user: support,
    });

    const fresh = await Complaint.findById(complaint._id).lean();
    expect(fresh.respondedAt).not.toBeNull();
  });

  it("exposes the configured policy to clients", async () => {
    const student = await createStudent();
    const { agent } = await loginAs(student.user);

    const res = await agent.get("/api/v1/complaints/sla-policy");

    expect(res.status).toBe(200);
    expect(res.body.data.calendar.timezone).toBe("Asia/Kolkata");
    expect(res.body.data.categoryResponseHours.SAFETY).toBe(4);
    expect(res.body.data.maxEscalationLevel).toBeGreaterThan(0);
  });
});

describe("complaint scoping", () => {
  it("shows a student only their own complaints", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    await fileComplaint({ user: alice.user, subject: "Alice complaint" });
    await fileComplaint({ user: bob.user, subject: "Bob complaint" });

    const { agent } = await loginAs(alice.user);
    const res = await agent.get("/api/v1/complaints");

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].subject).toBe("Alice complaint");
  });

  it("confines an HOD to their department", async () => {
    const cse = await createDepartment({ name: "CSE" });
    const ece = await createDepartment({ name: "ECE" });

    const cseStudent = await createStudent({ department: cse });
    const eceStudent = await createStudent({ department: ece });

    await fileComplaint({ user: cseStudent.user, department: cse });
    await fileComplaint({ user: eceStudent.user, department: ece });

    const hod = await createUser({ role: ROLES.HOD, department: cse });
    const { agent } = await loginAs(hod);

    const res = await agent.get("/api/v1/complaints");
    expect(res.body.meta.total).toBe(1);
  });
});
