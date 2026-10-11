/**
 * Workflow engine tests.
 *
 * The workflow table is the guarantee that status cannot be set arbitrarily
 * (spec §9). These tests assert the three ways that could fail:
 *
 *  1. an illegal edge is refused
 *  2. a legal edge is refused for an unauthorised actor
 *  3. two concurrent transitions cannot both win
 */

const {
  resetDatabase,
  createStudent,
  createUser,
  createRequestType,
  createRequest,
  createDepartment,
} = require("./helpers/factory");
const { ROLES, REQUEST_STATUS } = require("../src/config/constants");
const workflowService = require("../src/services/workflow.service");
const workflow = require("../src/utils/workflow");
const Request = require("../src/models/Request");

beforeEach(resetDatabase);

describe("workflow transition table", () => {
  it("allows the full happy path", async () => {
    const owner = await createStudent();
    const dept = await createDepartment();
    const requestType = await createRequestType({ department: dept });
    const support = await createUser({ role: ROLES.SUPPORT_STAFF, department: dept });
    const hod = await createUser({ role: ROLES.HOD, department: dept });

    const request = await createRequest({ owner, requestType });

    await workflowService.transition({
      requestId: request._id,
      to: REQUEST_STATUS.ASSIGNED,
      expectedFrom: REQUEST_STATUS.SUBMITTED,
      assignTo: support._id,
      user: hod,
    });
    await workflowService.transition({
      requestId: request._id,
      to: REQUEST_STATUS.UNDER_REVIEW,
      expectedFrom: REQUEST_STATUS.ASSIGNED,
      user: support,
    });
    await workflowService.transition({
      requestId: request._id,
      to: REQUEST_STATUS.APPROVAL_PENDING,
      expectedFrom: REQUEST_STATUS.UNDER_REVIEW,
      user: support,
    });
    await workflowService.transition({
      requestId: request._id,
      to: REQUEST_STATUS.APPROVED,
      expectedFrom: REQUEST_STATUS.APPROVAL_PENDING,
      user: hod,
    });
    await workflowService.transition({
      requestId: request._id,
      to: REQUEST_STATUS.PROCESSING,
      expectedFrom: REQUEST_STATUS.APPROVED,
      user: support,
    });
    const done = await workflowService.transition({
      requestId: request._id,
      to: REQUEST_STATUS.COMPLETED,
      expectedFrom: REQUEST_STATUS.PROCESSING,
      user: support,
      reason: "Certificate issued",
      resolution: "Bonafide certificate generated and made available.",
    });

    expect(done.status).toBe(REQUEST_STATUS.COMPLETED);
    expect(done.completedAt).toBeTruthy();
    expect(done.resolution).toContain("Bonafide");

    // History must record every step, in order.
    expect(done.statusHistory).toHaveLength(7);
    expect(done.statusHistory.map((h) => h.to)).toEqual([
      "SUBMITTED",
      "ASSIGNED",
      "UNDER_REVIEW",
      "APPROVAL_PENDING",
      "APPROVED",
      "PROCESSING",
      "COMPLETED",
    ]);
  });

  it("rejects an illegal transition", async () => {
    const owner = await createStudent();
    const request = await createRequest({ owner, status: REQUEST_STATUS.SUBMITTED });
    const hod = await createUser({ role: ROLES.HOD, department: request.department });

    await expect(
      workflowService.transition({
        requestId: request._id,
        to: REQUEST_STATUS.COMPLETED,
        expectedFrom: REQUEST_STATUS.SUBMITTED,
        user: hod,
      })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("rejects moving out of a terminal status", async () => {
    const owner = await createStudent();
    const request = await createRequest({ owner, status: REQUEST_STATUS.CANCELLED });
    const hod = await createUser({ role: ROLES.HOD, department: request.department });

    await expect(
      workflowService.transition({
        requestId: request._id,
        to: REQUEST_STATUS.UNDER_REVIEW,
        expectedFrom: REQUEST_STATUS.CANCELLED,
        user: hod,
      })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("rejects a legal transition performed by an unauthorised role", async () => {
    const owner = await createStudent();
    const dept = require("./helpers/factory").createDepartment;
    const department = await dept();
    const requestType = await createRequestType({ department });
    const support = await createUser({ role: ROLES.SUPPORT_STAFF, department });
    const request = await createRequest({
      owner,
      requestType,
      status: REQUEST_STATUS.APPROVAL_PENDING,
    });

    // Support staff may review, but must not approve.
    await expect(
      workflowService.transition({
        requestId: request._id,
        to: REQUEST_STATUS.APPROVED,
        expectedFrom: REQUEST_STATUS.APPROVAL_PENDING,
        user: support,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a student acting on another student's request", async () => {
    const alice = await createStudent({ fullName: "Alice" });
    const bob = await createStudent({ fullName: "Bob" });
    const request = await createRequest({ owner: alice });

    // Bob holds REQUEST_CANCEL_OWN, but the ownership filter excludes Alice's
    // request. This is the IDOR guard.
    await expect(
      workflowService.transition({
        requestId: request._id,
        to: REQUEST_STATUS.CANCELLED,
        expectedFrom: REQUEST_STATUS.SUBMITTED,
        user: bob.user,
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("requires a reason for rejection", async () => {
    const owner = await createStudent();
    const department = await createDepartment();
    const requestType = await createRequestType({ department });
    const support = await createUser({ role: ROLES.SUPPORT_STAFF, department });
    const hod = await createUser({ role: ROLES.HOD, department });
    const request = await createRequest({
      owner,
      requestType,
      status: REQUEST_STATUS.APPROVAL_PENDING,
      assignedTo: support._id,
    });

    await expect(
      workflowService.transition({
        requestId: request._id,
        to: REQUEST_STATUS.REJECTED,
        expectedFrom: REQUEST_STATUS.APPROVAL_PENDING,
        user: hod,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("requires a resolution summary to complete", async () => {
    const owner = await createStudent();
    const department = await createDepartment();
    const requestType = await createRequestType({ department });
    const support = await createUser({ role: ROLES.SUPPORT_STAFF, department });
    const request = await createRequest({
      owner,
      requestType,
      status: REQUEST_STATUS.PROCESSING,
      assignedTo: support._id,
    });

    await expect(
      workflowService.transition({
        requestId: request._id,
        to: REQUEST_STATUS.COMPLETED,
        expectedFrom: REQUEST_STATUS.PROCESSING,
        user: support,
        reason: "done",
        // resolution omitted
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("requires an assignee when moving to ASSIGNED", async () => {
    const owner = await createStudent();
    const department = await createDepartment();
    const requestType = await createRequestType({ department });
    const hod = await createUser({ role: ROLES.HOD, department });
    const request = await createRequest({ owner, requestType });

    await expect(
      workflowService.transition({
        requestId: request._id,
        to: REQUEST_STATUS.ASSIGNED,
        expectedFrom: REQUEST_STATUS.SUBMITTED,
        user: hod,
        // assignTo omitted
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("allows a student to cancel their own request", async () => {
    const owner = await createStudent();
    const request = await createRequest({ owner, status: REQUEST_STATUS.SUBMITTED });

    const cancelled = await workflowService.transition({
      requestId: request._id,
      to: REQUEST_STATUS.CANCELLED,
      expectedFrom: REQUEST_STATUS.SUBMITTED,
      user: owner.user,
    });

    expect(cancelled.status).toBe(REQUEST_STATUS.CANCELLED);
  });

  it("does not let a student move a request forward", async () => {
    const owner = await createStudent();
    const request = await createRequest({ owner, status: REQUEST_STATUS.ASSIGNED });

    // ASSIGNED -> UNDER_REVIEW requires a staff permission.
    await expect(
      workflowService.transition({
        requestId: request._id,
        to: REQUEST_STATUS.UNDER_REVIEW,
        expectedFrom: REQUEST_STATUS.ASSIGNED,
        user: owner.user,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("optimistic concurrency", () => {
  it("lets only one of two concurrent identical transitions succeed", async () => {
    const owner = await createStudent();
    const department = await createDepartment();
    const requestType = await createRequestType({ department });
    const support = await createUser({ role: ROLES.SUPPORT_STAFF, department });
    const request = await createRequest({
      owner,
      requestType,
      status: REQUEST_STATUS.ASSIGNED,
      assignedTo: support._id,
    });

    // Two attempts to start review on the same request at the same moment.
    const results = await Promise.allSettled([
      workflowService.transition({
        requestId: request._id,
        to: REQUEST_STATUS.UNDER_REVIEW,
        expectedFrom: REQUEST_STATUS.ASSIGNED,
        user: support,
      }),
      workflowService.transition({
        requestId: request._id,
        to: REQUEST_STATUS.UNDER_REVIEW,
        expectedFrom: REQUEST_STATUS.ASSIGNED,
        user: support,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one winner: the expected status is part of the atomic filter.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe("CONFLICT");

    // And history must contain the transition exactly once.
    const fresh = await Request.findById(request._id);
    const underReview = fresh.statusHistory.filter((h) => h.to === "UNDER_REVIEW");
    expect(underReview).toHaveLength(1);
  });

  it("reports a stale expectedFrom as a conflict", async () => {
    const owner = await createStudent();
    const department = await createDepartment();
    const requestType = await createRequestType({ department });
    const support = await createUser({ role: ROLES.SUPPORT_STAFF, department });
    const hod = await createUser({ role: ROLES.HOD, department });

    const request = await createRequest({ owner, requestType });

    await workflowService.transition({
      requestId: request._id,
      to: REQUEST_STATUS.ASSIGNED,
      expectedFrom: REQUEST_STATUS.SUBMITTED,
      assignTo: support._id,
      user: hod,
    });

    // A stale client still believes the request is SUBMITTED and tries to
    // assign it again. SUBMITTED -> ASSIGNED is a legal edge and the HOD holds
    // the permission, so this must surface as a race (409), not an
    // authorisation failure — which distinguishes it from the ownership case.
    await expect(
      workflowService.transition({
        requestId: request._id,
        to: REQUEST_STATUS.ASSIGNED,
        expectedFrom: REQUEST_STATUS.SUBMITTED,
        assignTo: support._id,
        user: hod,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("generates unique references under concurrent submission", async () => {
    const { counterKey, formatReference } = require("../src/models/Counter");
    const Counter = require("../src/models/Counter");

    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        Counter.findOneAndUpdate(
          { _id: counterKey("request", 2026) },
          { $inc: { seq: 1 } },
          { upsert: true, new: true }
        )
      )
    );

    const seqs = results.map((r) => r.seq);
    expect(new Set(seqs).size).toBe(30);

    const refs = seqs.map((s) => formatReference("REQ", 2026, s));
    expect(new Set(refs).size).toBe(30);
  });
});

describe("workflow introspection", () => {
  it("reports no transitions from a terminal status", () => {
    expect(workflow.transitionsFrom(REQUEST_STATUS.COMPLETED)).toEqual([]);
    expect(workflow.transitionsFrom(REQUEST_STATUS.REJECTED)).toEqual([]);
    expect(workflow.transitionsFrom(REQUEST_STATUS.CANCELLED)).toEqual([]);
  });

  it("filters history to student-visible steps", () => {
    const history = [
      { from: null, to: "SUBMITTED" },
      { from: "SUBMITTED", to: "ASSIGNED" },
      { from: "ASSIGNED", to: "UNDER_REVIEW" },
    ];

    const visible = workflow.studentVisibleHistory(history);
    expect(visible).toHaveLength(3);
  });

  it("provides a human-readable message per status", () => {
    Object.values(REQUEST_STATUS).forEach((status) => {
      expect(workflowService.statusMessage(status).length).toBeGreaterThan(0);
    });
  });
});
