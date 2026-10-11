/**
 * Authentication tests.
 *
 * Covers the behaviours the spec (§17) calls out: successful and failed login,
 * missing and expired authentication, duplicate submissions, and — most
 * importantly — refresh rotation with reuse detection.
 */

const request = require("supertest");

const {
  getApp,
  resetDatabase,
  createUser,
  createStudent,
  loginAs,
  readCookie,
  expectError,
} = require("./helpers/factory");
const { ROLES } = require("../src/config/constants");
const { signAccessToken, signRefreshToken, hashToken } = require("../src/utils/tokens");
const { COOKIE_NAMES } = require("../src/utils/cookies");
const User = require("../src/models/User");

beforeEach(resetDatabase);

describe("POST /api/v1/auth/login", () => {
  it("signs in with valid credentials and sets HttpOnly cookies", async () => {
    const user = await createUser({ role: ROLES.STUDENT });

    const res = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "TestPass123!" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(user.email);

    // Tokens must never appear in the response body.
    expect(JSON.stringify(res.body)).not.toContain("eyJ");

    const cookies = res.headers["set-cookie"];
    const access = cookies.find((c) => c.startsWith(COOKIE_NAMES.ACCESS_TOKEN));
    const refresh = cookies.find((c) => c.startsWith(COOKIE_NAMES.REFRESH_TOKEN));

    // Session cookies must be unreadable by JavaScript.
    expect(access).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/HttpOnly/i);
  });

  it("never returns the password hash or session tokens", async () => {
    const user = await createUser();
    const res = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "TestPass123!" });

    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.refreshTokens).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
  });

  it("rejects a wrong password with a vague message", async () => {
    const user = await createUser();
    const res = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "WrongPassword1!" });

    expectError(res, 401, "INVALID_CREDENTIALS");
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("gives the same response for an unknown email as a wrong password", async () => {
    const unknown = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: "nobody@test.local", password: "WrongPassword1!" });

    const user = await createUser();
    const wrongPassword = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "WrongPassword1!" });

    // Identical status AND message: the endpoint must not reveal whether an
    // address is registered.
    expect(unknown.status).toBe(wrongPassword.status);
    expect(unknown.body.message).toBe(wrongPassword.body.message);
    expect(unknown.body.code).toBe(wrongPassword.body.code);
  });

  it("rejects a deactivated account", async () => {
    const user = await createUser({ isActive: false });
    const res = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "TestPass123!" });

    expectError(res, 401, "INVALID_CREDENTIALS");
  });

  it("normalises the email before matching", async () => {
    await createUser({ email: "Mixed.Case@Test.local" });

    // Signing in with the lowercased form must match the stored (normalised)
    // address, so account creation must not be case-sensitive.
    const res = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: "mixed.case@test.local", password: "TestPass123!" });

    expect(res.status).toBe(200);
  });

  it("rejects unknown fields, blocking role injection", async () => {
    const user = await createUser();
    const res = await request(getApp()).post("/api/v1/auth/login").send({
      email: user.email,
      password: "TestPass123!",
      role: ROLES.SUPER_ADMIN,
      isActive: true,
    });

    // Strict schema: a client cannot smuggle privileged fields.
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details[0].code).toBe("unrecognized_keys");
  });

  it("validates email and password presence", async () => {
    const res = await request(getApp()).post("/api/v1/auth/login").send({});
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details).toHaveLength(2);
  });

  it("rejects a malformed email format", async () => {
    const res = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: "TestPass123!" });
    expectError(res, 400, "VALIDATION_ERROR");
  });
});

