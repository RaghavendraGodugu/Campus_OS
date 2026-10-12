/**
 * Certificate service.
 *
 * ## Issuance is a pipeline, not a file upload
 *
 * The spec (§11) requires that a certificate is never assumed to be issued
 * merely because a file exists. The pipeline here is:
 *
 *   APPLIED -> VALIDATING -> VERIFYING -> APPROVED -> GENERATED
 *                                       \-> REJECTED
 *   GENERATED -> REVOKED
 *
 * `generate()` is the only function that writes `document.storageKey`,
 * `issuedAt` and `issuedBy`, and it refuses to run until an approval is on the
 * record. The schema additionally refuses any GENERATED certificate missing
 * that complete record, so a bypass would have to defeat the database too.
 *
 * ## Authorization at read time
 *
 * `canRead()` and `resolveDownload()` both re-derive visibility from the stored
 * record. A signed URL proves only that we minted it recently; every download
 * is authorized here first.
 */

const crypto = require("crypto");

const Certificate = require("../models/Certificate");
const Counter = require("../models/Counter");
const Student = require("../models/Student");
const Department = require("../models/Department");
const Program = require("../models/Program");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { userHasPermission, P } = require("../utils/permissions");
const { ROLES, CERTIFICATE_STATUS, AUDIT_ACTION } = require("../config/constants");
const {
  getStorage,
  signDownloadToken,
  verifyDownloadToken,
  SIGNED_URL_TTL_SECONDS,
} = require("../config/storage");
const { renderCertificate } = require("./pdf.service");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");

const { counterKey, formatReference } = Counter;
const NAMESPACE = "certificate";
const PREFIX = "CERT";

/** Legal transitions, mirroring the request and complaint workflow tables. */
const CERTIFICATE_TRANSITIONS = {
  [CERTIFICATE_STATUS.APPLIED]: [
    {
      to: CERTIFICATE_STATUS.VALIDATING,
      permission: P.CERTIFICATE_VERIFY,
      label: "Validate",
    },
    {
      to: CERTIFICATE_STATUS.REJECTED,
      permission: P.CERTIFICATE_APPROVE,
      reasonRequired: true,
      label: "Reject",
    },
  ],
  [CERTIFICATE_STATUS.VALIDATING]: [
    {
      to: CERTIFICATE_STATUS.VERIFYING,
      permission: P.CERTIFICATE_VERIFY,
      label: "Verify",
    },
    {
      to: CERTIFICATE_STATUS.REJECTED,
      permission: P.CERTIFICATE_APPROVE,
      reasonRequired: true,
      label: "Reject",
    },
  ],
  [CERTIFICATE_STATUS.VERIFYING]: [
    {
      to: CERTIFICATE_STATUS.APPROVED,
      permission: P.CERTIFICATE_APPROVE,
      label: "Approve",
    },
    {
      to: CERTIFICATE_STATUS.REJECTED,
      permission: P.CERTIFICATE_APPROVE,
      reasonRequired: true,
      label: "Reject",
    },
  ],
  [CERTIFICATE_STATUS.APPROVED]: [
    {
      to: CERTIFICATE_STATUS.GENERATED,
      permission: P.CERTIFICATE_APPROVE,
      label: "Generate and issue",
    },
    {
      to: CERTIFICATE_STATUS.REJECTED,
      permission: P.CERTIFICATE_APPROVE,
      reasonRequired: true,
      label: "Reject",
    },
  ],
  [CERTIFICATE_STATUS.GENERATED]: [
    {
      to: CERTIFICATE_STATUS.REVOKED,
      permission: P.CERTIFICATE_REVOKE,
      reasonRequired: true,
      label: "Revoke",
    },
  ],
  [CERTIFICATE_STATUS.REJECTED]: [],
  [CERTIFICATE_STATUS.REVOKED]: [],
};

function transitionsFrom(status) {
  return CERTIFICATE_TRANSITIONS[status] ?? [];
}

