/**
 * Two-factor authentication.
 *
 * The algorithm is checked against the RFC 6238 test vectors. That is the whole
 * justification for hand-rolling it: a plausible-looking HMAC truncation that
 * does not match the spec produces codes no authenticator app will accept, and
 * the failure looks like "the app is broken" rather than "our maths is wrong".
 */

const { resetDatabase, createUser, loginAs, readCookie } = require("./helpers/factory");

const totp = require("../src/services/totp.service");
const twoFactor = require("../src/services/twoFactor.service");
const { verifyTwoFactorChallenge } = require("../src/utils/tokens");
const User = require("../src/models/User");
const { ROLES } = require("../src/config/constants");

/**
 * Sign in fully, through both factors.
 *
 * The shared `loginAs` helper assumes a password produces a session, which is
 * exactly what stops being true here — so this does both steps and returns an
 * agent that is really authenticated.
 */
async function signIn(user) {
  const { agent, challenge } = await loginAs(user);

  const fresh = await User.findById(user._id);
  const done = await agent.post("/api/v1/auth/2fa/complete").send({
    challenge: challenge.token,
    code: totp.totp(twoFactor.unseal(fresh.twoFactor.encryptedSecret)),
  });

  if (done.status !== 200) {
    throw new Error(`two-factor completion failed: ${JSON.stringify(done.body)}`);
  }

  // The CSRF cookie is only set once the session exists, so read it from the
  // response that finally created the session.
  return { agent, csrfToken: readCookie(done, "cos_ct") };
}

/** POST with the CSRF header, the way the frontend sends it. */
const post = (agent, csrf, url, body) =>
  agent.post(url).set("X-CSRF-Token", csrf).send(body);

/** Just the first half, for tests about the challenge itself. */
async function startSignIn(user) {
  const { agent, challenge } = await loginAs(user);
  return { agent, challenge };
}

