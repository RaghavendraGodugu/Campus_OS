/**
 * Request engine HTTP tests.
 *
 * Covers the student-to-management path end to end (spec §5, Phase A item 7),
 * plus the authorization properties that the API surface must uphold:
 * scope-filtered listing, cross-student denial, CSRF, and rejection of
 * client-supplied status.
 */

const request = require("supertest");

const {
  getApp,
  resetDatabase,
  createDepartment,
  createUser,
  createStudent,
  createRequestType,
  createRequest,
  loginAs,
  expectError,
} = require("./helpers/factory");
// `loginAs` and `expectError` are used via the destructured helpers above.
const { ROLES, REQUEST_STATUS } = require("../src/config/constants");
const Request = require("../src/models/Request");
const Notification = require("../src/models/Notification");

beforeEach(resetDatabase);

/** POST helper that supplies the CSRF header a real client would send. */
function postAs(agent, csrf, path, body) {
  return agent.post(path).set("X-CSRF-Token", csrf).send(body);
}

/** A simple text field definition for catalogue entries. */
const textField = (name, label, required = true) => ({
  name,
  label,
  type: "TEXT",
  required,
});

describe("POST /api/v1/requests", () => {
  it("lets a student submit a request", async () => {
    const owner = await createStudent();
    const requestType = await createRequestType({
      department: owner.department,
      fields: [textField("purpose", "Purpose")],
    });
    const { agent, csrfToken } = await loginAs(owner.user);

    const res = await postAs(agent, csrfToken, "/api/v1/requests", {
      requestType: requestType._id.toString(),
      data: { purpose: "Applying for a bonafide certificate" },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.reference).toMatch(/^REQ-\d{4}-\d{6}$/);
    expect(res.body.data.status).toBe("SUBMITTED");
  });

  it("assigns a unique reference to concurrent submissions", async () => {
    const owner = await createStudent();
    const requestType = await createRequestType({ department: owner.department });
    const { agent, csrfToken } = await loginAs(owner.user);

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        postAs(agent, csrfToken, "/api/v1/requests", {
          requestType: requestType._id.toString(),
          data: {},
        })
      )
    );

    const references = responses.map((r) => r.body.data.reference);
    expect(new Set(references).size).toBe(8);
  });

  it("collapses a retried submission onto the original", async () => {
    const owner = await createStudent();
    const requestType = await createRequestType({ department: owner.department });
    const { agent, csrfToken } = await loginAs(owner.user);

    const payload = { requestType: requestType._id.toString(), data: {} };

    const first = await agent
      .post("/api/v1/requests")
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "retry-key-123")
      .send(payload);

    const second = await agent
      .post("/api/v1/requests")
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "retry-key-123")
      .send(payload);

    expect(first.status).toBe(201);
    // A client retrying a failed submit must not create two applications.
    expect(second.body.data.reference).toBe(first.body.data.reference);
  });

  it("rejects a staff account submitting as a student", async () => {
    const staff = await createUser({ role: ROLES.SUPPORT_STAFF });
    const requestType = await createRequestType();
    const { agent, csrfToken } = await loginAs(staff);

    const res = await postAs(agent, csrfToken, "/api/v1/requests", {
      requestType: requestType._id.toString(),
      data: {},
    });

    // Support staff hold no REQUEST_CREATE permission at all.
    expect([403]).toContain(res.status);
  });

  it("validates submitted data against the catalogue definition", async () => {
    const owner = await createStudent();
    const requestType = await createRequestType({
      department: owner.department,
      fields: [
        textField("purpose", "Purpose", true),
        {
          name: "copies",
          label: "Copies",
          type: "NUMBER",
          min: 1,
          max: 5,
          required: true,
        },
      ],
    });
    const { agent, csrfToken } = await loginAs(owner.user);

    const res = await postAs(agent, csrfToken, "/api/v1/requests", {
      requestType: requestType._id.toString(),
      data: { copies: 99 }, // purpose missing, copies out of range
    });

    expectError(res, 400, "VALIDATION_ERROR");
  });

  it("rejects fields the request type never declared", async () => {
    const owner = await createStudent();
    const requestType = await createRequestType({
      department: owner.department,
      fields: [textField("purpose", "Purpose")],
    });
    const { agent, csrfToken } = await loginAs(owner.user);

    const res = await postAs(agent, csrfToken, "/api/v1/requests", {
      requestType: requestType._id.toString(),
      data: { purpose: "ok", smuggled: "value" },
    });

    expectError(res, 400, "VALIDATION_ERROR");
    expect(JSON.stringify(res.body.details)).toContain("smuggled");
  });

  it("refuses a client-supplied status", async () => {
    const owner = await createStudent();
    const requestType = await createRequestType({ department: owner.department });
    const { agent, csrfToken } = await loginAs(owner.user);

    const res = await postAs(agent, csrfToken, "/api/v1/requests", {
      requestType: requestType._id.toString(),
      data: {},
      status: "COMPLETED", // must never be accepted
    });

    expectError(res, 400, "VALIDATION_ERROR");
    expect(JSON.stringify(res.body.details)).toContain("status");
  });

  it("rejects submission without a CSRF token", async () => {
    const owner = await createStudent();
    const requestType = await createRequestType({ department: owner.department });
    const { agent } = await loginAs(owner.user);

    const res = await agent.post("/api/v1/requests").send({
      requestType: requestType._id.toString(),
      data: {},
    });

    expectError(res, 403, "CSRF_INVALID");
  });

  it("404s for an unknown request type", async () => {
    const owner = await createStudent();
    const { agent, csrfToken } = await loginAs(owner.user);

    const res = await postAs(agent, csrfToken, "/api/v1/requests", {
      requestType: "507f1f77bcf86cd799439011",
      data: {},
    });

    expectError(res, 404, "NOT_FOUND");
  });
});

