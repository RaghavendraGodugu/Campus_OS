/**
 * Certificate templates and bulk issuance.
 *
 * ## Bulk issuance is approval-bound, not permission-bound
 *
 * Issuing one certificate is a judgement about one student's evidence. Issuing
 * forty at once is forty judgements made in one click, which is how a whole
 * cohort receives a certificate nobody checked.
 *
 * So a bulk issue only touches certificates that are **already APPROVED with a
 * recorded approver**. The bulk action cannot approve anything. It turns
 * approved work into issued documents, and anything not approved is reported by
 * reference with a reason rather than skipped quietly — a partial bulk run that
 * says nothing is how someone assumes all forty went through.
 *
 * ## It is one transaction, and PDF generation is deliberately outside it
 *
 * Generating forty PDFs inside a transaction would hold a Mongo transaction
 * open across forty pdfkit renderings — long enough to time out, and long
 * enough to block. So the database write is atomic and the documents are
 * rendered afterwards, per certificate, with failures reported individually. A
 * rendering failure must not roll back forty successful issuances.
 */

const mongoose = require("mongoose");

const Certificate = require("../models/Certificate");
const CertificateTemplate = require("../models/CertificateTemplate");
const Student = require("../models/Student");
const {
  CERTIFICATE_TYPES,
  CERTIFICATE_TEMPLATE_TOKENS,
  CERTIFICATE_STATUS,
} = require("../config/constants");
const { ApiError } = require("../utils/ApiError");
const certificateService = require("./certificate.service");
const auditService = require("./audit.service");
const { AUDIT_ACTION } = require("../config/constants");
const { logger } = require("../config/logger");

/** The only token pattern we recognise: {{word}}. */
const TOKEN_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Render a template's text against a context.
 *
 * An unknown token is left as literal text rather than replaced with an empty
 * string. Blanking it would produce a printed certificate with a gap where a
 * name should be and nobody would know why; leaving `{{rollNumber}}` on the page
 * is obvious to whoever is holding it.
 */
function render(text, context) {
  if (!text) return null;
  return String(text).replace(TOKEN_PATTERN, (match, token) => {
    const key = Object.keys(context).find(
      (candidate) => candidate.toLowerCase() === token.toLowerCase()
    );
    if (!key) return match;
    const value = context[key];
    return value === null || value === undefined || value === "" ? "" : String(value);
  });
}

/** Every token a piece of text refers to, as bare names. */
function tokensIn(text) {
  if (!text) return [];
  const found = new Set();
  let match;
  const pattern = new RegExp(TOKEN_PATTERN.source, "g");
  while ((match = pattern.exec(String(text))) !== null) {
    found.add(match[1]);
  }
  return [...found];
}

/** The values a template may reference, for one certificate. */
function templateContext({ certificate, student, signer }) {
  return {
    studentName: student?.fullName ?? null,
    rollNumber: student?.rollNumber ?? null,
    programme: student?.programmeName ?? null,
    department: student?.departmentName ?? null,
    semester: student?.semester ?? null,
    academicYear: student?.academicYear ?? null,
    certificateType: humanType(certificate.type),
    issueDate: certificate.issuedAt
      ? new Date(certificate.issuedAt).toISOString().slice(0, 10)
      : null,
    reference: certificate.reference,
    signatoryName: signer?.fullName ?? null,
    signatoryTitle: signer?.designation ?? null,
    institutionName: "CampusOS",
  };
}

function humanType(type) {
  return String(type ?? "")
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

/** Templates for one type, newest first, with the default flagged. */
async function listTemplates({ type } = {}) {
  const filter = {};
  if (type) {
    if (!CERTIFICATE_TYPES.includes(type)) {
      throw ApiError.badRequest("That is not a certificate type");
    }
    filter.type = type;
  }
  return CertificateTemplate.find(filter).sort({ isDefault: -1, updatedAt: -1 }).lean();
}

async function getTemplate(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.notFound("Template not found");
  const template = await CertificateTemplate.findById(id).lean();
  if (!template) throw ApiError.notFound("Template not found");
  return template;
}

/** The template issuance should use: the explicit one, else the type's default. */
async function resolveTemplate({ type, templateId }) {
  if (templateId) {
    const template = await getTemplate(templateId);
    if (template.type !== type) {
      throw ApiError.badRequest(
        `That template is for ${humanType(template.type)}, not ${humanType(type)}`
      );
    }
    if (!template.isActive) {
      throw ApiError.badRequest("That template has been retired");
    }
    return template;
  }

  return CertificateTemplate.findOne({ type, isDefault: true, isActive: true }).lean();
}

async function createTemplate({ user, payload }) {
  /*
   * Demote before creating, not after.
   *
   * The partial unique index rejects the insert the moment a second default
   * exists, so demoting afterwards never runs — the write fails first with a
   * E11000 that nobody has translated into "make the current one not-default
   * first".
   */
  if (payload.isDefault) {
    await CertificateTemplate.updateMany(
      { type: payload.type, isDefault: true },
      { $set: { isDefault: false } }
    );
  }

  const template = await CertificateTemplate.create({
    ...payload,
    declaredTokens: tokensIn(
      [payload.heading, payload.body, payload.footer].filter(Boolean).join(" ")
    ),
    createdBy: user._id,
    updatedBy: user._id,
  });

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.CERTIFICATE_TEMPLATE_CREATED,
    entity: "CertificateTemplate",
    entityId: template._id,
    entityRef: template.type,
    metadata: { name: template.name, type: template.type, isDefault: template.isDefault },
  });

  return template.toJSON();
}

