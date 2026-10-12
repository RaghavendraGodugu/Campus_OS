/**
 * Reports and the audit trail read-side.
 *
 * The permission is only the first gate. What matters is that holding a report
 * permission *narrows* a report rather than merely unlocking it, and that a
 * caller cannot widen their own scope by supplying a department parameter.
 *
 * The tests that carry the most weight are the negative ones: a department-scoped
 * viewer with no department set, and a viewer trying to name somebody else's
 * department. Both are cases where the obvious implementation returns everything.
 */

const {
  resetDatabase,
  createUser,
  createStudent,
  createDepartment,
  createProgram,
  loginAs,
  createRequest,
} = require("./helpers/factory");

const { ROLES } = require("../src/config/constants");
const AuditLog = require("../src/models/AuditLog");
const Department = require("../src/models/Department");
const financeService = require("../src/services/finance.service");
const reportService = require("../src/services/report.service");
const auditQueryService = require("../src/services/audit-query.service");

beforeEach(resetDatabase);

const getAs = (agent, path) => agent.get(path);

/** A window that certainly contains everything the test creates. */
const WIDE = {
  from: new Date(Date.now() - 86400000).toISOString(),
  to: new Date(Date.now() + 86400000).toISOString(),
};

// ===========================================================================
// Scope resolution
// ===========================================================================

describe("report scope resolution", () => {
  it("gives institution scope to the roles that hold it", async () => {
    for (const role of [
      ROLES.DEAN,
      ROLES.PRINCIPAL,
      ROLES.ACCOUNTS_ADMIN,
      ROLES.SUPER_ADMIN,
    ]) {
      const user = await createUser({ role });
      expect(reportService.resolveScope(user).scope).toBe("INSTITUTION");
    }
  });

  it("gives department scope to HODs, carrying their department", async () => {
    const dept = await createDepartment();
    const hod = await createUser({ role: ROLES.HOD, department: dept });

    const scope = reportService.resolveScope(hod);

    expect(scope.scope).toBe("DEPARTMENT");
    expect(scope.institutionWide).toBe(false);
    expect(scope.department).toBe(dept._id.toString());
  });

  it("refuses a viewer with no report permission", async () => {
    const student = await createStudent();

    // Synchronous by nature: scope resolution reads the session, not the
    // database, so it throws rather than returning a rejected promise.
    expect(() => reportService.resolveScope(student.user)).toThrow(/permission/i);
  });

  /**
   * The rule that carries the most weight.
   *
   * A department-scoped viewer whose account has no department must see
   * nothing. If the code treated an absent department as "no filter" it would
   * report the whole college's figures to a role that may only see its own —
   * the same null-matching trap the announcement audience query could have
   * fallen into.
   */
  it("gives a department-scoped viewer with no department no department", async () => {
    const hod = await createUser({ role: ROLES.HOD });
    expect(hod.department ?? null).toBeNull();

    const scope = reportService.resolveScope(hod);

    expect(scope.scope).toBe("DEPARTMENT");
    expect(scope.department).toBeNull();
  });
});

// ===========================================================================
// Period bounds
// ===========================================================================

describe("report periods", () => {
  it("defaults to a bounded window when no period is given", () => {
    const period = reportService.resolveRange({});

    expect(period.days).toBe(30);
    expect(period.from).toBeInstanceOf(Date);
    expect(period.to).toBeInstanceOf(Date);
  });

  it("refuses a range longer than the ceiling", () => {
    const from = new Date(Date.now() - 800 * 86400000).toISOString();

    // Otherwise one request becomes an unbounded scan of a live database.
    expect(() => reportService.resolveRange({ from })).toThrow(/at most/i);
  });

  it("refuses a backwards range", () => {
    const now = new Date().toISOString();
    const before = new Date(Date.now() - 86400000).toISOString();

    expect(() => reportService.resolveRange({ from: now, to: before })).toThrow(/after/i);
  });

  it("applies the same ceiling to audit queries", () => {
    const from = new Date(Date.now() - 800 * 86400000).toISOString();

    expect(() => auditQueryService.resolveAuditRange({ from })).toThrow(/at most/i);
  });
});

// ===========================================================================
// Departmental reports
// ===========================================================================