/**
 * Is this an acceptable reason?
 *
 * A minimum length, not merely a non-empty string. "no" satisfies a presence
 * check but is useless to the certificate holder who later asks why their
 * document was withdrawn — which is the whole point of recording it. The
 * route schema enforces the same bound, so the rule holds for internal callers
 * too.
 */
const MIN_REASON_LENGTH = 10;

function isUsableReason(reason) {
  return typeof reason === "string" && reason.trim().length >= MIN_REASON_LENGTH;
}

/** Generate the next certificate reference. */
async function generateReference(year = new Date().getFullYear()) {
  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey(NAMESPACE, year) },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return formatReference(PREFIX, year, counter.seq);
}

/** Short, human-quotable code printed on the certificate. */
function generateVerificationCode() {
  // Excludes I, O, 0 and 1 so a code read aloud or retyped stays unambiguous.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(12);
  let code = "";
  for (let i = 0; i < 12; i++) {
    code += alphabet[bytes[i] % alphabet.length];
    if (i === 5) code += "-";
  }
  return code;
}

/**
 * Normalise a reference that may or may not be populated.
 *
 * `.populate("student")` replaces the ObjectId with a document, so
 * `cert.student.toString()` becomes "[object Object]" and a naive comparison
 * silently denies the *legitimate* owner. Every id comparison goes through here.
 *
 * @param {*} value ObjectId, populated document, or null.
 * @returns {string|null}
 */
function idOf(value) {
  if (!value) return null;
  if (typeof value === "object" && value._id) return value._id.toString();
  return value.toString();
}

/**
 * May this user read this certificate?
 *
 * Students see their own. Staff see their department's, or the institution's,
 * per their permission. Verification lookup by code is a separate, deliberately
 * narrow path.
 */
function canRead(certificate, user) {
  if (!certificate || !user) return false;

  if (user.role === ROLES.STUDENT) {
    return idOf(certificate.student) === idOf(user.student);
  }

  if (userHasPermission(user, P.CERTIFICATE_READ_INSTITUTION)) return true;
  if (idOf(certificate.assignedTo) === idOf(user._id)) return true;

  if (
    userHasPermission(user, P.CERTIFICATE_READ_DEPARTMENT) &&
    certificate.department &&
    idOf(certificate.department) === idOf(user.department)
  ) {
    return true;
  }

  return false;
}

/** Visibility filter for list queries, applied in the database. */
function buildVisibilityFilter(user) {
  if (user.role === ROLES.STUDENT) {
    return { student: user.student };
  }
  if (userHasPermission(user, P.CERTIFICATE_READ_INSTITUTION)) return {};
  if (userHasPermission(user, P.CERTIFICATE_READ_DEPARTMENT)) {
    return { department: user.department ?? null };
  }
  if (userHasPermission(user, P.CERTIFICATE_READ_ASSIGNED)) {
    return { assignedTo: user._id };
  }
  return { _id: null };
}

/** Scope filter for downloadable certificates. */
function buildDownloadableFilter(user) {
  const visibility = buildVisibilityFilter(user);
  // Never offer a revoked certificate for download as if it were valid.
  return { ...visibility, status: CERTIFICATE_STATUS.GENERATED };
}

/**
 * Apply for a certificate.
 */
async function apply({ user, type, purpose, copies, department, req }) {
  if (!user.student) {
    throw ApiError.forbidden("Only student accounts can apply for certificates");
  }

  const student = await Student.findById(user.student);
  if (!student) {
    throw ApiError.notFound("Student profile not found");
  }

  const reference = await generateReference();
  const now = new Date();

  const certificate = await Certificate.create({
    reference,
    type,
    student: student._id,
    purpose: purpose?.trim(),
    copies: copies ?? 1,
    department: department ?? student.department,
    status: CERTIFICATE_STATUS.APPLIED,
    submittedAt: now,
    statusHistory: [
      {
        from: null,
        to: CERTIFICATE_STATUS.APPLIED,
        actor: user._id,
        actorRole: user.role,
        at: now,
      },
    ],
  });

  await auditService.record({
    action: AUDIT_ACTION.CREATE,
    entity: "Certificate",
    entityId: certificate._id,
    entityRef: certificate.reference,
    metadata: { type, department: certificate.department },
    actor: user,
    req,
  });

  return certificate;
}