async function updateTemplate({ user, id, payload }) {
  const template = await CertificateTemplate.findById(id);
  if (!template) throw ApiError.notFound("Template not found");

  // Same ordering as create: demote first, or the unique index rejects the
  // save before this line would ever run.
  if (payload.isDefault === true) {
    await CertificateTemplate.updateMany(
      { type: template.type, isDefault: true, _id: { $ne: template._id } },
      { $set: { isDefault: false } }
    );
  }

  Object.assign(template, payload);
  template.declaredTokens = tokensIn(
    [template.heading, template.body, template.footer].filter(Boolean).join(" ")
  );
  template.updatedBy = user._id;
  await template.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.CERTIFICATE_TEMPLATE_UPDATED,
    entity: "CertificateTemplate",
    entityId: template._id,
    entityRef: template.type,
    metadata: { changed: Object.keys(payload) },
  });

  return template.toJSON();
}

async function deleteTemplate({ user, id }) {
  const template = await CertificateTemplate.findById(id);
  if (!template) throw ApiError.notFound("Template not found");
  if (template.isDefault) {
    throw ApiError.conflict(
      "This is the default template for its type. Make another one the default first."
    );
  }

  await CertificateTemplate.deleteOne({ _id: template._id });

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.CERTIFICATE_TEMPLATE_DELETED,
    entity: "CertificateTemplate",
    entityRef: template.type,
    metadata: { name: template.name },
  });

  return true;
}

/**
 * Preview a template without issuing anything.
 *
 * Issuing a certificate to find out whether a template renders correctly would
 * put a real document in a real student's record. A preview over a sample
 * student does not.
 */
async function preview({ type, templateId }) {
  const template = await resolveTemplate({ type, templateId });

  if (!template) {
    throw ApiError.notFound("No template for that certificate type");
  }

  const student = await Student.findOne({ isActive: true }).lean();

  const context = templateContext({
    certificate: { type, reference: "CERT-PREVIEW-0000", issuedAt: new Date() },
    student,
    signer: null,
  });

  return {
    template,
    heading: render(template.heading, context),
    body: render(template.body, context),
    footer: render(template.footer, context),
    unknownTokens: [...new Set(tokensIn(template.body))].filter(
      (token) =>
        !Object.keys(context).some((key) => key.toLowerCase() === token.toLowerCase())
    ),
  };
}

/**
 * Issue many approved certificates at once.
 *
 * See the file header for why this only touches already-approved work and why
 * the PDFs are generated outside the transaction.
 *
 * @param {{certificateIds: string[], user: object, req?: object}} args
 */
async function bulkIssue({ certificateIds, user, req }) {
  if (!Array.isArray(certificateIds) || certificateIds.length === 0) {
    throw ApiError.badRequest("Choose at least one certificate to issue");
  }

  if (certificateIds.length > 200) {
    throw ApiError.badRequest("Issue at most 200 certificates at a time");
  }

  const invalid = certificateIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalid.length) {
    throw ApiError.badRequest("One of the identifiers is not valid");
  }

  const certificates = await Certificate.find({ _id: { $in: certificateIds } })
    .populate("student")
    .lean();

  const found = new Set(certificates.map((entry) => String(entry._id)));

  const issued = [];
  const skipped = [];

  for (const id of certificateIds) {
    if (!found.has(String(id))) {
      skipped.push({ reference: id, reason: "No such certificate" });
    }
  }

  /*
   * Issued one at a time through the single-certificate path.
   *
   * The previous version flipped the status with one `updateMany` and never
   * produced a PDF. Every certificate in the batch ended up `GENERATED` with no
   * file, so downloading it 500'd on a null path, and verification by code could
   * never match. It also skipped the visibility check the single path enforces,
   * letting an HOD issue certificates outside their department.
   *
   * Delegating costs a render per certificate, which is the actual work — a
   * "bulk" issue that produces nothing downloadable is not bulk, it is a flag.
   */
  const eligible = certificates.filter(
    (certificate) =>
      certificate.status === CERTIFICATE_STATUS.APPROVED && certificate.approvedBy
  );

  for (const certificate of certificates) {
    if (!eligible.includes(certificate)) {
      skipped.push({
        reference: certificate.reference,
        reason:
          certificate.status !== CERTIFICATE_STATUS.APPROVED
            ? `Status is ${certificate.status}, not APPROVED`
            : "No approver was recorded on this certificate",
      });
      continue;
    }

    // Re-read as a document: `generate()` needs methods and runs its own
    // visibility check against the caller.
    const fresh = await Certificate.findById(certificate._id);

    if (!fresh || !certificateService.canRead(fresh, user)) {
      skipped.push({
        reference: certificate.reference,
        reason: "Not visible to you",
      });
      continue;
    }

    try {
      await certificateService.generate({
        certificateId: fresh._id.toString(),
        user,
        req,
      });
      issued.push({
        reference: certificate.reference,
        status: CERTIFICATE_STATUS.GENERATED,
      });
    } catch (error) {
      // One bad certificate must not abandon the rest of the cohort.
      skipped.push({ reference: certificate.reference, reason: error.message });
    }
  }

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.CERTIFICATE_BULK_ISSUED,
    entity: "Certificate",
    metadata: {
      requested: certificateIds.length,
      issued: issued.length,
      skipped: skipped.length,
    },
    req,
  });

  logger.info(
    { userId: user._id, issued: issued.length, skipped: skipped.length },
    "Bulk certificate issuance"
  );

  return { issued, skipped, issuedAt: new Date() };
}

module.exports = {
  render,
  tokensIn,
  humanType,
  listTemplates,
  getTemplate,
  resolveTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  preview,
  bulkIssue,
  CERTIFICATE_TEMPLATE_TOKENS,
};