describe("departmental scoping", () => {
  /**
   * Create requests owned by each of two departments.
   *
   * The department is denormalised onto the request at submission time, which
   * is what makes the departmental report a single indexed query rather than a
   * join.
   */
  async function seedRequests(deptA, deptB) {
    const { createRequestType } = require("./helpers/factory");

    const typeA = await createRequestType({ department: deptA, name: "Type A" });
    const typeB = await createRequestType({ department: deptB, name: "Type B" });

    const studentA = await createStudent({ department: deptA });
    const studentB = await createStudent({ department: deptB });

    for (let i = 0; i < 3; i++) {
      await createRequest({
        owner: studentA,
        requestType: typeA,
        title: `Request A${i}`,
      });
    }

    await createRequest({ owner: studentB, requestType: typeB, title: "Request B0" });
  }

  it("counts only the viewer's own department", async () => {
    const deptA = await createDepartment();
    const deptB = await createDepartment();
    await seedRequests(deptA, deptB);

    const hodA = await createUser({ role: ROLES.HOD, department: deptA });
    const { agent } = await loginAs(hodA);

    const res = await getAs(
      agent,
      `/api/v1/reports/requests?${new URLSearchParams(WIDE)}`
    );

    expect(res.status).toBe(200);
    expect(res.body.data.scope).toBe("DEPARTMENT");
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.totals.total).toBe(3);
  });

  it("shows the other department's HOD a different figure", async () => {
    const deptA = await createDepartment();
    const deptB = await createDepartment();
    await seedRequests(deptA, deptB);

    const hodB = await createUser({ role: ROLES.HOD, department: deptB });
    const { agent } = await loginAs(hodB);

    const res = await getAs(
      agent,
      `/api/v1/reports/requests?${new URLSearchParams(WIDE)}`
    );

    expect(res.body.data.totals.total).toBe(1);
  });

  it("shows a dean the whole college", async () => {
    const deptA = await createDepartment();
    const deptB = await createDepartment();
    await seedRequests(deptA, deptB);

    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);

    const res = await getAs(
      agent,
      `/api/v1/reports/requests?${new URLSearchParams(WIDE)}`
    );

    expect(res.body.data.scope).toBe("INSTITUTION");
    expect(res.body.data.totals.total).toBe(4);
    // The departmental breakdown is only offered to an institution-scoped reader.
    expect(res.body.data.byDepartment.length).toBeGreaterThan(1);
  });

  /**
   * A HOD naming another department must be ignored, not obeyed. If the
   * `department` query parameter were applied after the scope filter, this
   * would hand one HOD the figures of another.
   */
  it("ignores a department parameter from a department-scoped viewer", async () => {
    const deptA = await createDepartment();
    const deptB = await createDepartment();
    await seedRequests(deptA, deptB);

    const hodA = await createUser({ role: ROLES.HOD, department: deptA });
    const { agent } = await loginAs(hodA);

    const res = await getAs(
      agent,
      `/api/v1/reports/requests?${new URLSearchParams({ ...WIDE, department: deptB._id.toString() })}`
    );

    expect(res.status).toBe(200);
    // Still department A's three requests, not department B's one.
    expect(res.body.data.totals.total).toBe(3);
  });

  it("reports unavailable rather than empty for a viewer with no department", async () => {
    const dept = await createDepartment();
    await seedRequests(dept, dept);

    const detachedHod = await createUser({ role: ROLES.HOD });
    const { agent } = await loginAs(detachedHod);

    const res = await getAs(
      agent,
      `/api/v1/reports/requests?${new URLSearchParams(WIDE)}`
    );

    // Not zero, and not everything: the answer is that it cannot be scoped.
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.reason).toMatch(/no department/i);
    expect(res.body.data.totals.total).toBe(0);
  });

  it("applies the same rule to the student report", async () => {
    const detachedHod = await createUser({ role: ROLES.HOD });
    const { agent } = await loginAs(detachedHod);

    const res = await getAs(
      agent,
      `/api/v1/reports/students?${new URLSearchParams(WIDE)}`
    );

    expect(res.body.data.available).toBe(false);
  });
});

// ===========================================================================
// Overview composition
// ===========================================================================

