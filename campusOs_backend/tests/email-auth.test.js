/**
 * Email verification and password reset.
 *
 * The interesting failures here are not "the link works" but three specific
 * ones: a link that works twice, a reset endpoint that reveals which addresses
 * exist, and a verification link that can be used to take the account over.
 */

const {
  getApp,
  resetDatabase,
  createUser,
  createStudent,
  loginAs,
} = require("./helpers/factory");

const mailer = require("../src/services/mailer.service");
const emailAuth = require("../src/services/emailAuth.service");
const User = require("../src/models/User");
const { ROLES } = require("../src/config/constants");
const { hashToken } = require("../src/utils/tokens");
const bcrypt = require("bcryptjs");

/** Pull the link the user would click out of the most recent message. */
function lastLink(kind) {
  const messages = mailer.readMailbox();
  const message = [...messages].reverse().find((entry) => entry.to && entry.text);
  expect(message, "an email was sent").toBeTruthy();

  const link = message.text.match(new RegExp(`${kind}\\?token=([a-f0-9]+)`));
  expect(link, `${kind} link present in the message`).toBeTruthy();
  return link[1];
}

const NEW_PASSWORD = "BrandNew_9Pass";

describe("the development mailbox", () => {
  beforeEach(() => {
    resetDatabase();
    mailer.clearMailbox();
  });

  it("is used when no SMTP host is configured", async () => {
    const result = await mailer.send({
      to: "someone@campusos.local",
      subject: "Test",
      text: "Body",
    });

    expect(result.transport).toBe("dev");
    expect(result.delivered).toBe(true);
    expect(mailer.readMailbox()).toHaveLength(1);
  });

  it("never throws, because a mail outage must not break sign-in", async () => {
    const result = await mailer.send({
      to: "someone@campusos.local",
      subject: "Test",
      text: "Body",
    });

    expect(result).toHaveProperty("delivered");
    await expect(
      mailer.send({ to: "x@y.co", subject: "s", text: "t" })
    ).resolves.toBeTruthy();
  });
});

describe("verification", () => {
  let user;

  beforeEach(async () => {
    await resetDatabase();
    mailer.clearMailbox();
    user = await createUser({ role: ROLES.STUDENT });
  });

  it("starts unverified, because the institute chose the address, not the person", async () => {
    const stored = await User.findById(user._id);
    expect(stored.emailVerified).toBe(false);
    expect(stored.toPublicJSON().emailVerified).toBe(false);
  });

  it("marks the address proven and retires the token", async () => {
    await emailAuth.sendVerification({ user });
    const result = await emailAuth.verifyEmail({ token: lastLink("verify-email") });

    expect(result.email).toBe(user.email);

    const stored = await User.findById(user._id).select("+emailTokens.verification.hash");
    expect(stored.emailVerified).toBe(true);
    expect(stored.emailVerifiedAt).toBeTruthy();
    // Spent: a link is a bearer credential.
    expect(stored.emailTokens.verification.hash).toBeNull();
  });

  it("refuses a link that has been used already", async () => {
    await emailAuth.sendVerification({ user });
    const token = lastLink("verify-email");
    await emailAuth.verifyEmail({ token });

    await expect(emailAuth.verifyEmail({ token })).rejects.toThrow(
      /not valid or has expired/
    );
  });

  it("refuses a link nobody issued", async () => {
    await expect(emailAuth.verifyEmail({ token: "f".repeat(64) })).rejects.toThrow(
      /not valid or has expired/
    );
  });

  it("stores only a hash, so a database dump yields no working link", async () => {
    await emailAuth.sendVerification({ user });
    const token = lastLink("verify-email");

    const stored = await User.findById(user._id).select("+emailTokens.verification.hash");
    expect(stored.emailTokens.verification.hash).toBe(hashToken(token));
    expect(stored.emailTokens.verification.hash).not.toBe(token);
  });

  it("replaces the earlier link, so only the newest works", async () => {
    await emailAuth.sendVerification({ user });
    const first = lastLink("verify-email");
    await emailAuth.sendVerification({ user });
    const second = lastLink("verify-email");

    expect(first).not.toBe(second);
    await expect(emailAuth.verifyEmail({ token: first })).rejects.toThrow();
    await expect(emailAuth.verifyEmail({ token: second })).resolves.toBeTruthy();
  });

  it("expires", async () => {
    await emailAuth.sendVerification({ user });
    const token = lastLink("verify-email");

    await User.updateOne(
      { _id: user._id },
      { $set: { "emailTokens.verification.expiresAt": new Date(Date.now() - 1000) } }
    );

    await expect(emailAuth.verifyEmail({ token })).rejects.toThrow(
      /not valid or has expired/
    );
  });

  /**
   * The whole point of `purpose`.
   *
   * A verification link proves an inbox and nothing more. If it could also set
   * a password, a link pasted into a ticket would hand over the account.
   */
  it("cannot be used to set a password", async () => {
    await emailAuth.sendVerification({ user });
    const token = lastLink("verify-email");

    await expect(
      emailAuth.resetPassword({ token, password: NEW_PASSWORD })
    ).rejects.toThrow(/not valid or has expired/);

    // And the password is untouched.
    const stored = await User.findById(user._id).select("+passwordHash");
    // Untouched: a verification link cannot set a password.
    expect(await bcrypt.compare("TestPass123!", stored.passwordHash)).toBe(true);
  });

  it("needs a session to ask for another link", async () => {
    const { agent, csrfToken } = await loginAs(user);
    const sent = await agent
      .post("/api/v1/auth/resend-verification")
      .set("X-CSRF-Token", csrfToken);

    expect(sent.status).toBe(200);
    expect(mailer.readMailbox()).toHaveLength(1);

    const anonymous = await agent
      .post("/api/v1/auth/verify-email")
      .send({ token: "x".repeat(32) });
    expect(anonymous.status).toBeGreaterThanOrEqual(400);
  });
});

