/**
 * Certificate templates and bulk issuance.
 *
 * The bulk path is where the care is. Issuing forty certificates in one click is
 * forty judgements at once, so the tests are mostly about what it *refuses* to
 * touch, and about a partial run reporting exactly what it skipped.
 */

const mongoose = require("mongoose");

const { resetDatabase, createUser, createStudent } = require("./helpers/factory");

const templateService = require("../src/services/certificateTemplate.service");
const Certificate = require("../src/models/Certificate");
const CertificateTemplate = require("../src/models/CertificateTemplate");
const { CERTIFICATE_STATUS } = require("../src/config/constants");

let counter = 0;

async function makeApprovedStudent({ status = CERTIFICATE_STATUS.APPROVED } = {}) {
  counter += 1;

  // Built through the factory rather than by hand: a Student requires a linked
  // user, a programme, a department and an enrolment date, and a hand-rolled
  // one is a ValidationError rather than a test.
  const { student } = await createStudent();
  const admin = await createUser({ role: "SUPER_ADMIN" });

  return Certificate.create({
    reference: `CERT-TEST-${counter}`,
    type: "BONAFIDE",
    student: student._id,
    requestedBy: admin._id,
    status,
    approvedBy: status === CERTIFICATE_STATUS.APPROVED ? admin._id : null,
    approvedAt: status === CERTIFICATE_STATUS.APPROVED ? new Date() : null,
  });
}

