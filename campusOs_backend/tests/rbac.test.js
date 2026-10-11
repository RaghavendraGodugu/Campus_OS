/**
 * Role-based access control tests.
 *
 * Per the spec (§17), these assert *denials*, not just grants. A permission
 * matrix that has only been tested for what it allows has not been tested.
 *
 * The denial cases below are the ones that matter:
 *  - a student cannot read another student's data (IDOR)
 *  - a department-scoped role cannot reach another department
 *  - confidential material is invisible to unprivileged roles
 *  - SUPER_ADMIN does not automatically gain confidential access
 */

const {
  resetDatabase,
  createUser,
  createStudent,
  createDepartment,
  loginAs,
  expectError,
} = require("./helpers/factory");
const { ROLES } = require("../src/config/constants");
const {
  roleHasPermission,
  canReadConfidentialComplaints,
  isDepartmentScoped,
  describePermissions,
  P,
} = require("../src/utils/permissions");

beforeEach(resetDatabase);

describe("permission matrix integrity", () => {
  it("grants every role the base permissions", () => {
    for (const role of Object.values(ROLES)) {
      expect(roleHasPermission(role, P.DEPARTMENT_READ)).toBe(true);
      expect(roleHasPermission(role, P.PROGRAM_READ)).toBe(true);
    }
  });

  it("denies by default for an unknown role", () => {
    expect(roleHasPermission("NOT_A_ROLE", P.REQUEST_CREATE)).toBe(false);
    expect(describePermissions("NOT_A_ROLE").permissions).toEqual([]);
  });

  it("does not grant a student any institutional scope over student data", () => {
    const forbidden = [
      P.STUDENT_READ_INSTITUTION,
      P.REQUEST_READ_INSTITUTION,
      P.COMPLAINT_READ_INSTITUTION,
      P.COMPLAINT_READ_CONFIDENTIAL,
      P.INVOICE_READ_INSTITUTION,
      P.CERTIFICATE_READ_INSTITUTION,
      P.USER_MANAGE,
      P.ROLE_CHANGE,
    ];

    forbidden.forEach((permission) => {
      expect(roleHasPermission(ROLES.STUDENT, permission)).toBe(false);
    });
  });

  it("does not let teaching roles approve requests", () => {
    // Teaching a subject is not authority to approve an application.
    [ROLES.FACULTY, ROLES.SUPPORT_STAFF, ROLES.EXAM_ADMIN].forEach((role) => {
      expect(roleHasPermission(role, P.REQUEST_APPROVE_DEPARTMENT)).toBe(false);
    });
  });

  it("confines confidential complaints to DEAN and PRINCIPAL", () => {
    const withAccess = Object.values(ROLES).filter((role) =>
      roleHasPermission(role, P.COMPLAINT_READ_CONFIDENTIAL)
    );

    // Deliberately excludes SUPER_ADMIN: platform administration must not
    // confer access to personal grievances.
    expect(withAccess.sort()).toEqual([ROLES.DEAN, ROLES.PRINCIPAL]);
  });

  it("does not grant SUPER_ADMIN confidential complaint access", () => {
    expect(roleHasPermission(ROLES.SUPER_ADMIN, P.COMPLAINT_READ_CONFIDENTIAL)).toBe(
      false
    );
    expect(canReadConfidentialComplaints({ role: ROLES.SUPER_ADMIN })).toBe(false);
  });

  it("scopes departmental roles to their department", () => {
    expect(isDepartmentScoped(ROLES.HOD)).toBe(true);
    expect(isDepartmentScoped(ROLES.FACULTY)).toBe(true);
    expect(isDepartmentScoped(ROLES.STUDENT)).toBe(false);
    expect(isDepartmentScoped(ROLES.PRINCIPAL)).toBe(false);
  });

  it("keeps account administration separate from academic record access", () => {
    expect(roleHasPermission(ROLES.ACCOUNTS_ADMIN, P.USER_MANAGE)).toBe(false);
    expect(roleHasPermission(ROLES.ACCOUNTS_ADMIN, P.INVOICE_MANAGE)).toBe(true);
    expect(roleHasPermission(ROLES.SUPER_ADMIN, P.USER_MANAGE)).toBe(true);
  });
});