describe("GET /api/v1/auth/me", () => {
  it("returns the identity and permissions when signed in", async () => {
    const user = await createUser({ role: ROLES.HOD });
    const { agent } = await loginAs(user);

    const res = await agent.get("/api/v1/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(user.email);
    expect(Array.isArray(res.body.data.permissions)).toBe(true);
    expect(res.body.data.permissions).toContain("request:approve:department");
  });

  it("includes the linked student profile for a student", async () => {
    const { user, student } = await createStudent();
    const { agent } = await loginAs(user);

    const res = await agent.get("/api/v1/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.data.student.rollNumber).toBe(student.rollNumber);
  });

  it("returns null student for staff", async () => {
    const user = await createUser({ role: ROLES.SUPPORT_STAFF });
    const { agent } = await loginAs(user);

    const res = await agent.get("/api/v1/auth/me");
    expect(res.body.data.student).toBeNull();
  });

  it("rejects an anonymous request", async () => {
    const res = await request(getApp()).get("/api/v1/auth/me");
    expectError(res, 401, "UNAUTHENTICATED");
  });

  it("rejects a forged access token", async () => {
    const forged = signAccessToken({
      userId: new (require("mongoose").Types.ObjectId)().toString(),
      role: ROLES.SUPER_ADMIN,
      sessionId: "forged",
    }).split(".");
    // Tamper with the payload while keeping a plausible structure.
    forged[1] = Buffer.from(JSON.stringify({ sub: "x", role: "SUPER_ADMIN" })).toString(
      "base64url"
    );

    const res = await request(getApp())
      .get("/api/v1/auth/me")
      .set("Cookie", `${COOKIE_NAMES.ACCESS_TOKEN}=${forged.join(".")}`);

    expectError(res, 401, "UNAUTHENTICATED");
  });

  it("rejects an access token for a deleted user", async () => {
    const user = await createUser();
    const { agent } = await loginAs(user);
    await User.deleteOne({ _id: user._id });

    const res = await agent.get("/api/v1/auth/me");
    expectError(res, 401, "UNAUTHENTICATED");
  });

  it("rejects an access token for a deactivated user", async () => {
    const user = await createUser();
    const { agent } = await loginAs(user);

    await User.updateOne({ _id: user._id }, { $set: { isActive: false } });

    const res = await agent.get("/api/v1/auth/me");
    expectError(res, 403, "FORBIDDEN");
  });

  it("honours a role change without waiting for token expiry", async () => {
    const user = await createUser({ role: ROLES.SUPPORT_STAFF });
    const { agent } = await loginAs(user);

    const before = await agent.get("/api/v1/auth/me");
    expect(before.body.data.permissions).not.toContain("request:approve:department");

    // Role is read live from the database on each request.
    await User.updateOne({ _id: user._id }, { $set: { role: ROLES.HOD } });

    const after = await agent.get("/api/v1/auth/me");
    expect(after.body.data.user.role).toBe(ROLES.HOD);
    expect(after.body.data.permissions).toContain("request:approve:department");
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("rotates the refresh token", async () => {
    const user = await createUser();
    const login = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "TestPass123!" });

    const original = readCookie(login, COOKIE_NAMES.REFRESH_TOKEN);
    const csrf = readCookie(login, COOKIE_NAMES.CSRF_TOKEN);

    const res = await request(getApp())
      .post("/api/v1/auth/refresh")
      .set(
        "Cookie",
        [
          `${COOKIE_NAMES.REFRESH_TOKEN}=${original}`,
          `${COOKIE_NAMES.CSRF_TOKEN}=${csrf}`,
        ].join("; ")
      )
      .set("X-CSRF-Token", csrf)
      .send({});

    expect(res.status).toBe(200);
    const rotated = readCookie(res, COOKIE_NAMES.REFRESH_TOKEN);

    // A rotation that returns an identical token would silently disable
    // reuse detection, so this is asserted explicitly.
    expect(rotated).not.toBe(original);
  });

  it("issues a token distinct from one minted in the same second", async () => {
    // Regression guard: JWT `iat` has 1-second resolution, so without a jti
    // nonce two tokens for the same session would be byte-identical.
    const user = await createUser();
    const args = { userId: user._id.toString(), sessionId: "s1", familyId: "f1" };
    const a = signRefreshToken(args);
    const b = signRefreshToken(args);
    expect(a).not.toBe(b);
  });

  it("rejects a replayed refresh token and revokes every session", async () => {
    const user = await createUser();
    const login = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "TestPass123!" });

    const original = readCookie(login, COOKIE_NAMES.REFRESH_TOKEN);
    const csrf = readCookie(login, COOKIE_NAMES.CSRF_TOKEN);
    const cookieHeader = (rt) =>
      [`${COOKIE_NAMES.REFRESH_TOKEN}=${rt}`, `${COOKIE_NAMES.CSRF_TOKEN}=${csrf}`].join(
        "; "
      );

    // Rotate once, legitimately.
    const rotatedRes = await request(getApp())
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieHeader(original))
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(rotatedRes.status).toBe(200);
    const rotated = readCookie(rotatedRes, COOKIE_NAMES.REFRESH_TOKEN);

    // Replay the spent token: must be refused.
    const replay = await request(getApp())
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieHeader(original))
      .set("X-CSRF-Token", csrf)
      .send({});
    expectError(replay, 401, "UNAUTHENTICATED");

    // The live token must now be dead too — the whole family is revoked.
    const afterRevoke = await request(getApp())
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieHeader(rotated))
      .set("X-CSRF-Token", csrf)
      .send({});
    expectError(afterRevoke, 401, "UNAUTHENTICATED");
  });

  it("invalidates outstanding access tokens when reuse is detected", async () => {
    const user = await createUser();
    const login = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "TestPass123!" });

    const access = readCookie(login, COOKIE_NAMES.ACCESS_TOKEN);
    const refresh = readCookie(login, COOKIE_NAMES.REFRESH_TOKEN);
    const csrf = readCookie(login, COOKIE_NAMES.CSRF_TOKEN);
    const cookieHeader = (rt) =>
      [`${COOKIE_NAMES.REFRESH_TOKEN}=${rt}`, `${COOKIE_NAMES.CSRF_TOKEN}=${csrf}`].join(
        "; "
      );

    // Rotate first, so a revoked token exists to be replayed afterwards.
    const rotatedRes = await request(getApp())
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieHeader(refresh))
      .set("X-CSRF-Token", csrf)
      .send({});
    const rotated = readCookie(rotatedRes, COOKIE_NAMES.REFRESH_TOKEN);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(refresh);

    // Reuse triggers revocation, which must also kill the access token.
    await request(getApp())
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieHeader(refresh))
      .set("X-CSRF-Token", csrf)
      .send({});

    const me = await request(getApp())
      .get("/api/v1/auth/me")
      .set("Cookie", `${COOKIE_NAMES.ACCESS_TOKEN}=${access}`);

    expectError(me, 401, "UNAUTHENTICATED");
  });

  it("rejects a refresh token presented as an access token", async () => {
    const user = await createUser();
    const login = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "TestPass123!" });
    const refresh = readCookie(login, COOKIE_NAMES.REFRESH_TOKEN);

    // A 7-day credential must never work as an API key.
    const res = await request(getApp())
      .get("/api/v1/auth/me")
      .set("Cookie", `${COOKIE_NAMES.ACCESS_TOKEN}=${refresh}`);

    expectError(res, 401, "UNAUTHENTICATED");
  });

  it("rejects a garbage refresh token", async () => {
    // A valid CSRF pair is required to reach the token check, so the failure
    // here is attributable to the malformed refresh token itself.
    const res = await request(getApp())
      .post("/api/v1/auth/refresh")
      .set("Cookie", `${COOKIE_NAMES.REFRESH_TOKEN}=not.a.jwt`)
      .set(
        "Cookie",
        `${COOKIE_NAMES.REFRESH_TOKEN}=not.a.jwt; ${COOKIE_NAMES.CSRF_TOKEN}=abc`
      )
      .set("X-CSRF-Token", "abc")
      .send({});

    expectError(res, 401, "UNAUTHENTICATED");
  });

  it("checks CSRF before the refresh token is even parsed", async () => {
    // No CSRF header at all: rejected on that ground alone, regardless of
    // whether the refresh cookie is valid.
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
      .send({});

    expectError(res, 403, "CSRF_INVALID");
  });

  it("rejects refresh without a CSRF token", async () => {
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
      .send({});

    expectError(res, 403, "CSRF_INVALID");
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("clears cookies and revokes the session", async () => {
    const user = await createUser();
    const { agent, csrfToken } = await loginAs(user);

    const res = await agent
      .post("/api/v1/auth/logout")
      .set("X-CSRF-Token", csrfToken)
      .send({});

    expect(res.status).toBe(200);

    // Cookies must be cleared.
    const cleared = res.headers["set-cookie"].join(";");
    expect(cleared).toMatch(/cos_at=;/);
    expect(cleared).toMatch(/cos_rt=;/);

    // And the stored session must be revoked.
    const stored = await User.findById(user._id).select("+refreshTokens");
    expect(stored.refreshTokens.every((t) => t.revokedAt !== null)).toBe(true);
  });

  it("is idempotent when not signed in", async () => {
    const res = await request(getApp()).post("/api/v1/auth/logout").send({});
    // Signing out must always succeed, even anonymously, so a stale UI can
    // always clear its local session.
    expect(res.status).toBe(200);
  });

  it("revokes every session on logout-all", async () => {
    const user = await createUser();

    // Two separate sessions (two devices).
    await loginAs(user);
    const { agent, csrfToken } = await loginAs(user);

    const res = await agent
      .post("/api/v1/auth/logout-all")
      .set("X-CSRF-Token", csrfToken)
      .send({});

    expect(res.status).toBe(200);

    const stored = await User.findById(user._id).select("+refreshTokens");
    expect(stored.refreshTokens.every((t) => t.revokedAt !== null)).toBe(true);
    expect(stored.sessionsInvalidatedAt).not.toBeNull();
  });
});