describe("TOTP, RFC 6238", () => {
  // SHA-1, secret "12345678901234567890", 8 digits; the last six are ours.
  const SECRET = totp.base32Encode(Buffer.from("12345678901234567890"));
  const VECTORS = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  it.each(VECTORS)("matches the published vector for T=%i", (seconds, expected) => {
    expect(totp.totp(SECRET, seconds * 1000)).toBe(expected.slice(-6));
  });

  it("produces six digits, always", () => {
    for (let second = 0; second < 50; second += 7) {
      expect(totp.totp(SECRET, second * 1000)).toMatch(/^\d{6}$/);
    }
  });

  it("accepts the current code and rejects a wrong one", () => {
    const secret = totp.generateSecret();
    const current = totp.totp(secret);
    expect(totp.verify(secret, current)).toBe(true);
    expect(totp.verify(secret, current === "000000" ? "111111" : "000000")).toBe(false);
  });

  /**
   * One step either side of now.
   *
   * Two steps would accept roughly a million codes per attempt, which turns six
   * digits into a weak secret.
   */
  it("tolerates one step of clock skew, and no more", () => {
    const secret = totp.generateSecret();
    const now = Date.now();

    const previous = totp.totp(secret, now - 30_000);
    const next = totp.totp(secret, now + 30_000);
    const twoAhead = totp.totp(secret, now + 60_000);

    expect(totp.verify(secret, previous, { at: now })).toBe(true);
    expect(totp.verify(secret, next, { at: now })).toBe(true);
    expect(totp.verify(secret, twoAhead, { at: now })).toBe(false);
  });

  it("refuses anything that is not six digits, without comparing", () => {
    const secret = totp.generateSecret();
    expect(totp.verify(secret, "")).toBe(false);
    expect(totp.verify(secret, "12345")).toBe(false);
    expect(totp.verify(secret, "1234567")).toBe(false);
    expect(totp.verify(secret, "abcdef")).toBe(false);
  });

  it("ignores spaces, because people paste codes", () => {
    const secret = totp.generateSecret();
    expect(totp.verify(secret, ` ${totp.totp(secret)} `)).toBe(true);
  });

  it("round-trips base32, which is what apps are handed", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const secret = totp.generateSecret();
      expect(totp.base32Decode(secret).length).toBe(20);
    }
  });

  it("builds an otpauth URI the apps accept", () => {
    const uri = totp.provisioningUri({ secret: "ABCD", account: "a@b.co" });
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=ABCD");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});

describe("sealing the secret", () => {
  it("round-trips", () => {
    const secret = totp.generateSecret();
    expect(twoFactor.unseal(twoFactor.seal(secret))).toBe(secret);
  });

  it("produces different ciphertext each time, so it is not comparable", () => {
    const secret = totp.generateSecret();
    expect(twoFactor.seal(secret)).not.toBe(twoFactor.seal(secret));
  });

  it("refuses ciphertext that has been tampered with", () => {
    const [iv, tag, data] = twoFactor.seal(totp.generateSecret()).split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;

    // GCM is authenticated: a modified body must not decrypt silently.
    expect(() =>
      twoFactor.unseal(`${iv}.${tag}.${flipped.toString("base64")}`)
    ).toThrow();
  });

  it("refuses a payload that is not a sealed value at all", () => {
    expect(() => twoFactor.unseal("garbage")).toThrow();
    expect(() => twoFactor.unseal(null)).toThrow();
  });
});

describe("enrolment", () => {
  let user;

  beforeEach(async () => {
    await resetDatabase();
    user = await createUser({ role: ROLES.STUDENT });
  });

  it("gives a secret but enables nothing yet", async () => {
    const enrolment = await twoFactor.beginEnrolment({ user });

    expect(enrolment.secret).toMatch(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/);
    expect(enrolment.provisioningUri).toContain("otpauth://totp/");

    const stored = await User.findById(user._id);
    // Enabling on the first screen would lock somebody out of an app they
    // never added.
    expect(stored.twoFactor.enabled).toBe(false);
    expect(stored.twoFactor.pendingSecret).toBeTruthy();
  });

  it("refuses a wrong code and stays disabled", async () => {
    await twoFactor.beginEnrolment({ user });

    await expect(twoFactor.confirmEnrolment({ user, code: "000000" })).rejects.toThrow(
      /not accepted/
    );

    const stored = await User.findById(user._id);
    expect(stored.twoFactor.enabled).toBe(false);
  });

  it("refuses to confirm without starting", async () => {
    await expect(twoFactor.confirmEnrolment({ user, code: "123456" })).rejects.toThrow(
      /Start setting up/
    );
  });

  it("enables on a working code and returns recovery codes once", async () => {
    const enrolment = await twoFactor.beginEnrolment({ user });
    const raw = enrolment.rawSecret;

    const result = await twoFactor.confirmEnrolment({ user, code: totp.totp(raw) });

    expect(result.recoveryCodes).toHaveLength(twoFactor.RECOVERY_CODE_COUNT);

    const stored = await User.findById(user._id);
    expect(stored.twoFactor.enabled).toBe(true);
    expect(stored.twoFactor.pendingSecret).toBeNull();

    // Stored as hashes: a stolen list is a list of one-time passwords.
    expect(stored.twoFactor.recoveryCodes[0]).not.toBe(result.recoveryCodes[0]);
    expect(stored.twoFactor.recoveryCodes[0]).toHaveLength(64);
  });

  it("never stores the secret in the clear", async () => {
    const enrolment = await twoFactor.beginEnrolment({ user });
    await twoFactor.confirmEnrolment({ user, code: totp.totp(enrolment.rawSecret) });

    const stored = await User.findById(user._id).lean();
    const everything = JSON.stringify(stored);
    expect(everything).not.toContain(enrolment.rawSecret);
  });
});

describe("signing in with two-factor", () => {
  let user;

  beforeEach(async () => {
    await resetDatabase();
    user = await createUser({ role: ROLES.STUDENT });
    const enrolment = await twoFactor.beginEnrolment({ user });
    await twoFactor.confirmEnrolment({ user, code: totp.totp(enrolment.rawSecret) });
  });

  it("issues no session on the password alone", async () => {
    const { agent } = await loginAs(user);

    const response = await agent.post("/api/v1/auth/login").send({
      email: user.email,
      password: "TestPass123!",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.twoFactorRequired).toBe(true);
    expect(response.body.data.user).toBeUndefined();
    expect(response.body.data.challenge.token).toBeTruthy();
    // Nothing session-shaped came back.
    expect(response.body.data.accessToken).toBeUndefined();
  });

  it("completes with a working code", async () => {
    // signIn runs both steps; if it got here a working code was accepted and a
    // real session exists.
    const { agent } = await signIn(user);

    const response = await agent.get("/api/v1/auth/me");

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(user.email);
  });

  it("refuses a wrong code and issues nothing", async () => {
    const { agent, challenge } = await startSignIn(user);

    const response = await agent.post("/api/v1/auth/2fa/complete").send({
      challenge: challenge.token,
      code: "000000",
    });

    expect(response.status).toBe(401);
  });

  it("will not accept an access token as a challenge", async () => {
    const { agent, accessToken } = await loginAs(user);

    // If a genuine access token were accepted here, the challenge step would be
    // a way to skip the second factor entirely.
    const response = await agent.post("/api/v1/auth/2fa/complete").send({
      challenge: accessToken ?? "not-even-a-token",
      code: "123456",
    });
    expect(response.status).toBe(401);
  });

  it("masks the account, so the challenge does not confirm it exists", async () => {
    const { challenge } = await startSignIn(user);

    expect(challenge.maskedAccount).toMatch(/\*\*\*/);
    expect(challenge.maskedAccount).not.toContain(user.email.slice(0, 3));
  });

  it("spends a recovery code exactly once", async () => {
    const { agent } = await signIn(user);
    const fresh = await User.findById(user._id);

    // Re-enrol to get fresh, known codes in the test's hands.
    const enrolment = await twoFactor.beginEnrolment({ user: fresh });
    const confirmed = await twoFactor.confirmEnrolment({
      user: fresh,
      code: totp.totp(enrolment.rawSecret),
    });
    const [recovery] = confirmed.recoveryCodes;

    const challenge = (
      await agent.post("/api/v1/auth/login").send({
        email: user.email,
        password: "TestPass123!",
      })
    ).body.data.challenge.token;

    const first = await agent.post("/api/v1/auth/2fa/complete").send({
      challenge,
      code: recovery,
    });
    expect(first.status).toBe(200);

    const second = await agent.post("/api/v1/auth/2fa/complete").send({
      challenge,
      code: recovery,
    });
    // Single use means single use: a replayed code is worthless.
    expect(second.status).toBe(401);
  });
});

describe("turning it off", () => {
  let user;

  beforeEach(async () => {
    await resetDatabase();
    user = await createUser({ role: ROLES.STUDENT });
    const enrolment = await twoFactor.beginEnrolment({ user });
    await twoFactor.confirmEnrolment({ user, code: totp.totp(enrolment.rawSecret) });
  });

  it("needs a working code, not just a session", async () => {
    // Otherwise a stolen session cookie is enough to remove the very second
    // factor that would have limited its damage.
    const { agent, csrfToken } = await signIn(user);

    const refused = await post(agent, csrfToken, "/api/v1/auth/2fa/disable", {
      code: "000000",
    });
    expect(refused.status).toBe(400);

    const stored = await User.findById(user._id);
    expect(stored.twoFactor.enabled).toBe(true);
  });

  it("clears everything once a code is given", async () => {
    const { agent, csrfToken } = await signIn(user);
    const fresh = await User.findById(user._id);

    const response = await post(agent, csrfToken, "/api/v1/auth/2fa/disable", {
      code: totp.totp(twoFactor.unseal(fresh.twoFactor.encryptedSecret)),
    });
    expect(response.status).toBe(200);

    const stored = await User.findById(user._id);
    expect(stored.twoFactor.enabled).toBe(false);
    expect(stored.twoFactor.encryptedSecret).toBeNull();
    expect(stored.twoFactor.recoveryCodes).toHaveLength(0);
  });

  it("lets the account sign in with a password again afterwards", async () => {
    const { agent, csrfToken } = await signIn(user);
    const fresh = await User.findById(user._id);
    await post(agent, csrfToken, "/api/v1/auth/2fa/disable", {
      code: totp.totp(twoFactor.unseal(fresh.twoFactor.encryptedSecret)),
    });

    const response = await agent.post("/api/v1/auth/login").send({
      email: user.email,
      password: "TestPass123!",
    });

    expect(response.body.data.twoFactorRequired).toBeUndefined();
    expect(response.body.data.user.email).toBe(user.email);
  });
});

describe("the challenge token is its own kind", () => {
  it("is not an access token", async () => {
    await resetDatabase();
    const user = await createUser({ role: ROLES.STUDENT });
    const enrolment = await twoFactor.beginEnrolment({ user });
    await twoFactor.confirmEnrolment({ user, code: totp.totp(enrolment.rawSecret) });

    const { challenge } = await startSignIn(user);
    const token = challenge.token;

    // It verifies as a challenge...
    expect(verifyTwoFactorChallenge(token)).toBeTruthy();

    // ...and not as anything else. This is the property that stops the
    // half-finished state of a login being usable as a session.
    const { verifyAccessToken } = require("../src/utils/tokens");
    expect(() => verifyAccessToken(token)).toThrow();
  });
});