describe("report overview", () => {
  it("omits complaint and finance sections for a department-scoped viewer", async () => {
    const dept = await createDepartment();
    const hod = await createUser({ role: ROLES.HOD, department: dept });
    const { agent } = await loginAs(hod);

    const res = await getAs(agent, "/api/v1/reports/overview");

    expect(res.status).toBe(200);
    // Present: what they are entitled to.
    expect(res.body.data).toHaveProperty("students");
    expect(res.body.data).toHaveProperty("requests");
    // Absent entirely. Not zero — a zero would assert that there are no
    // grievances, which is both false and something they may not know.
    expect(res.body.data).not.toHaveProperty("complaints");
    expect(res.body.data).not.toHaveProperty("finance");
  });

  it("includes complaints and finance for an institution-scoped viewer", async () => {
    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);

    const res = await getAs(agent, "/api/v1/reports/overview");

    expect(res.body.data).toHaveProperty("complaints");
    expect(res.body.data).toHaveProperty("finance");
  });

  it("refuses the overview to a student", async () => {
    const student = await createStudent();
    const { agent } = await loginAs(student.user);

    const res = await getAs(agent, "/api/v1/reports/overview");
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// Complaints and finance are institution-only
// ===========================================================================

describe("institution-only reports", () => {
  it("refuses the complaint report to a department-scoped viewer", async () => {
    const dept = await createDepartment();
    const hod = await createUser({ role: ROLES.HOD, department: dept });
    const { agent } = await loginAs(hod);

    const res = await getAs(agent, "/api/v1/reports/complaints");

    // A grievance has no departmental dimension, so there is nothing to narrow
    // it to. 403 rather than a partial figure.
    expect(res.status).toBe(403);
  });

  it("refuses the finance report to a department-scoped viewer", async () => {
    const dept = await createDepartment();
    const hod = await createUser({ role: ROLES.HOD, department: dept });
    const { agent } = await loginAs(hod);

    const res = await getAs(agent, "/api/v1/reports/finance");
    expect(res.status).toBe(403);
  });

  it("gives the finance report to accounts staff", async () => {
    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent } = await loginAs(accounts);

    const res = await getAs(
      agent,
      `/api/v1/reports/finance?${new URLSearchParams(WIDE)}`
    );
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toHaveProperty("invoiced");
  });

  it("gives the complaint report to the dean", async () => {
    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);

    const res = await getAs(
      agent,
      `/api/v1/reports/complaints?${new URLSearchParams(WIDE)}`
    );
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toHaveProperty("openOverdue");
  });
});

// ===========================================================================
// Money exactness
// ===========================================================================

describe("finance report arithmetic", () => {
  it("sums invoice totals exactly, in whole paise", async () => {
    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const student = await createStudent();

    // Amounts chosen to make a float sum visibly wrong if one were used:
    // 0.1 + 0.2 style drift, at college scale.
    for (const amount of ["0.01", "0.02", "590000.00", "11800.00"]) {
      await financeService.createInvoice({
        user: accounts,
        studentId: student.student,
        purpose: "Exactness drill",
        items: [{ description: "Line", quantity: 1, unitAmount: amount, taxPercent: 0 }],
      });
    }

    const { agent } = await loginAs(accounts);
    const res = await getAs(
      agent,
      `/api/v1/reports/finance?${new URLSearchParams(WIDE)}`
    );

    // 1 + 2 + 59000000 + 1180000 paise.
    expect(res.body.data.totals.invoiced).toBe(60180003);
    expect(Number.isInteger(res.body.data.totals.invoiced)).toBe(true);
    expect(res.body.data.totals.invoicedFormatted).toBe("₹6,01,800.03");
  });

  it("reports a null collection rate rather than zero when nothing was raised", async () => {
    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent } = await loginAs(accounts);

    const res = await getAs(
      agent,
      `/api/v1/reports/finance?${new URLSearchParams(WIDE)}`
    );

    // A perfect collection rate would be a false claim; so would zero percent.
    expect(res.body.data.invoiceCounts.collectionRate).toBeNull();
  });

  it("nets refunds out of collections", async () => {
    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    const { agent } = await loginAs(accounts);

    const res = await getAs(
      agent,
      `/api/v1/reports/finance?${new URLSearchParams(WIDE)}`
    );

    const { collected, refunded, netCollected } = res.body.data.totals;
    expect(netCollected).toBe(collected - refunded);
  });
});