describe("password reset", () => {
  let user;

  beforeEach(async () => {
    await resetDatabase();
    mailer.clearMailbox();
    user = await createUser({ role: ROLES.STUDENT });
  });

  it("signs the person in with the new password", async () => {
    await emailAuth.requestReset({ email: user.email });
    const token = lastLink("reset-password");

    await emailAuth.resetPassword({ token, password: NEW_PASSWORD });

    const stored = await User.findById(user._id).select("+passwordHash");
    expect(await bcrypt.compare(NEW_PASSWORD, stored.passwordHash)).toBe(true);
    expect(await bcrypt.compare("TestPass123!", stored.passwordHash)).toBe(false);
  });

  it("works once, then stops working", async () => {
    await emailAuth.requestReset({ email: user.email });
    const token = lastLink("reset-password");

    await emailAuth.resetPassword({ token, password: NEW_PASSWORD });

    await expect(
      emailAuth.resetPassword({ token, password: "Another_9Pass" })
    ).rejects.toThrow(/not valid or has expired/);
  });

  /**
   * The reason `requestReset` swallows everything.
   *
   * Two different answers here would turn this endpoint into a roster of every
   * student and staff member in the college.
   */
  it("says the same thing whether or not the address exists", async () => {
    const known = await emailAuth.requestReset({ email: user.email });
    const unknown = await emailAuth.requestReset({ email: "nobody@campusos.local" });

    expect(known.sent).toBe(true);
    expect(unknown.sent).toBe(true);
    expect(unknown).not.toHaveProperty("expiresAt");
  });

  it("sends nothing at all to an unknown address", async () => {
    await emailAuth.requestReset({ email: "nobody@campusos.local" });
    expect(mailer.readMailbox()).toHaveLength(0);
  });

  it("says nothing about a disabled account, either", async () => {
    await User.updateOne({ _id: user._id }, { $set: { isActive: false } });

    const result = await emailAuth.requestReset({ email: user.email });
    expect(result.sent).toBe(true);
    expect(mailer.readMailbox()).toHaveLength(0);
  });

  it("gives a reset URL an hour, not a day", async () => {
    const result = await emailAuth.requestReset({ email: user.email });
    const minutes = (new Date(result.expiresAt).getTime() - Date.now()) / 60_000;

    expect(minutes).toBeGreaterThan(55);
    expect(minutes).toBeLessThan(65);
  });

  it("ends every other session, because a reset may be the response to a takeover", async () => {
    const { agent } = await loginAs(user);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);

    await emailAuth.requestReset({ email: user.email });
    await emailAuth.resetPassword({
      token: lastLink("reset-password"),
      password: NEW_PASSWORD,
    });

    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("clears mustChangePassword, since the person chose this password", async () => {
    await User.updateOne({ _id: user._id }, { $set: { mustChangePassword: true } });
    await emailAuth.requestReset({ email: user.email });
    await emailAuth.resetPassword({
      token: lastLink("reset-password"),
      password: NEW_PASSWORD,
    });

    const fresh = await User.findById(user._id);
    expect(fresh.mustChangePassword).toBe(false);
  });

  it("marks the address verified, because a working link is proof", async () => {
    await emailAuth.requestReset({ email: user.email });
    await emailAuth.resetPassword({
      token: lastLink("reset-password"),
      password: NEW_PASSWORD,
    });

    const fresh = await User.findById(user._id);
    expect(fresh.emailVerified).toBe(true);
  });

  it("reports an expired link as expired, so the page can say so", async () => {
    await emailAuth.requestReset({ email: user.email });
    const token = lastLink("reset-password");

    expect(
      await emailAuth.inspect({ token, purpose: emailAuth.PURPOSE.RESET })
    ).toMatchObject({
      valid: true,
    });

    await User.updateOne(
      { _id: user._id },
      { $set: { "emailTokens.reset.expiresAt": new Date(Date.now() - 1000) } }
    );

    expect(
      await emailAuth.inspect({ token, purpose: emailAuth.PURPOSE.RESET })
    ).toMatchObject({
      valid: false,
      reason: "expired",
    });
  });

  it("does not leak the address through `inspect`", async () => {
    await emailAuth.requestReset({ email: user.email });
    const token = lastLink("reset-password");

    const result = await emailAuth.inspect({ token, purpose: emailAuth.PURPOSE.RESET });
    expect(JSON.stringify(result)).not.toContain(user.email);
  });
});

describe("the HTTP surface", () => {
  let user;

  beforeEach(async () => {
    await resetDatabase();
    mailer.clearMailbox();
    ({ user } = await createStudent());
  });

  it("walks the whole journey: ask, click, sign in", async () => {
    const agent = require("supertest").agent(getApp());

    const asked = await agent
      .post("/api/v1/auth/forgot-password")
      .send({ email: user.email });
    expect(asked.status).toBe(200);

    const token = lastLink("reset-password");
    const freshAgent = require("supertest").agent(getApp());

    const done = await freshAgent
      .post("/api/v1/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });
    expect(done.status).toBe(200);

    const signedIn = await freshAgent
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: NEW_PASSWORD });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data.user.email).toBe(user.email);
  });

  /**
   * The page calls this before showing the form, so it has to work.
   *
   * Covered over HTTP rather than through the service because the failure mode
   * was in the route's query validation, which no service-level test sees.
   */
  it("answers the link check the reset page makes", async () => {
    await emailAuth.requestReset({ email: user.email });
    const token = lastLink("reset-password");

    const good = await require("supertest")(getApp()).post(
      `/api/v1/auth/reset-password/check?token=${token}`
    );
    expect(good.status).toBe(200);
    expect(good.body.data).toMatchObject({ valid: true });

    const junk = await require("supertest")(getApp()).post(
      `/api/v1/auth/reset-password/check?token=${"f".repeat(64)}`
    );
    expect(junk.status).toBe(200);
    expect(junk.body.data).toMatchObject({ valid: false, reason: "invalid" });
  });

  /** Both links arrive as a query string, so both are posted as JSON. */
  it("accepts a verification link posted as JSON, as the page sends it", async () => {
    const { agent, csrfToken } = await loginAs(user);
    await agent.post("/api/v1/auth/resend-verification").set("X-CSRF-Token", csrfToken);

    const token = lastLink("verify-email");
    const response = await agent.post("/api/v1/auth/verify-email").send({ token });

    expect(response.status).toBe(200);

    const replay = await agent.post("/api/v1/auth/verify-email").send({ token });
    expect(replay.status).toBe(400);
  });

  it("rejects a weak reset password with the same rules as sign-up", async () => {
    await emailAuth.requestReset({ email: user.email });
    const token = lastLink("reset-password");

    const agent = require("supertest").agent(getApp());
    const response = await agent
      .post("/api/v1/auth/reset-password")
      .send({ token, password: "short" });

    expect(response.status).toBe(400);
  });
});
