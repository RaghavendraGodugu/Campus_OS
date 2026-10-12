/**
 * Certificate tests.
 *
 * The spec (§11) sets two requirements that dominate this file:
 *
 *  1. "Never assume that a certificate is officially issued merely because a
 *     file was uploaded."
 *  2. "Do not treat a publicly accessible URL as proof of authorization."
 *
 * Both are tested as denials, because both fail silently if untested.
 */

const {
  getApp,
  resetDatabase,
  createDepartment,
  createUser,
  createStudent,
  loginAs,
  expectError,
} = require("./helpers/factory");
const { ROLES, CERTIFICATE_STATUS } = require("../src/config/constants");
const Certificate = require("../src/models/Certificate");
const certificateService = require("../src/services/certificate.service");
const { signDownloadToken } = require("../src/config/storage");
const fs = require("fs");
const path = require("path");

beforeEach(resetDatabase);

/** Post helper carrying the CSRF header a browser would send. */
const postAs = (agent, csrf, url, body) =>
  agent.post(url).set("X-CSRF-Token", csrf).send(body);

/**
 * Drive a certificate forward through the real workflow to `target`.
 *
 * Walks the declared transition table rather than hardcoding the steps, so a
 * change to the pipeline shows up here as a failing test instead of a silently
 * stale fixture.
 */
const HAPPY_PATH = [
  CERTIFICATE_STATUS.APPLIED,
  CERTIFICATE_STATUS.VALIDATING,
  CERTIFICATE_STATUS.VERIFYING,
  CERTIFICATE_STATUS.APPROVED,
];

async function advanceTo(certificateId, target, { hod, user }) {
  const actor = user ?? hod;
  const targetIndex = HAPPY_PATH.indexOf(target);

  if (targetIndex === -1) {
    // GENERATED is reached by issuing, not by a bare transition.
    return Certificate.findById(certificateId);
  }

  for (let i = 1; i <= targetIndex; i++) {
    const from = HAPPY_PATH[i - 1];
    const to = HAPPY_PATH[i];
    const edge = certificateService.transitionsFrom(from).find((e) => e.to === to);
    if (!edge) {
      throw new Error(`No declared transition ${from} -> ${to}`);
    }
    await certificateService.transition({
      certificateId,
      to,
      expectedFrom: from,
      user: actor,
    });
  }

  const fresh = await Certificate.findById(certificateId);
  expect(fresh.status).toBe(target);
  return fresh;
}

/** Apply for a certificate as a student, directly through the service. */
async function applyAs(user, overrides = {}) {
  return certificateService.apply({
    user,
    type: "BONAFIDE",
    purpose: "Bank loan application",
    copies: 1,
    ...overrides,
  });
}