// ===========================================================================
// Audit trail
// ===========================================================================

describe("audit trail", () => {
  /**
   * Empty the trail.
   *
   * Must be called *after* signing in: both creating users and authenticating
   * write entries, so a test that counts entries has to clear last or it ends
   * up counting its own setup.
   */
  async function clearTrail() {
    await AuditLog.deleteMany({});
  }

  /** Write an entry directly, which is what the workflows do in production. */
  async function entry(actor, overrides = {}) {
    return AuditLog.create({
      actor: actor?._id ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? "SYSTEM",
      action: "PAYMENT_VERIFIED",
      entity: "Invoice",
      entityRef: "INV-DEFAULT-1",
      metadata: { amount: 100 },
      ...overrides,
    });
  }

  it("shows the whole trail to an institution-scoped viewer", async () => {
    const dean = await createUser({ role: ROLES.DEAN });
    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });

    const { agent } = await loginAs(dean);
    await clearTrail();
    await entry(dean, { action: "PAYMENT_VERIFIED" });
    await entry(accounts, { action: "REFUND_PROCESSED" });

    const res = await getAs(agent, `/api/v1/audit?${new URLSearchParams(WIDE)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.scope).toBe("INSTITUTION");
  });

  /**
   * Department scope resolves to the viewer's own actions, because an audit
   * entry carries no department to filter by.
   */
  it("shows a HOD only their own entries, and says so", async () => {
    const dept = await createDepartment();
    const hod = await createUser({ role: ROLES.HOD, department: dept });
    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });

    const { agent } = await loginAs(hod);
    await clearTrail();
    await entry(hod, { action: "ASSIGNMENT" });
    await entry(accounts, { action: "ASSIGNMENT" });

    const res = await getAs(agent, `/api/v1/audit?${new URLSearchParams(WIDE)}`);

    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].actor.id).toBe(hod._id.toString());
    // The reader is told what they are looking at, rather than left to assume.
    expect(res.body.meta.scope).toBe("DEPARTMENT_OWN_ACTIONS");
    expect(res.body.meta.scopeNote).toMatch(/do not record a department|you performed/i);
  });

  it("refuses a HOD querying another user's entries", async () => {
    const dept = await createDepartment();
    const hod = await createUser({ role: ROLES.HOD, department: dept });
    const accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
    await entry(accounts);

    const { agent } = await loginAs(hod);
    const res = await getAs(
      agent,
      `/api/v1/audit?${new URLSearchParams({ ...WIDE, actorId: accounts._id.toString() })}`
    );

    expect(res.status).toBe(403);
  });

  it("filters by action, entity and reference", async () => {
    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);
    await clearTrail();
    await entry(dean, {
      action: "PAYMENT_VERIFIED",
      entity: "Invoice",
      entityRef: "INV-AUDIT-1",
    });
    await entry(dean, {
      action: "REFUND_PROCESSED",
      entity: "Refund",
      entityRef: "REF-AUDIT-1",
    });

    const byAction = await getAs(
      agent,
      `/api/v1/audit?${new URLSearchParams({ ...WIDE, action: "REFUND_PROCESSED" })}`
    );
    expect(byAction.body.meta.total).toBe(1);
    // The schema uppercases `entity`, and the query normalises to match.
    expect(byAction.body.data[0].entity).toBe("REFUND");

    // Case is normalised on both sides: the schema uppercases `entity`.
    const byEntity = await getAs(
      agent,
      `/api/v1/audit?${new URLSearchParams({ ...WIDE, entity: "invoice" })}`
    );
    expect(byEntity.body.meta.total).toBe(1);

    const byRef = await getAs(
      agent,
      `/api/v1/audit?${new URLSearchParams({ ...WIDE, entityRef: "ref-audit-1" })}`
    );
    expect(byRef.body.meta.total).toBe(1);
  });

  it("returns the history of one resource by reference", async () => {
    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);
    await clearTrail();
    await entry(dean, { entityRef: "INV-AUDIT-42", action: "CREATE" });
    await entry(dean, { entityRef: "INV-AUDIT-42", action: "PAYMENT_VERIFIED" });
    await entry(dean, { entityRef: "INV-AUDIT-99", action: "CREATE" });

    const res = await getAs(
      agent,
      `/api/v1/audit/trail?${new URLSearchParams({ entityRef: "INV-AUDIT-42" })}`
    );

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items.every((i) => i.entityRef === "INV-AUDIT-42")).toBe(true);
  });

  it("demands a resource id or reference for a trail", async () => {
    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);

    const res = await getAs(agent, "/api/v1/audit/trail");
    expect(res.status).toBe(400);
  });

  it("serves the access-denied trail to institution scope only", async () => {
    const dean = await createUser({ role: ROLES.DEAN });
    const dept = await createDepartment();
    const hod = await createUser({ role: ROLES.HOD, department: dept });

    const { agent: deanAgent } = await loginAs(dean);
    const { agent: hodAgent } = await loginAs(hod);
    await clearTrail();
    await entry(hod, {
      action: "ACCESS_DENIED",
      metadata: { required: "complaint:read" },
    });

    const deanRes = await getAs(
      deanAgent,
      `/api/v1/audit/denied?${new URLSearchParams(WIDE)}`
    );
    expect(deanRes.status).toBe(200);
    expect(deanRes.body.meta.total).toBe(1);

    const hodRes = await getAs(
      hodAgent,
      `/api/v1/audit/denied?${new URLSearchParams(WIDE)}`
    );
    expect(hodRes.status).toBe(403);
  });

  it("refuses the trail to a viewer with no audit permission", async () => {
    const student = await createStudent();
    const { agent } = await loginAs(student.user);

    expect((await getAs(agent, "/api/v1/audit")).status).toBe(403);
  });

  it("exposes no way to write, amend or delete an entry", async () => {
    // Read-only by construction: the router registers no mutating method.
    const routes = require("../src/routes/audit.routes");
    const methods = [];
    routes.stack.forEach((layer) => {
      if (layer.route) methods.push(...Object.keys(layer.route.methods));
    });

    expect(methods.every((m) => m === "get")).toBe(true);
  });

  it("keeps an entry readable after the actor is deleted", async () => {
    const dean = await createUser({ role: ROLES.DEAN });
    const transient = await createUser({ role: ROLES.HOD });

    const { agent } = await loginAs(dean);
    await clearTrail();
    await entry(transient, { action: "ASSIGNMENT" });
    await require("../src/models/User").deleteOne({ _id: transient._id });

    const res = await getAs(agent, `/api/v1/audit?${new URLSearchParams(WIDE)}`);

    expect(res.body.data[0].actor.email).toBe(transient.email.toLowerCase());
    expect(res.body.data[0].actor.fullName).toBeNull();
    // The shape is identical either way, so a client never has to branch.
    expect(res.body.data[0].actor.deleted).toBe(true);
    expect(Object.keys(res.body.data[0].actor).sort()).toEqual(
      ["deleted", "email", "fullName", "id", "role"].sort()
    );
  });
});

// ===========================================================================
// Student report
// ===========================================================================

describe("student report", () => {
  it("breaks enrolment down by department and programme", async () => {
    const deptA = await createDepartment();
    const deptB = await createDepartment();
    const progA = await createProgram(deptA);

    await createStudent({ department: deptA, program: progA });
    await createStudent({ department: deptA, program: progA });
    await createStudent({ department: deptB });

    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);

    const res = await getAs(
      agent,
      `/api/v1/reports/students?${new URLSearchParams(WIDE)}`
    );

    expect(res.body.data.totals.total).toBe(3);
    expect(res.body.data.byDepartment.length).toBe(2);

    const withProgram = res.body.data.byProgram.find(
      (p) => p.programId === progA._id.toString()
    );
    expect(withProgram.count).toBe(2);
  });

  it("names a department that no longer resolves rather than showing a raw id", async () => {
    const dept = await createDepartment();
    const student = await createStudent({ department: dept });

    // The lookup fails, but the student record still carries the reference.
    await Department.deleteOne({ _id: dept._id });

    const dean = await createUser({ role: ROLES.DEAN });
    const { agent } = await loginAs(dean);

    const res = await getAs(
      agent,
      `/api/v1/reports/students?${new URLSearchParams(WIDE)}`
    );

    expect(res.body.data.totals.total).toBe(1);
    expect(res.body.data.byDepartment[0].name).toBe("Unknown");
    void student;
  });
});