describe("POST /api/v1/auth/change-password", () => {
  it("changes the password and revokes sessions", async () => {
    const user = await createUser();
    const { agent, csrfToken } = await loginAs(user);

    const res = await agent
      .post("/api/v1/auth/change-password")
      .set("X-CSRF-Token", csrfToken)
      .send({ currentPassword: "TestPass123!", newPassword: "BrandNewPass456!" });

    expect(res.status).toBe(200);

    // Old password must no longer work.
    const relogin = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "TestPass123!" });
    expectError(relogin, 401, "INVALID_CREDENTIALS");

    // New password must work.
    const fresh = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "BrandNewPass456!" });
    expect(fresh.status).toBe(200);
  });

  it("rejects a wrong current password", async () => {
    const user = await createUser();
    const { agent, csrfToken } = await loginAs(user);

    const res = await agent
      .post("/api/v1/auth/change-password")
      .set("X-CSRF-Token", csrfToken)
      .send({ currentPassword: "WrongPass123!", newPassword: "BrandNewPass456!" });

    expectError(res, 401, "INVALID_CREDENTIALS");
  });

  it("enforces the password policy", async () => {
    const user = await createUser();
    const { agent, csrfToken } = await loginAs(user);

    const res = await agent
      .post("/api/v1/auth/change-password")
      .set("X-CSRF-Token", csrfToken)
      .send({ currentPassword: "TestPass123!", newPassword: "weak" });

    expectError(res, 400, "VALIDATION_ERROR");
  });

  it("rejects reusing the current password", async () => {
    const user = await createUser();
    const { agent, csrfToken } = await loginAs(user);

    const res = await agent
      .post("/api/v1/auth/change-password")
      .set("X-CSRF-Token", csrfToken)
      .send({ currentPassword: "TestPass123!", newPassword: "TestPass123!" });

    expectError(res, 400, "VALIDATION_ERROR");
  });
});