describe("certificate templates — rendering", () => {
  it("substitutes a known placeholder", () => {
    expect(
      templateService.render("Hello {{studentName}}", { studentName: "Ananya" })
    ).toBe("Hello Ananya");
  });

  it("matches a placeholder case-insensitively", () => {
    // Typing {{studentname}} in a template is the obvious mistake, and failing
    // the whole template for it would be unkind.
    expect(templateService.render("{{studentName}}", { studentName: "Ananya" })).toBe(
      "Ananya"
    );
  });

  /**
   * The decision that matters.
   *
   * Blanking an unknown token produces a printed certificate with a gap where a
   * name should be and nobody knows why. Leaving it as literal text is obvious
   * to whoever is holding the document.
   */
  it("leaves an unknown token as literal text", () => {
    expect(templateService.render("Hi {{nope}}", { studentName: "A" })).toBe(
      "Hi {{nope}}"
    );
  });

  it("renders an empty value as blank, because that one is known to be absent", () => {
    expect(templateService.render("Phone {{phone}}", { phone: null })).toBe("Phone ");
  });

  it("returns null for absent text rather than an empty string", () => {
    // A template field left empty is not a field with an empty value, and
    // printing a blank line where one was never written is a visible artefact.
    expect(templateService.render(null, {})).toBeNull();
  });

  it("finds the tokens a template refers to", () => {
    expect(templateService.tokensIn("{{a}} and {{ b }} and {{a}}").sort()).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("certificate templates — CRUD", () => {
  let admin;

  beforeEach(async () => {
    await resetDatabase();
    admin = await createUser({ role: "SUPER_ADMIN" });
  });

  it("records the tokens a template uses", async () => {
    const template = await templateService.createTemplate({
      user: admin,
      payload: {
        type: "BONAFIDE",
        name: "Standard bonafide",
        heading: "Certificate of {{certificateType}}",
        body: "This certifies that {{studentName}} ({{rollNumber}}) of {{department}}.",
      },
    });

    expect(template.declaredTokens.sort()).toEqual([
      "certificateType",
      "department",
      "rollNumber",
      "studentName",
    ]);
  });

  /**
   * Two defaults means issuance picks one at random, so the guarantee has to be
   * a partial unique index rather than a check-then-write in the service.
   */
  it("demotes the previous default rather than leaving two", async () => {
    const first = await templateService.createTemplate({
      user: admin,
      payload: { type: "BONAFIDE", name: "First", isDefault: true },
    });
    const second = await templateService.createTemplate({
      user: admin,
      payload: { type: "BONAFIDE", name: "Second", isDefault: true },
    });

    expect(second.isDefault).toBe(true);

    const defaults = await CertificateTemplate.find({
      type: "BONAFIDE",
      isDefault: true,
    });
    expect(defaults).toHaveLength(1);
    expect(String(defaults[0]._id)).toBe(String(second._id));
    expect(String((await CertificateTemplate.findById(first._id)).isDefault)).toBe(
      "false"
    );
  });

  it("keeps at most one default per type across different types", async () => {
    await templateService.createTemplate({
      user: admin,
      payload: { type: "BONAFIDE", name: "Bonafide", isDefault: true },
    });
    const transcript = await templateService.createTemplate({
      user: admin,
      payload: { type: "TRANSCRIPT", name: "Transcript", isDefault: true },
    });

    expect(transcript.isDefault).toBe(true);
  });

  it("refuses to delete the default, because that would leave issuance with nothing", async () => {
    const template = await templateService.createTemplate({
      user: admin,
      payload: { type: "NO_DUES", name: "No dues", isDefault: true },
    });

    await expect(
      templateService.deleteTemplate({ user: admin, id: template._id })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("resolves a template for a type, defaulting to the marked one", async () => {
    await templateService.createTemplate({
      user: admin,
      payload: {
        type: "STUDY",
        name: "Study default",
        isDefault: true,
        body: "Study for {{studentName}}",
      },
    });

    const resolved = await templateService.resolveTemplate({ type: "STUDY" });
    expect(resolved.name).toBe("Study default");
  });

  it("refuses a template belonging to a different certificate type", async () => {
    const template = await templateService.createTemplate({
      user: admin,
      payload: { type: "STUDY", name: "A study certificate" },
    });

    await expect(
      templateService.resolveTemplate({ type: "BONAFIDE", templateId: template._id })
    ).rejects.toThrow(/is for Study, not Bonafide/i);
  });

  it("refuses a retired template", async () => {
    const template = await templateService.createTemplate({
      user: admin,
      payload: { type: "BONAFIDE", name: "Retired one" },
    });
    await CertificateTemplate.updateOne(
      { _id: template._id },
      { $set: { isActive: false } }
    );

    await expect(
      templateService.resolveTemplate({ type: "BONAFIDE", templateId: template._id })
    ).rejects.toThrow(/retired/);
  });

  it("previews without creating a certificate record", async () => {
    await templateService.createTemplate({
      user: admin,
      payload: {
        type: "BONAFIDE",
        name: "Previewable",
        body: "This certifies {{studentName}}.",
      },
    });

    const template = await CertificateTemplate.findOne({ type: "BONAFIDE" });
    const before = await Certificate.countDocuments();
    const preview = await templateService.preview({
      type: "BONAFIDE",
      templateId: String(template._id),
    });

    // Issuing a certificate to find out whether a template works would put a
    // real document in a real student's file.
    expect(await Certificate.countDocuments()).toBe(before);
    expect(preview.body).toContain("This certifies ");
  });

  it("reports unknown tokens in a preview rather than hiding them", async () => {
    await templateService.createTemplate({
      user: admin,
      payload: {
        type: "BONAFIDE",
        name: "Typo'd",
        body: "{{studentName}} attended {{mysteryField}}.",
      },
    });

    const template = await CertificateTemplate.findOne({ type: "BONAFIDE" });
    const preview = await templateService.preview({
      type: "BONAFIDE",
      templateId: String(template._id),
    });
    expect(preview.unknownTokens).toContain("mysteryField");
  });
});

describe("bulk issuance", () => {
  let admin;

  beforeEach(async () => {
    await resetDatabase();
    admin = await createUser({ role: "SUPER_ADMIN" });
  });

  it("issues certificates that are approved with a recorded approver", async () => {
    const a = await makeApprovedStudent();
    const b = await makeApprovedStudent();

    const result = await templateService.bulkIssue({
      certificateIds: [String(a._id), String(b._id)],
      user: admin,
    });

    expect(result.issued).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);

    const stored = await Certificate.find({ _id: { $in: [a._id, b._id] } });
    expect(stored).toHaveLength(2);
    expect(stored.every((entry) => entry.status === CERTIFICATE_STATUS.GENERATED)).toBe(
      true
    );

    // The trail has to say who did it, or a bulk run is unattributable.
    for (const entry of stored) {
      const last = entry.statusHistory[entry.statusHistory.length - 1];
      expect(last).toMatchObject({
        from: CERTIFICATE_STATUS.APPROVED,
        to: CERTIFICATE_STATUS.GENERATED,
      });
      expect(String(last.actor)).toBe(String(admin._id));
    }
  });

  /**
   * The whole point.
   *
   * A bulk action that can approve forty applications in one click is how a
   * whole cohort receives a certificate nobody checked. The bulk path can only
   * turn approved work into issued documents.
   */
  it("refuses to issue a certificate that is not approved", async () => {
    const pending = await makeApprovedStudent({ status: CERTIFICATE_STATUS.APPLIED });

    const result = await templateService.bulkIssue({
      certificateIds: [String(pending._id)],
      user: admin,
    });

    expect(result.issued).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({
      reference: pending.reference,
    });
    expect(result.skipped[0].reason).toMatch(/not APPROVED/i);

    const stored = await Certificate.findById(pending._id);
    expect(stored.status).toBe(CERTIFICATE_STATUS.APPLIED);
  });

  it("refuses to issue an approved certificate with no recorded approver", async () => {
    const certificate = await makeApprovedStudent();
    await Certificate.updateOne({ _id: certificate._id }, { $set: { approvedBy: null } });

    const result = await templateService.bulkIssue({
      certificateIds: [String(certificate._id)],
      user: admin,
    });

    expect(result.issued).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/no approver/i);
  });

  /**
   * A partial run that says nothing is how somebody assumes all forty went
   * through.
   */
  it("issues what it can and names everything it skipped", async () => {
    const good = await makeApprovedStudent();
    const bad = await makeApprovedStudent({ status: CERTIFICATE_STATUS.APPLIED });

    const result = await templateService.bulkIssue({
      certificateIds: [String(good._id), String(bad._id)],
      user: admin,
    });

    expect(result.issued).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reference).toBe(bad.reference);
  });

  it("reports an id that matches nothing, rather than silently ignoring it", async () => {
    const result = await templateService.bulkIssue({
      certificateIds: [String(new mongoose.Types.ObjectId())],
      user: admin,
    });

    expect(result.issued).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/no such certificate/i);
  });

  it("refuses an empty list rather than reporting success for nothing", async () => {
    await expect(
      templateService.bulkIssue({ certificateIds: [], user: admin })
    ).rejects.toThrow(/at least one/i);
  });

  it("caps the batch so one request cannot lock up the service", async () => {
    const ids = Array.from({ length: 201 }, () => String(new mongoose.Types.ObjectId()));

    await expect(
      templateService.bulkIssue({ certificateIds: ids, user: admin })
    ).rejects.toThrow(/at most 200/i);
  });

  it("rejects a malformed identifier before touching the database", async () => {
    await expect(
      templateService.bulkIssue({ certificateIds: ["not-an-id"], user: admin })
    ).rejects.toThrow(/not valid/i);
  });
});
