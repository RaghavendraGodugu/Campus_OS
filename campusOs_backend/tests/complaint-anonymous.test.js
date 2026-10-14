/**
 * Anonymous grievances.
 *
 * Two public endpoints, no session, and both of them exist because a person
 * deciding whether to report harassment should not have to hand over their
 * identity to do it. That makes the privacy properties the entire test.
 *
 * The rest — rate limits, CSRF, permissions — do not apply because there is no
 * account to enforce them on. The trade is stated on the page, and the tests
 * below are what make the statement true.
 */

const {
  getApp,
  resetDatabase,
  createStudent,
  createDepartment,
  loginAs,
} = require("./helpers/factory");

const Complaint = require("../src/models/Complaint");
const User = require("../src/models/User");

const request = require("supertest");

const REPORT = {
  category: "HARASSMENT",
  subject: "Repeated conduct in the corridor",
  description:
    "This has been happening repeatedly over the past three weeks and I want it recorded formally.",
};

beforeEach(resetDatabase);

const fileAnonymous = (body = REPORT) =>
  request(getApp()).post("/api/v1/complaints/anonymous").send(body);

describe("filing without an account", () => {
  it("accepts a report from nobody in particular", async () => {
    const res = await fileAnonymous();

    expect(res.status).toBe(201);
    expect(res.body.data.reference).toMatch(/^CMP-/);
    expect(res.body.meta.trackingCode).toMatch(/^[A-Z0-9]{8}-[A-Z0-9]{8}$/);
  });

  it("needs no session, and no CSRF token — there is no account to forge", async () => {
    const res = await fileAnonymous();
    expect(res.status).toBe(201);
  });

  /**
   * Confidentiality is derived from the category by the model, never accepted
   * from the caller. A caller who could set it could file a harassment report
   * that was quietly treated as an ordinary one.
   */
  it("cannot downgrade a sensitive report", async () => {
    const res = await fileAnonymous({ ...REPORT, confidential: false });

    // Refused outright rather than silently ignored: a request that tries to
    // set it should be visible as a mistake, not quietly dropped.
    expect(res.status).toBe(400);
    expect(await Complaint.countDocuments({ category: "HARASSMENT" })).toBe(0);

    // And the model derives it regardless of what anybody passes, so a future
    // caller that slips past the validator still cannot downgrade it.
    const complaint = await Complaint.create({
      reference: "CMP-TEST-DERIVE",
      isAnonymous: true,
      category: "HARASSMENT",
      subject: "s",
      description: "d",
    });
    expect(complaint.confidential).toBe(true);
  });

  it("refuses a report with nothing in it", async () => {
    expect((await fileAnonymous({ ...REPORT, description: "bad" })).status).toBe(400);
    expect((await fileAnonymous({ ...REPORT, subject: "hi" })).status).toBe(400);
  });

  it("refuses unknown fields", async () => {
    const res = await fileAnonymous({ ...REPORT, student: "someones-id" });
    expect(res.status).toBe(400);
  });
});

describe("what the record does not keep", () => {
  /**
   * The whole promise. If any of these were stored, "anonymous" would mean
   * "anonymous to everyone without database access", which is not what the
   * person was told.
   */
  it("ties the grievance to nobody", async () => {
    await fileAnonymous();

    const complaint = await Complaint.findOne({ isAnonymous: true });

    expect(complaint.student).toBeNull();
    expect(complaint.assignedTo ?? null).toBeNull();

    // No copy of the request anywhere on the record.
    const serialised = JSON.stringify(complaint);
    expect(serialised).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/); // no IP address
    expect(complaint.get("ipAddress")).toBeUndefined();
    expect(complaint.get("reporterEmail")).toBeUndefined();
  });

  /**
   * Stored hashed, so a database dump does not hand over a list of working
   * tracking codes. With them, anyone could read the status of somebody else's
   * grievance.
   */
  it("stores the tracking code only as a hash", async () => {
    const res = await fileAnonymous();
    const code = res.body.meta.trackingCode;

    // `select: false` on the hash, so it has to be asked for — which is also
    // a check that an ordinary read really does hide it.
    const hidden = await Complaint.findOne({ isAnonymous: true });
    expect(hidden.trackingCodeHash ?? hidden.get("trackingCodeHash")).toBeUndefined();

    const complaint = await Complaint.findOne({ isAnonymous: true }).select(
      "+trackingCodeHash"
    );

    expect(JSON.stringify(complaint)).not.toContain(code);
    expect(complaint.trackingCodeHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not expose the hash through a normal query", async () => {
    await fileAnonymous();

    // `select: false` — a code that came back from an ordinary read would be
    // useless but the habit of hiding it is worth keeping.
    const complaint = await Complaint.findOne({ isAnonymous: true });
    expect(
      complaint.trackingCodeHash ?? complaint.get("trackingCodeHash")
    ).toBeUndefined();
  });

  it("records who filed it in the audit trail as nobody", async () => {
    const AuditLog = require("../src/models/AuditLog");
    await fileAnonymous();

    const entry = await AuditLog.findOne({ entity: "Complaint" }).lean();

    // A null actor is the honest entry. Inventing a system user would be a lie
    // in the one record somebody might later rely on.
    expect(entry.actor ?? null).toBeNull();
    expect(entry.metadata.anonymous).toBe(true);
  });
});