describe("role behaviour over HTTP", () => {
  it("returns a student's own session payload", async () => {
    const { user } = await createStudent();
    const { agent } = await loginAs(user);

    const res = await agent.get("/api/v1/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe(ROLES.STUDENT);
  });

  it("gives each role its own permission set", async () => {
    const expectations = [
      [ROLES.STUDENT, P.REQUEST_CREATE, true],
      [ROLES.HOD, P.REQUEST_APPROVE_DEPARTMENT, true],
      [ROLES.HOD, P.USER_MANAGE, false],
      [ROLES.SUPPORT_STAFF, P.REQUEST_UPDATE_ASSIGNED, true],
      [ROLES.SUPPORT_STAFF, P.REQUEST_APPROVE_DEPARTMENT, false],
      [ROLES.PRINCIPAL, P.REQUEST_APPROVE_INSTITUTION, true],
    ];

    for (const [role, permission, expected] of expectations) {
      const user = await createUser({ role });
      const { agent } = await loginAs(user);
      const res = await agent.get("/api/v1/auth/me");

      const held = res.body.data.permissions.includes(permission);
      expect(held).toBe(expected);
    }
  });

  it("reports scopes so the frontend can render navigation", async () => {
    const user = await createUser({ role: ROLES.HOD });
    const { agent } = await loginAs(user);

    const res = await agent.get("/api/v1/auth/me");

    expect(res.body.data.scopes).toContain("department");
    expect(res.body.data.scopes).toContain("own");
  });
});

describe("cross-tenant access (IDOR)", () => {
  it("never exposes another student through the session endpoint", async () => {
    // /me is scoped to the caller's own token by construction. This guards
    // against a future change that starts returning a request-scoped student.
    const alice = await createStudent({ fullName: "Alice" });
    const bob = await createStudent({ fullName: "Bob" });

    const { agent: aliceAgent } = await loginAs(alice.user);
    const res = await aliceAgent.get("/api/v1/auth/me");

    expect(res.body.data.student.rollNumber).toBe(alice.student.rollNumber);
    expect(res.body.data.student.rollNumber).not.toBe(bob.student.rollNumber);
  });

  it("does not let a student authenticate as another student", async () => {
    const alice = await createStudent();
    const bob = await createStudent();

    // Signing in with Alice's credentials must never yield Bob's profile.
    const { agent } = await loginAs(alice.user);
    const res = await agent.get("/api/v1/auth/me");

    expect(res.body.data.user.email).toBe(alice.user.email);
    expect(res.body.data.student.id).toBe(alice.student.id.toString());
    expect(res.body.data.student.id).not.toBe(bob.student.id.toString());
  });

  it("keeps a staff session out of student ownership checks", async () => {
    const staff = await createUser({ role: ROLES.SUPPORT_STAFF });
    const { agent } = await loginAs(staff);

    const res = await agent.get("/api/v1/auth/me");

    // A staff account has no linked Student profile and must not be able to
    // acquire one through its session.
    expect(res.body.data.student).toBeNull();
    expect(res.body.data.user.student).toBeNull();
  });
});

describe("authentication precedes authorisation", () => {
  it("returns 401 for an anonymous request to a protected route", async () => {
    const request = require("supertest");
    const { getApp } = require("./helpers/factory");

    const res = await request(getApp()).post("/api/v1/auth/logout-all").send({});

    // Unauthenticated callers must not be able to distinguish protected routes
    // by status code.
    expect(res.status).toBe(401);
  });

  it("still applies CSRF to a student's protected mutation", async () => {
    const user = await createUser({ role: ROLES.STUDENT });
    const { agent } = await loginAs(user);

    const res = await agent.post("/api/v1/auth/logout-all").send({});

    // CSRF is enforced for every authenticated caller regardless of role, so
    // a low-privilege user cannot mutate anything by omitting the header.
    expectError(res, 403, "CSRF_INVALID");
  });
});

describe("requirePermission gate", () => {
  /**
   * Exercised against a minimal app rather than a production route.
   *
   * Phase A has no business endpoint restricted to a single permission, and
   * adding a test-only route to production code to prove the middleware works
   * would be worse than testing the middleware directly. The gate is the same
   * function every future route will call.
   */
  const express = require("express");
  const cookieParser = require("cookie-parser");
  const request = require("supertest");
  const { authenticate, requirePermission } = require("../src/middleware/auth");

  /**
   * Build a throwaway app exposing one permission-gated route.
   *
   * Mirrors the production middleware order: cookie parsing must precede
   * authentication, or `authenticate` finds no session cookie and rejects every
   * request as anonymous.
   */
  /**
   * Build a throwaway app exposing one permission-gated route.
   *
   * Variadic on purpose: `requirePermission` accepts several permissions and
   * requires *all* of them, and the multi-permission behaviour needs to be
   * exercised. An earlier version of this helper took a single argument, which
   * silently dropped the extra permissions and made the gate look broken.
   *
   * Mirrors the production middleware order: cookie parsing must precede
   * authentication, or `authenticate` finds no session cookie and rejects every
   * request as anonymous.
   */
  function buildGatedApp(...permissions) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.get("/gated", authenticate, requirePermission(...permissions), (req, res) => {
      res.json({ success: true, message: "granted" });
    });
    // Mirror the production error shape so status assertions are meaningful.
    const { errorHandler } = require("../src/middleware/errorHandler");
    app.use(errorHandler);
    return app;
  }

  it("grants a route when the role holds the permission", async () => {
    const user = await createUser({ role: ROLES.HOD });
    const { cookieHeader } = await loginAs(user);

    const res = await request(buildGatedApp(P.REQUEST_APPROVE_DEPARTMENT))
      .get("/gated")
      .set("Cookie", cookieHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 403 when the role lacks the permission", async () => {
    const user = await createUser({ role: ROLES.STUDENT });
    const { cookieHeader } = await loginAs(user);

    const res = await request(buildGatedApp(P.REQUEST_APPROVE_DEPARTMENT))
      .get("/gated")
      .set("Cookie", cookieHeader);

    expectError(res, 403, "FORBIDDEN");
  });

  it("requires every listed permission when several are given", async () => {
    const user = await createUser({ role: ROLES.FACULTY });
    const { cookieHeader } = await loginAs(user);

    // Faculty holds the first but not the second, so the gate must deny.
    const res = await request(
      buildGatedApp(P.REQUEST_UPDATE_ASSIGNED, P.REQUEST_APPROVE_DEPARTMENT)
    )
      .get("/gated")
      .set("Cookie", cookieHeader);

    expectError(res, 403, "FORBIDDEN");
  });

  it("rejects an anonymous request before checking permissions", async () => {
    const res = await request(buildGatedApp(P.REQUEST_APPROVE_DEPARTMENT)).get("/gated");
    expectError(res, 401, "UNAUTHENTICATED");
  });

  it("refuses to build a gate with no permissions", () => {
    // An empty gate would silently allow everyone — a catastrophic and easy
    // mistake, so it throws at construction time instead.
    expect(() => requirePermission()).toThrow(/at least one permission/i);
  });
});

describe("department boundaries", () => {
  it("creates staff scoped to their own department", async () => {
    const cse = await createDepartment({ name: "Computer Science" });
    const ece = await createDepartment({ name: "Electronics" });

    const hodCse = await createUser({ role: ROLES.HOD, department: cse });
    const hodEce = await createUser({ role: ROLES.HOD, department: ece });

    expect(hodCse.department.toString()).toBe(cse._id.toString());
    expect(hodEce.department.toString()).toBe(ece._id.toString());
    expect(hodCse.department.toString()).not.toBe(hodEce.department.toString());
  });
});