/** List certificates visible to a caller. */
async function list({ user, filters = {}, page = 1, limit = 20 }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);

  const query = { ...buildVisibilityFilter(user) };

  if (filters.status) query.status = filters.status;
  if (filters.type) query.type = filters.type;
  if (filters.department && userHasPermission(user, P.CERTIFICATE_READ_DEPARTMENT)) {
    query.department = filters.department;
  }

  const [items, total] = await Promise.all([
    Certificate.find(query)
      .sort({ submittedAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("department", "name code")
      .populate("student", "rollNumber semester program")
      .lean(),
    Certificate.countDocuments(query),
  ]);

  return { items, total, page: safePage, limit: safeLimit };
}

/**
 * Fetch one certificate, enforcing read access.
 *
 * A caller who may not read it receives 404, matching the convention used for
 * requests and complaints so ids cannot be probed.
 */
async function get({ certificateId, user }) {
  const condition = /^[a-f\d]{24}$/i.test(String(certificateId))
    ? { _id: certificateId }
    : { reference: String(certificateId) };

  const certificate = await Certificate.findOne(condition)
    .populate("department", "name code")
    .populate("student", "rollNumber semester year enrolmentDate program user")
    .populate("approvedBy", "fullName role")
    .populate("verifiedBy", "fullName role")
    .populate("issuedBy", "fullName role");

  if (!certificate || !canRead(certificate, user)) {
    throw ApiError.notFound("Certificate not found");
  }

  return certificate;
}

/**
 * Apply a status transition.
 *
 * Same two-gate model as the other workflows: the edge must exist, and the
 * actor must hold its permission. The write is atomic and pins the expected
 * status, so two officers cannot both approve.
 */
async function transition({ certificateId, to, expectedFrom, user, reason, note, req }) {
  const edge = transitionsFrom(expectedFrom).find((t) => t.to === to);

  if (!edge) {
    const legal = transitionsFrom(expectedFrom).map((t) => t.to);
    throw new ApiError(
      ERROR_CODE.INVALID_TRANSITION,
      `A certificate cannot move from ${expectedFrom} to ${to}`,
      {
        details: [
          {
            field: "to",
            message:
              legal.length > 0
                ? `Allowed from ${expectedFrom}: ${legal.join(", ")}`
                : `${expectedFrom} is a final status`,
            code: "INVALID_TRANSITION",
          },
        ],
      }
    );
  }

  if (!userHasPermission(user, edge.permission)) {
    await auditService.recordAccessDenied({
      req,
      user,
      entity: "Certificate",
      entityId: certificateId,
      required: edge.permission,
    });
    throw ApiError.forbidden("You do not have permission to perform this action");
  }

  if (edge.reasonRequired && !isUsableReason(reason)) {
    throw ApiError.badRequest(`A reason is required to ${edge.label.toLowerCase()}`);
  }

  const condition = /^[a-f\d]{24}$/i.test(String(certificateId))
    ? { _id: certificateId }
    : { reference: String(certificateId) };

  const current = await Certificate.findOne(condition);
  if (!current || !canRead(current, user)) {
    throw ApiError.notFound("Certificate not found");
  }

  const now = new Date();
  const update = {
    $set: {
      status: to,
      ...(to === CERTIFICATE_STATUS.VERIFIED
        ? { verifiedBy: user._id, verifiedAt: now }
        : {}),
      ...(to === CERTIFICATE_STATUS.APPROVED
        ? { approvedBy: user._id, approvedAt: now }
        : {}),
      ...(to === CERTIFICATE_STATUS.REJECTED ? { rejectionReason: reason?.trim() } : {}),
      ...(to === CERTIFICATE_STATUS.REVOKED
        ? { revocation: { revokedAt: now, revokedBy: user._id, reason: reason?.trim() } }
        : {}),
    },
    $push: {
      statusHistory: {
        from: expectedFrom,
        to,
        actor: user._id,
        actorRole: user.role,
        note: note?.trim() || reason?.trim() || undefined,
        at: now,
      },
    },
  };

  if (note?.trim()) {
    update.$push.updates = {
      author: user._id,
      authorRole: user.role,
      body: note.trim(),
      at: now,
    };
  }

  const updated = await Certificate.findOneAndUpdate(
    { ...condition, status: expectedFrom },
    update,
    { new: true, runValidators: true }
  );

  if (!updated) {
    throw new ApiError(
      ERROR_CODE.CONFLICT,
      "This certificate was updated by someone else. Refresh and try again.",
      {
        details: [
          { field: "status", message: `Expected ${expectedFrom}`, code: "STALE_STATE" },
        ],
      }
    );
  }

  await auditService.record({
    action: AUDIT_ACTION.STATUS_TRANSITION,
    entity: "Certificate",
    entityId: updated._id,
    entityRef: updated.reference,
    metadata: { from: expectedFrom, to },
    actor: user,
    req,
  });

  await notifyStudent(updated, to, { user });

  return updated;
}

/**
 * Issue the certificate: render the PDF, store it, mark it GENERATED.
 *
 * The only function permitted to write the issue record. It refuses unless an
 * approval exists, which is what makes "uploaded a file" and "issued a
 * certificate" genuinely different events.
 */
async function generate({ certificateId, user, req }) {
  const certificate = await Certificate.findOne(
    /^[a-f\d]{24}$/i.test(String(certificateId))
      ? { _id: certificateId }
      : { reference: String(certificateId) }
  );

  if (!certificate) {
    throw ApiError.notFound("Certificate not found");
  }

  if (!userHasPermission(user, P.CERTIFICATE_APPROVE)) {
    throw ApiError.forbidden("You do not have permission to issue certificates");
  }

  if (!canRead(certificate, user)) {
    throw ApiError.notFound("Certificate not found");
  }

  if (certificate.status !== CERTIFICATE_STATUS.APPROVED) {
    throw new ApiError(
      ERROR_CODE.INVALID_TRANSITION,
      `Only an approved certificate can be issued (this one is ${certificate.status})`
    );
  }

  if (!certificate.approvedBy) {
    // An approval without an approver means the record was tampered with or
    // written outside the workflow. Refuse rather than paper over it.
    throw ApiError.conflict("This certificate has no recorded approver");
  }

  // Identity comes from the database, never from the request body.
  //
  // Sequenced rather than a single Promise.all because the programme lookup
  // depends on the student document, which is not available until the first
  // query resolves.
  const student = await Student.findById(certificate.student)
    .populate("user", "fullName")
    .lean();

  if (!student) {
    throw ApiError.notFound("The student for this certificate no longer exists");
  }

  const [department, program] = await Promise.all([
    certificate.department ? Department.findById(certificate.department).lean() : null,
    student.program ? Program.findById(student.program).lean() : null,
  ]);

  const verificationCode = generateVerificationCode();

  const pdfBuffer = await renderCertificate({
    certificate: { ...certificate.toObject(), verificationCode, issuedAt: new Date() },
    student,
    department,
    program,
    issuer: user,
  });

  const storage = getStorage();
  const stored = await storage.save(pdfBuffer, {
    folder: "certificates",
    filename: `${certificate.reference}.pdf`,
    mimeType: "application/pdf",
  });

  const now = new Date();

  /**
   * The "issued" invariant, enforced here rather than as a schema validator.
   *
   * A `findOneAndUpdate` validates the pre-update document, so a field validator
   * requiring `status: GENERATED` to come with an issuer and a stored document
   * would reject the very update that issues the certificate — the new values
   * are not visible yet when validation runs. Checking it here, immediately
   * before the single atomic write that sets all four fields, gives the same
   * guarantee without breaking legitimate issuance.
   */
  if (!stored.key || !user?._id) {
    // Unreachable in practice; present so a future refactor that skips a step
    // fails loudly here instead of writing a half-issued certificate.
    throw new ApiError(ERROR_CODE.INTERNAL_ERROR, "Could not complete the issue record");
  }

  // `validateBeforeSave` is no longer needed: the document now carries a real
  // `enum` on status, which `runValidators` checks against the update.
  const issued = await Certificate.findOneAndUpdate(
    { _id: certificate._id, status: CERTIFICATE_STATUS.APPROVED },
    {
      $set: {
        status: CERTIFICATE_STATUS.GENERATED,
        issuedBy: user._id,
        issuedAt: now,
        verificationCode,
        document: {
          storageKey: stored.key,
          originalName: `${certificate.reference}.pdf`,
          mimeType: "application/pdf",
          bytes: stored.bytes,
          adapter: stored.adapter,
          generatedAt: now,
        },
      },
      $push: {
        statusHistory: {
          from: CERTIFICATE_STATUS.APPROVED,
          to: CERTIFICATE_STATUS.GENERATED,
          actor: user._id,
          actorRole: user.role,
          note: "Certificate generated and issued",
          at: now,
        },
      },
    },
    { new: true, runValidators: true }
  );

  if (!issued) {
    // The approval was superseded between read and write.
    throw new ApiError(
      ERROR_CODE.CONFLICT,
      "This certificate was updated while it was being issued"
    );
  }

  await auditService.record({
    action: AUDIT_ACTION.CERTIFICATE_GENERATED,
    entity: "Certificate",
    entityId: issued._id,
    entityRef: issued.reference,
    metadata: { type: issued.type, adapter: stored.adapter, bytes: stored.bytes },
    actor: user,
    req,
  });

  await notificationService.notify({
    userId: (await resolveStudentUserId(certificate.student)) ?? null,
    type: "CERTIFICATE_READY",
    title: `Your ${issued.type.replace(/_/g, " ").toLowerCase()} certificate is ready`,
    body: `Reference ${issued.reference}. You can download it from your certificates page.`,
    link: `/student/certificates/${issued.reference}`,
    dedupeKey: `cert:${issued._id}:generated`,
  });

  return issued;
}

/** Resolve a Student document id to the owning User id, for notifications. */
async function resolveStudentUserId(studentId) {
  const student = await Student.findById(studentId).select("user").lean();
  return student?.user?.toString() ?? null;
}

async function notifyStudent(certificate, to) {
  const userId = await resolveStudentUserId(certificate.student);
  if (!userId) return;

  const messages = {
    [CERTIFICATE_STATUS.VERIFYING]: {
      type: "CERTIFICATE_STATUS_CHANGED",
      title: `Certificate ${certificate.reference} is being verified`,
      body: "Your certificate application is under verification.",
    },
    [CERTIFICATE_STATUS.APPROVED]: {
      type: "CERTIFICATE_STATUS_CHANGED",
      title: `Certificate ${certificate.reference} approved`,
      body: "Your certificate application has been approved.",
    },
    [CERTIFICATE_STATUS.REJECTED]: {
      type: "CERTIFICATE_STATUS_CHANGED",
      title: `Certificate ${certificate.reference} rejected`,
      body: "Your certificate application was not approved. See the details provided.",
    },
    [CERTIFICATE_STATUS.REVOKED]: {
      type: "CERTIFICATE_STATUS_CHANGED",
      title: `Certificate ${certificate.reference} revoked`,
      body: "A certificate issued to you has been revoked.",
    },
  };

  const message = messages[to];
  if (!message) return;

  await notificationService.notify({
    userId,
    ...message,
    link: `/student/certificates/${certificate.reference}`,
    dedupeKey: `cert:${certificate._id}:${to}`,
  });
}

/**
 * Resolve a download for a certificate.
 *
 * Authorization happens HERE, before any URL or bytes are produced. The
 * returned signed token proves only that this server minted it recently; it
 * carries no identity and confers nothing on a holder who should not have it.
 */
async function resolveDownload({ certificateId, user, token }) {
  const condition = /^[a-f\d]{24}$/i.test(String(certificateId))
    ? { _id: certificateId }
    : { reference: String(certificateId) };

  // A signed token may stand in for a full read, but it is still checked
  // against a live record: revoking a certificate invalidates outstanding links.
  const query = token ? { ...condition, document: { $exists: true } } : { ...condition };

  const certificate = await Certificate.findOne(query).select(
    "reference status document revocation verificationCode student type"
  );

  if (!certificate) {
    throw ApiError.notFound("Certificate not found");
  }

  if (!token && !canRead(certificate, user)) {
    throw ApiError.notFound("Certificate not found");
  }

  if (token && certificate.document?.storageKey) {
    if (!verifyDownloadToken(certificate.document.storageKey, token)) {
      throw ApiError.forbidden("This download link is invalid or has expired");
    }
  }

  // Only a live, issued certificate is downloadable.
  if (certificate.status !== CERTIFICATE_STATUS.GENERATED) {
    throw ApiError.badRequest(
      `This certificate is not available for download (status: ${certificate.status})`
    );
  }

  const key = certificate.document.storageKey;
  const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;

  return {
    reference: certificate.reference,
    type: certificate.type,
    storageKey: key,
    adapter: certificate.document.adapter,
    expiresAt,
    signedToken: signDownloadToken(key, expiresAt),
    filename: certificate.document.originalName ?? `${certificate.reference}.pdf`,
  };
}

/**
 * Stream the certificate bytes to an authenticated caller.
 *
 * Bytes are read only after `resolveDownload` has authorized the request, so
 * this function is reachable exclusively through that path.
 */
async function readDocument({ storageKey }) {
  const storage = getStorage();

  if (typeof storage.getSignedUrl === "function") {
    // Cloudinary: the CDN serves the bytes under its own signature.
    return { redirect: await storage.getSignedUrl(storageKey) };
  }

  const buffer = await storage.read(storageKey);
  return { buffer, filename: undefined };
}

/**
 * Verify a certificate by its printed code.
 *
 * Deliberately narrow: it returns *existence and status*, never the holder's
 * personal data, because a verification code may be read aloud or transcribed.
 */
async function verifyByCode({ code }) {
  const certificate = await Certificate.findOne({
    verificationCode: String(code).trim().toUpperCase(),
  }).select("reference type status issuedAt revocation verificationCode");

  if (!certificate) {
    return { found: false };
  }

  return {
    found: true,
    valid: certificate.status === CERTIFICATE_STATUS.GENERATED,
    reference: certificate.reference,
    type: certificate.type,
    issuedAt: certificate.issuedAt,
    revokedAt: certificate.revocation?.revokedAt ?? null,
  };
}

/** Revoke an issued certificate. */
async function revoke({ certificateId, user, reason, req }) {
  return transition({
    certificateId,
    to: CERTIFICATE_STATUS.REVOKED,
    expectedFrom: CERTIFICATE_STATUS.GENERATED,
    user,
    reason,
    req,
  });
}

module.exports = {
  apply,
  list,
  get,
  transition,
  generate,
  revoke,
  resolveDownload,
  readDocument,
  verifyByCode,
  canRead,
  buildVisibilityFilter,
  buildDownloadableFilter,
  generateVerificationCode,
  generateReference,
  transitionsFrom,
  CERTIFICATE_TRANSITIONS,
};