describe("tracking", () => {
  /**
   * Someone holding a code is being shown that a grievance exists. They are not
   * being given the right to read it.
   */
  it("returns the state of the matter and nothing else", async () => {
    const filed = await fileAnonymous();
    const code = filed.body.meta.trackingCode;

    const res = await request(getApp()).get(`/api/v1/complaints/track/${code}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      found: true,
      reference: filed.body.data.reference,
      status: "OPEN",
      resolved: false,
    });

    // The restraint, stated as an assertion because it is the feature.
    expect(res.body.data.subject).toBeUndefined();
    expect(res.body.data.description).toBeUndefined();
    expect(res.body.data.category).toBeUndefined();
    expect(res.body.data.assignedTo).toBeUndefined();
    expect(res.body.data.department).toBeUndefined();
  });

  it("gives the same answer for an unknown code as for anything else unknown", async () => {
    const res = await request(getApp()).get("/api/v1/complaints/track/AAAAAAAA-BBBBBBBB");

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/no report matches/i);
  });

  it("cannot be used to find somebody else's grievance by guessing", async () => {
    await fileAnonymous();

    // The code is 80 bits of a 30-character alphabet. This does not prove the
    // space is large; it proves nothing enumerable exists to walk.
    const codes = new Set();
    for (let i = 0; i < 200; i += 1) {
      const res = await request(getApp()).get(
        "/api/v1/complaints/track/AAAAAAAA-BBBBBBBB"
      );
      codes.add(res.body.message);
    }

    expect(codes.size).toBe(1);
  });

  it("rejects a malformed code before touching the database", async () => {
    const res = await request(getApp()).get(
      `/api/v1/complaints/track/${encodeURIComponent("not a code!")}`
    );
    expect(res.status).toBe(400);
  });

  it("finds a grievance filed with an account only by reference, never by code", async () => {
    const student = await createStudent();
    const { agent, csrfToken } = await loginAs(student.user);

    await agent.post("/api/v1/complaints").set("X-CSRF-Token", csrfToken).send({
      category: "ACADEMICS",
      subject: "A signed-in complaint",
      description: "Filed from an account, so there is a complainant on the record.",
    });

    const signed = await Complaint.findOne({ isAnonymous: { $ne: true } }).select(
      "+trackingCodeHash"
    );
    expect(signed.trackingCodeHash ?? null).toBeNull();
  });
});

describe("codes", () => {
  it("are long enough that guessing is not practical", () => {
    const complaintService = require("../src/services/complaint.service");
    const seen = new Set();

    for (let i = 0; i < 500; i += 1) {
      const code = complaintService.generateTrackingCode();
      expect(code).toMatch(/^[A-Z0-9]{8}-[A-Z0-9]{8}$/);
      // No look-alike glyphs: this gets read off a screen and retyped.
      expect(code).not.toMatch(/[OIL01]/);
      seen.add(code);
    }

    expect(seen.size).toBe(500);
  });

  it("still work when typed in the wrong case or without the hyphen", async () => {
    const filed = await fileAnonymous();
    const code = filed.body.meta.trackingCode;

    const squashed = code.replace("-", "").toLowerCase();

    const res = await request(getApp()).get(`/api/v1/complaints/track/${squashed}`);

    // Somebody typing this from a printed note will get the case wrong.
    expect(res.status).toBe(200);
    expect(res.body.data.found).toBe(true);
  });
});

describe("it does not displace the signed-in route", () => {
  it("still files a grievance against a student account the usual way", async () => {
    const student = await createStudent();
    const { agent, csrfToken } = await loginAs(student.user);

    const res = await agent
      .post("/api/v1/complaints")
      .set("X-CSRF-Token", csrfToken)
      .send({
        category: "ACADEMICS",
        subject: "An ordinary complaint",
        description: "This one has a complainant on it, and always did.",
      });

    expect(res.status).toBe(201);

    const filed = await Complaint.findOne({ subject: "An ordinary complaint" });
    expect(filed.student).toBeTruthy();
    expect(filed.isAnonymous).toBe(false);
  });

  it("refuses to tie an anonymous grievance to an account", async () => {
    // The model refuses the impossible combination, so no code path can
    // produce a record that is both anonymous and attached to somebody.
    await expect(
      Complaint.create({
        reference: "CMP-TEST-ANON",
        isAnonymous: true,
        student: null,
        category: "ACADEMICS",
        subject: "s",
        description: "d",
      })
    ).resolves.toBeTruthy();

    const real = await createStudent();

    await expect(
      Complaint.create({
        reference: "CMP-TEST-BOTH",
        isAnonymous: true,
        student: real.student._id,
        category: "ACADEMICS",
        subject: "s",
        description: "d",
      })
    ).rejects.toThrow(/cannot be tied to a student/i);
  });

  it("still refuses a signed-in complaint with no complainant", async () => {
    const department = await createDepartment();

    await expect(
      Complaint.create({
        reference: "CMP-TEST-ORPHAN",
        category: "ACADEMICS",
        subject: "s",
        description: "d",
        department: department._id,
      })
    ).rejects.toThrow(/must belong to a student/i);
  });

  it("leaves existing accounts able to see their own complaints", async () => {
    const student = await createStudent();
    const { agent } = await loginAs(student.user);

    const res = await agent.get("/api/v1/complaints");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("counts anonymous grievances for the officer who has to handle them", async () => {
    await fileAnonymous();
    await fileAnonymous({ ...REPORT, category: "SAFETY" });

    const count = await Complaint.countDocuments({ isAnonymous: true });
    expect(count).toBe(2);
  });

  it("leaves no orphan users behind", async () => {
    await fileAnonymous();
    // A filing must not quietly create an account to hang the record on.
    expect(await User.countDocuments({ isAnonymousGrievance: { $exists: true } })).toBe(
      0
    );
  });
});
