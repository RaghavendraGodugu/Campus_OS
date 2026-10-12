/**
 * CSRF protection tests.
 *
 * CampusOS sets `SameSite=None` in production (Vercel frontend, Render API are
 * different sites), so cookies accompany cross-site requests and CSRF
 * protection is a load-bearing control, not a formality.
 *
 * These tests assert the *denial* paths, because that is where CSRF
 * implementations fail.
 */

const request = require("supertest");

const {
  getApp,
  resetDatabase,
  createUser,
  loginAs,
  readCookie,
  expectError,
} = require("./helpers/factory");
const { COOKIE_NAMES } = require("../src/utils/cookies");
const { ROLES } = require("../src/config/constants");

beforeEach(resetDatabase);

/** A protected mutating route, used as the CSRF test subject. */
const PROTECTED_MUTATION = { path: "/api/v1/auth/logout-all", method: "post" };

describe("CSRF protection", () => {
  it("rejects a protected mutation with no CSRF header", async () => {
    const user = await createUser({ role: ROLES.SUPER_ADMIN });
    const { agent } = await loginAs(user);

    const res = await agent[PROTECTED_MUTATION.method](PROTECTED_MUTATION.path).send({});

    expectError(res, 403, "CSRF_INVALID");
  });

  it("rejects a protected mutation with a wrong CSRF header", async () => {
    const user = await createUser({ role: ROLES.SUPER_ADMIN });
    const { agent } = await loginAs(user);

    const res = await agent
      .post(PROTECTED_MUTATION.path)
      .set("X-CSRF-Token", "deadbeef".repeat(8))
      .send({});

    expectError(res, 403, "CSRF_INVALID");
  });

  it("rejects a mismatch between the CSRF cookie and header", async () => {
    const user = await createUser({ role: ROLES.SUPER_ADMIN });
    const { agent, csrfToken } = await loginAs(user);

    const res = await agent
      .post(PROTECTED_MUTATION.path)
      // Guarantees the token actually differs.
      //
      // This was `slice(0, -1) + "0"`, which is a no-op whenever the token
      // already ends in "0" — about one run in sixteen. The request then
      // carried the *correct* token, the server rightly accepted it, and the
      // test failed for looking like a security bypass. A tampering test must
      // never be able to produce an untampered token.
      .set("X-CSRF-Token", csrfToken.slice(0, -1) + (csrfToken.endsWith("0") ? "1" : "0"))
      .send({});

    expectError(res, 403, "CSRF_INVALID");
  });

  it("accepts a mutation with a matching CSRF token", async () => {
    const user = await createUser({ role: ROLES.SUPER_ADMIN });
    const { agent, csrfToken } = await loginAs(user);

    const res = await agent
      .post(PROTECTED_MUTATION.path)
      .set("X-CSRF-Token", csrfToken)
      .send({});

    expect(res.status).toBe(200);
  });

  it("rejects another user's CSRF token", async () => {
    const userA = await createUser({ role: ROLES.SUPER_ADMIN });
    const userB = await createUser({ role: ROLES.SUPER_ADMIN });

    const { agent: agentA } = await loginAs(userA);
    const { csrfToken: csrfB } = await loginAs(userB);

    // A token bound to user B must not authorise a mutation for user A.
    const res = await agentA
      .post(PROTECTED_MUTATION.path)
      .set("X-CSRF-Token", csrfB)
      .send({});

    expectError(res, 403, "CSRF_INVALID");
  });

  it("does not require CSRF for safe methods", async () => {
    const user = await createUser({ role: ROLES.SUPER_ADMIN });
    const { agent } = await loginAs(user);

    const res = await agent.get("/api/v1/auth/me");

    // GET must not mutate, so requiring CSRF on it would break the SPA's
    // session bootstrap for no security benefit.
    expect(res.status).toBe(200);
  });

  it("issues a CSRF cookie that JavaScript can read", async () => {
    const res = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: (await createUser()).email, password: "TestPass123!" });

    const cookies = res.headers["set-cookie"];
    const csrfCookie = cookies.find((c) => c.startsWith(COOKIE_NAMES.CSRF_TOKEN));

    // The double-submit pattern depends on JS being able to read this one.
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie).not.toMatch(/HttpOnly/i);

    // ...while the credential cookies must remain unreadable.
    expect(cookies.find((c) => c.startsWith(COOKIE_NAMES.ACCESS_TOKEN))).toMatch(
      /HttpOnly/i
    );
    expect(cookies.find((c) => c.startsWith(COOKIE_NAMES.REFRESH_TOKEN))).toMatch(
      /HttpOnly/i
    );
  });

  it("rejects an unauthenticated request lacking both tokens", async () => {
    const res = await request(getApp()).post("/api/v1/auth/logout-all").send({});

    // No session, so CSRF is irrelevant; the real answer is 401.
    expectError(res, 401, "UNAUTHENTICATED");
  });

  it("rejects refresh when the CSRF header does not match the cookie", async () => {
    const user = await createUser();
    const login = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "TestPass123!" });

    const res = await request(getApp())
      .post("/api/v1/auth/refresh")
      .set(
        "Cookie",
        `${COOKIE_NAMES.REFRESH_TOKEN}=${readCookie(login, COOKIE_NAMES.REFRESH_TOKEN)}; ${COOKIE_NAMES.CSRF_TOKEN}=expected`
      )
      .set("X-CSRF-Token", "different")
      .send({});

    expectError(res, 403, "CSRF_INVALID");
  });

  it("rejects an unauthenticated mutation carrying a CSRF header but no cookie", async () => {
    // Refresh is the only unauthenticated mutation that requires CSRF.
    const user = await createUser();
    const login = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "TestPass123!" });

    const res = await request(getApp())
      .post("/api/v1/auth/refresh")
      .set(
        "Cookie",
        `${COOKIE_NAMES.REFRESH_TOKEN}=${readCookie(login, COOKIE_NAMES.REFRESH_TOKEN)}`
      )
      .set("X-CSRF-Token", "header-only")
      .send({});

    expectError(res, 403, "CSRF_INVALID");
  });
});

describe("CORS and cookie security", () => {
  it("reflects only trusted origins", async () => {
    const trusted = await request(getApp())
      .get("/health")
      .set("Origin", "http://localhost:5173");
    expect(trusted.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

    const untrusted = await request(getApp())
      .get("/health")
      .set("Origin", "https://evil.example.com");

    // Reflecting any origin alongside credentials:true would let any site make
    // authenticated requests.
    expect(untrusted.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sets security headers", async () => {
    const res = await request(getApp()).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