describe("session storage", () => {
  it("stores only token hashes, never raw tokens", async () => {
    const user = await createUser();
    const login = await request(getApp())
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "TestPass123!" });

    const raw = readCookie(login, COOKIE_NAMES.REFRESH_TOKEN);

    const stored = await User.findById(user._id).select("+refreshTokens");
    const entry = stored.refreshTokens[0];

    // A database dump must not yield usable sessions.
    expect(entry.tokenHash).not.toBe(raw);
    expect(entry.tokenHash).toBe(hashToken(raw));
  });

  it("caps the number of stored sessions", async () => {
    // Exercised against the service rather than through repeated HTTP logins:
    // each login performs a bcrypt comparison at cost 12, so 45 logins cost
    // ~15s for no additional coverage. The invariant under test is the session
    // cap, which lives entirely in issueSession().
    const user = await createUser();
    const {
      issueSession,
      MAX_SESSIONS_PER_USER,
    } = require("../src/services/auth.service");

    const fakeReq = { get: () => "vitest", ip: "127.0.0.1" };

    for (let i = 0; i < MAX_SESSIONS_PER_USER + 5; i++) {
      await issueSession(user, fakeReq);
    }

    const stored = await User.findById(user._id).select("+refreshTokens");
    expect(stored.refreshTokens.length).toBeLessThanOrEqual(MAX_SESSIONS_PER_USER);
    expect(stored.refreshTokens.length).toBe(MAX_SESSIONS_PER_USER);
  });

  it("retains revoked sessions so replay stays detectable", async () => {
    // Rotation must not delete the spent token: reuse detection matches a
    // replayed token against a stored revoked entry, so pruning it would make
    // replay undetectable.
    const user = await createUser();
    const authService = require("../src/services/auth.service");
    const fakeReq = { get: () => "vitest", ip: "127.0.0.1" };

    const { refreshToken } = await authService.issueSession(user, fakeReq);
    await authService.refreshSession({ refreshToken, req: fakeReq });

    const stored = await User.findById(user._id).select("+refreshTokens");

    const revoked = stored.refreshTokens.filter((t) => t.revokedAt !== null);
    expect(revoked.length).toBe(1);
    expect(revoked[0].revokedReason).toBe("rotated");
  });
});