describe("GET /api/v1/requests", () => {
  it("returns only the caller's own requests to a student", async () => {
    const alice = await createStudent({ fullName: "Alice" });
    const bob = await createStudent({ fullName: "Bob" });
    await createRequest({ owner: alice, title: "Alice request" });
    await createRequest({ owner: bob, title: "Bob request" });

    const { agent } = await loginAs(alice.user);
    const res = await agent.get("/api/v1/requests");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("Alice request");
    expect(res.body.meta.total).toBe(1);
  });

  it("returns a department's requests to its HOD", async () => {
    const cse = await createDepartment({ name: "CSE" });
    const ece = await createDepartment({ name: "ECE" });

    const cseStudent = await createStudent({ department: cse });
    const eceStudent = await createStudent({ department: ece });

    await createRequest({
      owner: cseStudent,
      requestType: await createRequestType({ department: cse }),
    });
    await createRequest({
      owner: eceStudent,
      requestType: await createRequestType({ department: ece }),
    });

    const hod = await createUser({ role: ROLES.HOD, department: cse });
    const { agent } = await loginAs(hod);

    const res = await agent.get("/api/v1/requests");

    // Department scoping must exclude the other department entirely.
    expect(res.body.meta.total).toBe(1);
  });

  it("returns everything to an institution-scoped role", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    await createRequest({ owner: alice });
    await createRequest({ owner: bob });
    await createRequest({ owner: alice });

    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);

    const res = await agent.get("/api/v1/requests");
    expect(res.body.meta.total).toBe(3);
  });

  it("does not let a student widen scope with a department filter", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    await createRequest({ owner: alice });
    await createRequest({ owner: bob });

    const { agent } = await loginAs(alice.user);
    const res = await agent
      .get("/api/v1/requests")
      .query({ department: bob.department._id.toString() });

    // The filter is ignored for students; scope is enforced server-side.
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].student.toString()).toBe(alice.student._id.toString());
  });

  it("paginates", async () => {
    const alice = await createStudent();
    for (let i = 0; i < 5; i++) {
      await createRequest({ owner: alice, title: `Request ${i}` });
    }

    const { agent } = await loginAs(alice.user);
    const res = await agent.get("/api/v1/requests").query({ page: 1, limit: 2 });

    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({
      page: 1,
      limit: 2,
      total: 5,
      totalPages: 3,
      hasNext: true,
    });
  });

  it("rejects an invalid status filter", async () => {
    const alice = await createStudent();
    const { agent } = await loginAs(alice.user);

    const res = await agent.get("/api/v1/requests").query({ status: "NOT_A_STATUS" });
    expectError(res, 400, "VALIDATION_ERROR");
  });

  it("requires authentication", async () => {
    const res = await request(getApp()).get("/api/v1/requests");
    expectError(res, 401, "UNAUTHENTICATED");
  });
});