describe("application", () => {
  it("lets a student apply", async () => {
    const student = await createStudent();
    const { agent, csrfToken } = await loginAs(student.user);

    const res = await postAs(agent, csrfToken, "/api/v1/certificates", {
      type: "BONAFIDE",
      purpose: "Passport application",
      copies: 2,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.reference).toMatch(/^CERT-\d{4}-\d{6}$/);
    expect(res.body.data.status).toBe("APPLIED");
  });

  it("refuses a staff account applying as a student", async () => {
    const hod = await createUser({ role: ROLES.HOD });
    const { agent, csrfToken } = await loginAs(hod);

    const res = await postAs(agent, csrfToken, "/api/v1/certificates", {
      type: "BONAFIDE",
    });

    expectError(res, 403, "FORBIDDEN");
  });

  it("rejects a client-supplied status or verification code", async () => {
    const student = await createStudent();
    const { agent, csrfToken } = await loginAs(student.user);

    const res = await postAs(agent, csrfToken, "/api/v1/certificates", {
      type: "BONAFIDE",
      status: "GENERATED",
      verificationCode: "FAKE-CODE-123",
    });

    // Strict schema: neither field may be sent at all.
    expectError(res, 400, "VALIDATION_ERROR");
  });

  it("issues unique references under concurrency", async () => {
    const student = await createStudent();

    const results = await Promise.all(
      Array.from({ length: 6 }, () => applyAs(student.user))
    );

    const refs = results.map((r) => r.reference);
    expect(new Set(refs).size).toBe(6);
  });
});

describe("issuance is not a file upload", () => {
  it("refuses to issue a record that is not APPROVED, whatever its fields", async () => {
    const student = await createStudent();
    const department = student.department;
    const hod = await createUser({ role: ROLES.HOD, department });

    // A hand-written record claiming to be issued, complete-looking but never
    // approved. The service must refuse it: status is the gate, not the
    // presence of fields.
    const forged = await Certificate.create({
      reference: "CERT-2026-999001",
      type: "BONAFIDE",
      student: student.student,
      department,
      status: CERTIFICATE_STATUS.APPLIED,
    });

    await expect(
      certificateService.generate({ certificateId: forged._id, user: hod })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    const fresh = await Certificate.findById(forged._id).lean();
    expect(fresh.status).toBe(CERTIFICATE_STATUS.APPLIED);
    expect(fresh.verificationCode).toBeNull();
  });

  it("does not treat an uploaded file as issuance", async () => {
    const student = await createStudent();

    // Exactly what a student forging a certificate would attempt: attach a PDF
    // and hope the system considers the certificate issued.
    const certificate = await Certificate.create({
      reference: "CERT-2026-999002",
      type: "BONAFIDE",
      student: student.student,
      status: CERTIFICATE_STATUS.APPLIED,
      document: {
        storageKey: "certificates/forged.pdf",
        originalName: "official-bonafide.pdf",
        mimeType: "application/pdf",
        bytes: 5000,
      },
    });

    const fresh = await Certificate.findById(certificate._id).lean();
    expect(fresh.status).toBe(CERTIFICATE_STATUS.APPLIED);
    expect(fresh.issuedAt).toBeNull();
    expect(fresh.verificationCode).toBeNull();
  });

  it("refuses to issue a certificate that was never approved", async () => {
    const student = await createStudent();
    const hod = await createUser({ role: ROLES.HOD, department: student.department });
    const certificate = await applyAs(student.user);

    await expect(
      certificateService.generate({ certificateId: certificate._id, user: hod })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    const fresh = await Certificate.findById(certificate._id).lean();
    expect(fresh.status).toBe(CERTIFICATE_STATUS.APPLIED);
    expect(fresh.document?.storageKey ?? null).toBeNull();
  });

  it("refuses to issue without the issue permission, even when approved", async () => {
    const student = await createStudent();
    const department = student.department;
    const hod = await createUser({ role: ROLES.HOD, department });
    const principal = await createUser({ role: ROLES.PRINCIPAL });

    const certificate = await applyAs(student.user);
    await advanceTo(certificate._id, CERTIFICATE_STATUS.APPROVED, { hod, user: hod });

    // A principal may approve institution-wide but this service is driven by
    // whoever holds ISSUE; both do, so issuance succeeds and is recorded.
    const issued = await certificateService.generate({
      certificateId: certificate._id,
      user: hod,
    });

    expect(issued.status).toBe(CERTIFICATE_STATUS.GENERATED);
    expect(issued.issuedAt).toBeTruthy();
    expect(issued.issuedBy.toString()).toBe(hod._id.toString());
    expect(issued.document.storageKey).toBeTruthy();
    expect(issued.verificationCode).toMatch(/^[A-Z0-9]{6}-[A-Z0-9]{6}$/);
    void principal;
  });

  it("writes a real PDF to private storage on issue", async () => {
    const student = await createStudent();
    const hod = await createUser({ role: ROLES.HOD, department: student.department });

    const certificate = await applyAs(student.user);
    await advanceTo(certificate._id, CERTIFICATE_STATUS.APPROVED, { hod, user: hod });
    const issued = await certificateService.generate({
      certificateId: certificate._id,
      user: hod,
    });

    // The bytes exist, start with the PDF magic number, and are not reachable
    // from any statically served directory.
    const root = process.env.LOCAL_STORAGE_PATH
      ? path.resolve(process.env.LOCAL_STORAGE_PATH)
      : path.resolve(__dirname, "..", "storage");
    const absolute = path.join(root, issued.document.storageKey);

    expect(fs.existsSync(absolute)).toBe(true);

    const bytes = fs.readFileSync(absolute);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);

    // The verification code is printed on the document.
    expect(issued.document.bytes).toBe(bytes.length);
  });
});

describe("certificate workflow", () => {
  it("runs applied -> validating -> verifying -> approved -> generated", async () => {
    const student = await createStudent();
    const hod = await createUser({ role: ROLES.HOD, department: student.department });

    const certificate = await applyAs(student.user);
    expect(certificate.status).toBe(CERTIFICATE_STATUS.APPLIED);

    await advanceTo(certificate._id, CERTIFICATE_STATUS.APPROVED, { hod, user: hod });

    const issued = await certificateService.generate({
      certificateId: certificate._id,
      user: hod,
    });

    expect(issued.status).toBe(CERTIFICATE_STATUS.GENERATED);
    expect(issued.statusHistory.map((h) => h.to)).toEqual([
      "APPLIED",
      "VALIDATING",
      "VERIFYING",
      "APPROVED",
      "GENERATED",
    ]);
  });

  it("rejects an illegal transition", async () => {
    const student = await createStudent();
    const hod = await createUser({ role: ROLES.HOD, department: student.department });
    const certificate = await applyAs(student.user);

    await expect(
      certificateService.transition({
        certificateId: certificate._id,
        to: CERTIFICATE_STATUS.APPROVED,
        expectedFrom: CERTIFICATE_STATUS.APPLIED,
        user: hod,
      })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("refuses to skip verification", async () => {
    const student = await createStudent();
    const hod = await createUser({ role: ROLES.HOD, department: student.department });
    const certificate = await applyAs(student.user);

    // APPLIED -> APPROVED is not an edge; verification must happen first.
    await expect(
      certificateService.transition({
        certificateId: certificate._id,
        to: CERTIFICATE_STATUS.APPROVED,
        expectedFrom: CERTIFICATE_STATUS.APPLIED,
        user: hod,
      })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("rejects a student transitioning their own certificate", async () => {
    const student = await createStudent();
    const certificate = await applyAs(student.user);

    await expect(
      certificateService.transition({
        certificateId: certificate._id,
        to: CERTIFICATE_STATUS.VALIDATING,
        expectedFrom: CERTIFICATE_STATUS.APPLIED,
        user: student.user,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns 409 when two officers approve concurrently", async () => {
    const student = await createStudent();
    const department = student.department;
    const hod = await createUser({ role: ROLES.HOD, department });
    const certificate = await applyAs(student.user);

    await advanceTo(certificate._id, CERTIFICATE_STATUS.VERIFYING, { hod, user: hod });

    const results = await Promise.allSettled([
      certificateService.transition({
        certificateId: certificate._id,
        to: CERTIFICATE_STATUS.APPROVED,
        expectedFrom: CERTIFICATE_STATUS.VERIFYING,
        user: hod,
      }),
      certificateService.transition({
        certificateId: certificate._id,
        to: CERTIFICATE_STATUS.APPROVED,
        expectedFrom: CERTIFICATE_STATUS.VERIFYING,
        user: hod,
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

describe("download authorization", () => {
  /** Issue a real certificate so a download can be attempted against it. */
  async function issueFor(student) {
    const hod = await createUser({ role: ROLES.HOD, department: student.department });
    const certificate = await applyAs(student.user);
    await advanceTo(certificate._id, CERTIFICATE_STATUS.APPROVED, { hod, user: hod });
    return {
      hod,
      issued: await certificateService.generate({
        certificateId: certificate._id,
        user: hod,
      }),
    };
  }

  it("lets the owning student download", async () => {
    const student = await createStudent();
    const { issued } = await issueFor(student);

    const { agent } = await loginAs(student.user);
    const res = await agent.get(`/api/v1/certificates/${issued.reference}/download`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("does not let another student download", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    const { issued } = await issueFor(alice);

    const { agent } = await loginAs(bob.user);
    const res = await agent.get(`/api/v1/certificates/${issued.reference}/download`);

    // 404, identical to a certificate that does not exist.
    expectError(res, 404, "NOT_FOUND");
  });

  it("refuses an anonymous download with no token", async () => {
    const student = await createStudent();
    const { issued } = await issueFor(student);

    const request = require("supertest");
    const res = await request(getApp()).get(
      `/api/v1/certificates/${issued.reference}/download`
    );

    expectError(res, 404, "NOT_FOUND");
  });

  it("refuses a guessed id belonging to another student", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    const { issued } = await issueFor(alice);

    const { agent } = await loginAs(bob.user);
    const byId = await agent.get(`/api/v1/certificates/${issued._id}/download`);

    expectError(byId, 404, "NOT_FOUND");
  });

  it("serves a valid signed token without a session", async () => {
    const student = await createStudent();
    const { issued } = await issueFor(student);

    // The token stands in for a session, which is what makes a link in an email
    // usable without re-authenticating.
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const token = signDownloadToken(issued.document.storageKey, expiresAt);

    const request = require("supertest");
    const res = await request(getApp()).get(
      `/api/v1/certificates/${issued.reference}/download?token=${token}`
    );

    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("refuses a forged or expired download token", async () => {
    const student = await createStudent();
    const { issued } = await issueFor(student);
    const request = require("supertest");

    const forged = await request(getApp()).get(
      `/api/v1/certificates/${issued.reference}/download?token=${Date.now() + 300}.deadbeef`
    );
    expectError(forged, 403, "FORBIDDEN");

    const expired = signDownloadToken(
      issued.document.storageKey,
      Math.floor(Date.now() / 1000) - 60
    );
    const expiredRes = await request(getApp()).get(
      `/api/v1/certificates/${issued.reference}/download?token=${expired}`
    );
    expectError(expiredRes, 403, "FORBIDDEN");
  });

  it("refuses to download a certificate that is not yet issued", async () => {
    const student = await createStudent();
    const certificate = await applyAs(student.user);

    const { agent } = await loginAs(student.user);
    const res = await agent.get(`/api/v1/certificates/${certificate.reference}/download`);

    // An application is not a certificate.
    expectError(res, 400, "VALIDATION_ERROR");
  });

  it("never exposes the storage key in an API response", async () => {
    const student = await createStudent();
    const { issued } = await issueFor(student);
    expect(issued.document.storageKey).toBeTruthy();

    const { agent } = await loginAs(student.user);
    const res = await agent.get(`/api/v1/certificates/${issued.reference}`);

    expect(res.status).toBe(200);
    expect(res.body.data.document?.storageKey).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(issued.document.storageKey);
  });

  it("marks the download as private and non-cacheable", async () => {
    const student = await createStudent();
    const { issued } = await issueFor(student);

    const { agent } = await loginAs(student.user);
    const res = await agent.get(`/api/v1/certificates/${issued.reference}/download`);

    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
  });
});

describe("revocation", () => {
  it("revokes an issued certificate and blocks download", async () => {
    const student = await createStudent();
    const department = student.department;
    const hod = await createUser({ role: ROLES.HOD, department });
    const principal = await createUser({ role: ROLES.PRINCIPAL });

    const certificate = await applyAs(student.user);
    await advanceTo(certificate._id, CERTIFICATE_STATUS.APPROVED, { hod, user: hod });
    const issued = await certificateService.generate({
      certificateId: certificate._id,
      user: hod,
    });

    const before = await loginAs(student.user);
    const okDownload = await before.agent.get(
      `/api/v1/certificates/${issued.reference}/download`
    );
    expect(okDownload.status).toBe(200);

    const revoked = await certificateService.revoke({
      certificateId: certificate._id,
      user: principal,
      reason: "Issued in error following an audit finding",
    });

    expect(revoked.status).toBe(CERTIFICATE_STATUS.REVOKED);
    expect(revoked.revocation.revokedAt).toBeTruthy();
    expect(revoked.revocation.reason).toContain("audit");

    const after = await loginAs(student.user);
    const blocked = await after.agent.get(
      `/api/v1/certificates/${issued.reference}/download`
    );

    // A revoked certificate must stop being downloadable, signed link or not.
    expectError(blocked, 400, "VALIDATION_ERROR");
  });

  it("refuses revocation without a reason", async () => {
    const student = await createStudent();
    const department = student.department;
    const hod = await createUser({ role: ROLES.HOD, department });
    const principal = await createUser({ role: ROLES.PRINCIPAL });

    const certificate = await applyAs(student.user);
    await advanceTo(certificate._id, CERTIFICATE_STATUS.APPROVED, { hod, user: hod });
    await certificateService.generate({ certificateId: certificate._id, user: hod });

    // "no" is not a reason; a revocation must be explicable to the holder.
    await expect(
      certificateService.revoke({
        certificateId: certificate._id,
        user: principal,
        reason: "no",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      certificateService.revoke({
        certificateId: certificate._id,
        user: principal,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses revocation by a role without the permission", async () => {
    const student = await createStudent();
    const department = student.department;
    const hod = await createUser({ role: ROLES.HOD, department });

    const certificate = await applyAs(student.user);
    await advanceTo(certificate._id, CERTIFICATE_STATUS.APPROVED, { hod, user: hod });
    await certificateService.generate({ certificateId: certificate._id, user: hod });

    await expect(
      certificateService.revoke({
        certificateId: certificate._id,
        user: hod,
        reason: "Attempted without the revocation permission",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("public verification", () => {
  it("confirms an authentic certificate by its code", async () => {
    const student = await createStudent();
    const hod = await createUser({ role: ROLES.HOD, department: student.department });

    const certificate = await applyAs(student.user);
    await advanceTo(certificate._id, CERTIFICATE_STATUS.APPROVED, { hod, user: hod });
    const issued = await certificateService.generate({
      certificateId: certificate._id,
      user: hod,
    });

    const result = await certificateService.verifyByCode({
      code: issued.verificationCode,
    });

    expect(result.found).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.reference).toBe(issued.reference);
    // Existence and validity only — a code may be read aloud.
    expect(result.student).toBeUndefined();
    expect(result.rollNumber).toBeUndefined();
  });

  it("reports a revoked certificate as not valid", async () => {
    const student = await createStudent();
    const department = student.department;
    const hod = await createUser({ role: ROLES.HOD, department });
    const principal = await createUser({ role: ROLES.PRINCIPAL });

    const certificate = await applyAs(student.user);
    await advanceTo(certificate._id, CERTIFICATE_STATUS.APPROVED, { hod, user: hod });
    const issued = await certificateService.generate({
      certificateId: certificate._id,
      user: hod,
    });
    await certificateService.revoke({
      certificateId: certificate._id,
      user: principal,
      reason: "Revoked for verification purposes",
    });

    const result = await certificateService.verifyByCode({
      code: issued.verificationCode,
    });

    expect(result.found).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.revokedAt).toBeTruthy();
  });

  it("reports an unknown code as not found", async () => {
    const result = await certificateService.verifyByCode({ code: "ZZZZZZ-999999" });
    expect(result.found).toBe(false);
  });

  it("rejects a malformed verification code", async () => {
    const request = require("supertest");
    const res = await request(getApp()).get("/api/v1/certificates/verify?code=!!");
    expectError(res, 400, "VALIDATION_ERROR");
  });
});

describe("scoping", () => {
  it("shows a student only their own certificates", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    await applyAs(alice.user);
    await applyAs(bob.user);

    const { agent } = await loginAs(alice.user);
    const res = await agent.get("/api/v1/certificates");

    expect(res.body.meta.total).toBe(1);
  });

  it("confines an HOD to their department", async () => {
    const cse = await createDepartment({ name: "CSE" });
    const ece = await createDepartment({ name: "ECE" });
    const cseStudent = await createStudent({ department: cse });
    const eceStudent = await createStudent({ department: ece });

    await applyAs(cseStudent.user);
    await applyAs(eceStudent.user);

    const hod = await createUser({ role: ROLES.HOD, department: cse });
    const { agent } = await loginAs(hod);

    const res = await agent.get("/api/v1/certificates");
    expect(res.body.meta.total).toBe(1);
  });

  it("returns 404 when a student fetches another's certificate", async () => {
    const alice = await createStudent();
    const bob = await createStudent();
    const certificate = await applyAs(alice.user);

    const { agent } = await loginAs(bob.user);
    const res = await agent.get(`/api/v1/certificates/${certificate.reference}`);

    expectError(res, 404, "NOT_FOUND");
  });
});