describe("GET /api/v1/requests/:id", () => {
  it("lets a student read their own request", async () => {
    const alice = await createStudent();
    const created = await createRequest({ owner: alice });

    const { agent } = await loginAs(alice.user);
    const res = await agent.get(`/api/v1/requests/${created._id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.reference).toBe(created.reference);
  });

  it("404s when a student reads another student's request", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    const alicesRequest = await createRequest({ owner: alice });

    const { agent } = await loginAs(bob.user);
    const res = await agent.get(`/api/v1/requests/${alicesRequest._id}`);

    // 404, not 403: the response must not confirm the request exists.
    expectError(res, 404, "NOT_FOUND");
  });

  it("404s rather than 403 so ids cannot be probed", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    const alicesRequest = await createRequest({ owner: alice });

    const { agent } = await loginAs(bob.user);
    const missing = await agent.get("/api/v1/requests/507f1f77bcf86cd799439011");

    expectError(missing, 404, "NOT_FOUND");

    const forbidden = await agent.get(`/api/v1/requests/${alicesRequest._id}`);
    expectError(forbidden, 404, "NOT_FOUND");

    // Identical response shape for both.
    expect(missing.body.code).toBe(forbidden.body.code);
    expect(missing.body.message).toBe(forbidden.body.message);
  });

  it("resolves a request by human-readable reference", async () => {
    const alice = await createStudent();
    const created = await createRequest({ owner: alice });

    const { agent } = await loginAs(alice.user);
    const res = await agent.get(`/api/v1/requests/${created.reference}`);

    expect(res.status).toBe(200);
  });

  it("never returns internal notes to a student", async () => {
    const alice = await createStudent();
    const department = await createDepartment();
    const created = await createRequest({
      owner: alice,
      requestType: await createRequestType({ department }),
    });

    await Request.updateOne(
      { _id: created._id },
      {
        $push: {
          internalNotes: {
            author: created.statusHistory[0].actor,
            body: "SECRET INTERNAL NOTE",
          },
        },
      }
    );

    const { agent } = await loginAs(alice.user);
    const res = await agent.get(`/api/v1/requests/${created._id}`);

    // The note must be stripped server-side, not merely hidden in the UI.
    expect(JSON.stringify(res.body)).not.toContain("SECRET INTERNAL NOTE");
  });

  it("returns internal notes to staff who may see them", async () => {
    const alice = await createStudent();
    const department = alice.department;
    const created = await createRequest({
      owner: alice,
      requestType: await createRequestType({ department }),
    });

    await Request.updateOne(
      { _id: created._id },
      {
        $push: {
          internalNotes: {
            author: created.statusHistory[0].actor,
            body: "Internal remark",
          },
        },
      }
    );

    // SUPPORT_STAFF is scoped to *assigned* requests only, by least privilege.
    // Assign it so the read is one the role genuinely holds.
    const support = await createUser({ role: ROLES.SUPPORT_STAFF, department });
    await Request.updateOne({ _id: created._id }, { $set: { assignedTo: support._id } });

    const { agent } = await loginAs(support);

    const res = await agent.get(`/api/v1/requests/${created._id}`);
    expect(JSON.stringify(res.body)).toContain("Internal remark");
  });

  it("reports only transitions the caller may actually perform", async () => {
    const alice = await createStudent();
    const created = await createRequest({
      owner: alice,
      status: REQUEST_STATUS.SUBMITTED,
    });

    const { agent } = await loginAs(alice.user);
    const res = await agent.get(`/api/v1/requests/${created._id}`);

    const targets = res.body.data.availableTransitions.map((t) => t.to);
    expect(targets).toContain("CANCELLED");
    // A student may not assign or approve.
    expect(targets).not.toContain("ASSIGNED");
    expect(targets).not.toContain("APPROVED");
  });
});

describe("POST /api/v1/requests/:id/transition", () => {
  it("drives a request through review to approval", async () => {
    const alice = await createStudent();
    const department = alice.department;
    const requestType = await createRequestType({ department });
    const support = await createUser({ role: ROLES.SUPPORT_STAFF, department });
    const hod = await createUser({ role: ROLES.HOD, department });
    const created = await createRequest({ owner: alice, requestType });

    // Assignment is an HOD capability; SUPPORT_STAFF cannot grant it to
    // themselves, so the HOD performs this step.
    const { agent: hodAgent, csrfToken: hodCsrf } = await loginAs(hod);
    await postAs(hodAgent, hodCsrf, `/api/v1/requests/${created._id}/assign`, {
      assignTo: support._id.toString(),
      expectedFrom: "SUBMITTED",
    });

    const { agent: staff, csrfToken } = await loginAs(support);

    await postAs(staff, csrfToken, `/api/v1/requests/${created._id}/transition`, {
      to: "UNDER_REVIEW",
      expectedFrom: "ASSIGNED",
    });

    await postAs(staff, csrfToken, `/api/v1/requests/${created._id}/transition`, {
      to: "APPROVAL_PENDING",
      expectedFrom: "UNDER_REVIEW",
    });

    const approved = await postAs(
      hodAgent,
      hodCsrf,
      `/api/v1/requests/${created._id}/transition`,
      {
        to: "APPROVED",
        expectedFrom: "APPROVAL_PENDING",
      }
    );

    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");
  });

  it("rejects an illegal transition with 422", async () => {
    const alice = await createStudent();
    const hod = await createUser({ role: ROLES.HOD, department: alice.department });
    const created = await createRequest({ owner: alice });

    const { agent, csrfToken } = await loginAs(hod);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/requests/${created._id}/transition`,
      {
        to: "COMPLETED",
        expectedFrom: "SUBMITTED",
      }
    );

    expectError(res, 422, "INVALID_TRANSITION");
    // The error lists what was actually permitted.
    expect(JSON.stringify(res.body.details)).toContain("ASSIGNED");
  });

  it("returns 409 when the status moved underneath the caller", async () => {
    const alice = await createStudent();
    const department = alice.department;
    const requestType = await createRequestType({ department });
    const support = await createUser({ role: ROLES.SUPPORT_STAFF, department });
    const hod = await createUser({ role: ROLES.HOD, department });
    const created = await createRequest({ owner: alice, requestType });

    // Assignment requires an HOD (or a principal), so the HOD drives both steps.
    const { agent: hodAgent, csrfToken: hodCsrf } = await loginAs(hod);

    await postAs(hodAgent, hodCsrf, `/api/v1/requests/${created._id}/assign`, {
      assignTo: support._id.toString(),
      expectedFrom: "SUBMITTED",
    });

    // Reusing the stale expectedFrom must be reported as a race.
    const res = await postAs(
      hodAgent,
      hodCsrf,
      `/api/v1/requests/${created._id}/assign`,
      {
        assignTo: support._id.toString(),
        expectedFrom: "SUBMITTED",
      }
    );

    expectError(res, 409, "CONFLICT");
  });

  it("rejects a transition with a stale expectedFrom from an unauthorised student", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    const created = await createRequest({ owner: alice });

    const { agent, csrfToken } = await loginAs(bob.user);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/requests/${created._id}/transition`,
      {
        to: "CANCELLED",
        expectedFrom: "SUBMITTED",
      }
    );

    // Bob has the permission but not the ownership: must not reveal existence.
    expectError(res, 404, "NOT_FOUND");
  });

  it("requires CSRF", async () => {
    const alice = await createStudent();
    const created = await createRequest({ owner: alice });
    const { agent } = await loginAs(alice.user);

    const res = await agent.post(`/api/v1/requests/${created._id}/transition`).send({
      to: "CANCELLED",
      expectedFrom: "SUBMITTED",
    });

    expectError(res, 403, "CSRF_INVALID");
  });

  it("notifies the student of a status change", async () => {
    const alice = await createStudent();
    const created = await createRequest({
      owner: alice,
      status: REQUEST_STATUS.SUBMITTED,
    });

    const { agent, csrfToken } = await loginAs(alice.user);
    await postAs(agent, csrfToken, `/api/v1/requests/${created._id}/transition`, {
      to: "CANCELLED",
      expectedFrom: "SUBMITTED",
    });

    const notifications = await Notification.find({ user: alice.user._id }).lean();
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].type).toBe("REQUEST_STATUS_CHANGED");
  });

  it("does not duplicate a notification when a transition is retried", async () => {
    const alice = await createStudent();
    const created = await createRequest({
      owner: alice,
      status: REQUEST_STATUS.SUBMITTED,
    });

    const { agent, csrfToken } = await loginAs(alice.user);
    await postAs(agent, csrfToken, `/api/v1/requests/${created._id}/transition`, {
      to: "CANCELLED",
      expectedFrom: "SUBMITTED",
    });

    // Re-notifying with the same dedupe key must be absorbed.
    const notificationService = require("../src/services/notification.service");
    await notificationService.notify({
      userId: alice.user._id,
      type: "REQUEST_STATUS_CHANGED",
      title: "duplicate",
      body: "duplicate",
      dedupeKey: `req:${created._id}:CANCELLED`,
    });

    const notifications = await Notification.find({
      user: alice.user._id,
      dedupeKey: `req:${created._id}:CANCELLED`,
    }).lean();

    expect(notifications).toHaveLength(1);
  });
});

describe("POST /api/v1/requests/:id/comments", () => {
  it("allows the owning student to comment", async () => {
    const alice = await createStudent();
    const created = await createRequest({ owner: alice });
    const { agent, csrfToken } = await loginAs(alice.user);

    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/requests/${created._id}/comments`,
      {
        body: "Is there anything else I need to submit?",
      }
    );

    expect(res.status).toBe(201);
  });

  it("does not allow a student to comment on another student's request", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    const created = await createRequest({ owner: alice });

    const { agent, csrfToken } = await loginAs(bob.user);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/requests/${created._id}/comments`,
      {
        body: "Intrusion attempt",
      }
    );

    expectError(res, 404, "NOT_FOUND");
  });
});

describe("POST /api/v1/requests/:id/internal-notes", () => {
  it("refuses a student adding an internal note", async () => {
    const alice = await createStudent();
    const created = await createRequest({ owner: alice });
    const { agent, csrfToken } = await loginAs(alice.user);

    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/requests/${created._id}/internal-notes`,
      {
        body: "Trying to write a note",
      }
    );

    expectError(res, 403, "FORBIDDEN");
  });

  it("allows staff to add an internal note", async () => {
    const alice = await createStudent();
    const department = alice.department;
    const requestType = await createRequestType({ department });
    const support = await createUser({ role: ROLES.SUPPORT_STAFF, department });
    const created = await createRequest({ owner: alice, requestType });
    // Support staff reach a request only once it is assigned to them.
    await Request.updateOne({ _id: created._id }, { $set: { assignedTo: support._id } });

    const { agent, csrfToken } = await loginAs(support);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/requests/${created._id}/internal-notes`,
      {
        body: "Awaiting registrar confirmation",
      }
    );

    expect(res.status).toBe(201);
  });
});

describe("request type catalogue", () => {
  it("lists active types for a student", async () => {
    const alice = await createStudent();
    const { agent } = await loginAs(alice.user);

    await createRequestType({
      department: alice.department,
      name: "Bonafide Certificate",
    });
    await createRequestType({ name: "Retired Service", isActive: false });

    const res = await agent.get("/api/v1/request-types");

    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.name)).toEqual(["Bonafide Certificate"]);
  });

  it("refuses catalogue creation to a student", async () => {
    const alice = await createStudent();
    const { agent, csrfToken } = await loginAs(alice.user);

    const res = await postAs(agent, csrfToken, "/api/v1/request-types", {
      name: "Self Service",
      code: "SELF",
      department: alice.department._id.toString(),
    });

    expectError(res, 403, "FORBIDDEN");
  });

  it("allows a super admin to add a catalogue entry", async () => {
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });
    const department = await createDepartment();
    const { agent, csrfToken } = await loginAs(admin);

    const res = await postAs(agent, csrfToken, "/api/v1/request-types", {
      name: "Bonafide Certificate",
      code: "BONAFIDE",
      department: department._id.toString(),
      fields: [{ name: "copies", label: "Copies", type: "NUMBER", required: true }],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe("BONAFIDE");
  });

  it("rejects a SELECT field with no options", async () => {
    const admin = await createUser({ role: ROLES.SUPER_ADMIN });
    const department = await createDepartment();
    const { agent, csrfToken } = await loginAs(admin);

    const res = await postAs(agent, csrfToken, "/api/v1/request-types", {
      name: "Broken Type",
      code: "BROKEN",
      department: department._id.toString(),
      fields: [{ name: "choice", label: "Choice", type: "SELECT" }],
    });

    // An empty option list would render an unusable form.
    expectError(res, 400, "VALIDATION_ERROR");
  });
});

describe("model registry", () => {
  it("registers every model referenced by a populate", async () => {
    // `.populate()` resolves references through Mongoose's model registry. A
    // model that no mounted route imported is missing from it, and populate
    // then throws MissingSchemaError at runtime — a 500 on an endpoint whose
    // tests passed, because the test app had loaded the model by a different
    // path. app.js requires the barrel for exactly this reason.
    const mongoose = require("mongoose");
    const registry = require("../src/models");

    // The models a populated request depends on.
    ["Department", "Program", "Student", "User", "RequestType"].forEach((name) => {
      expect(registry.models[name]).toBeDefined();
      expect(mongoose.models[name]).toBeDefined();
    });
  });

  it("populates a request without a missing-schema error", async () => {
    const alice = await createStudent();
    const requestType = await createRequestType({ department: alice.department });
    const created = await createRequest({ owner: alice, requestType });

    const { agent } = await loginAs(alice.user);
    const res = await agent.get(`/api/v1/requests/${created._id}`);

    // A 500 here means a referenced model was never registered.
    expect(res.status).toBe(200);
    expect(res.body.data.requestType).not.toBeNull();
    expect(res.body.data.department).not.toBeNull();
  });
});

describe("identifier resolution", () => {
  it("transitions a request addressed by reference, not just by id", async () => {
    // The SPA addresses requests by their human-readable reference, so the
    // workflow service must resolve that form. Passing a reference straight
    // into `_id` raises a CastError, which surfaces as a 500.
    const alice = await createStudent();
    const created = await createRequest({ owner: alice, status: "SUBMITTED" });

    const { agent, csrfToken } = await loginAs(alice.user);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/requests/${created.reference}/transition`,
      {
        to: "CANCELLED",
        expectedFrom: "SUBMITTED",
      }
    );

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
  });

  it("comments on a request addressed by reference", async () => {
    const alice = await createStudent();
    const created = await createRequest({ owner: alice });

    const { agent, csrfToken } = await loginAs(alice.user);
    const res = await postAs(
      agent,
      csrfToken,
      `/api/v1/requests/${created.reference}/comments`,
      {
        body: "Commenting via reference",
      }
    );

    expect(res.status).toBe(201);
  });

  it("404s for a reference that does not exist", async () => {
    const alice = await createStudent();
    const { agent, csrfToken } = await loginAs(alice.user);

    const res = await postAs(
      agent,
      csrfToken,
      "/api/v1/requests/REQ-1999-000001/transition",
      {
        to: "CANCELLED",
        expectedFrom: "SUBMITTED",
      }
    );

    expectError(res, 404, "NOT_FOUND");
  });
});
