/**
 * Document uploads.
 *
 * ## The client's file type is a claim
 *
 * A browser sends whatever MIME type it likes, and an attacker sends whatever is
 * useful. So the type recorded on the document is the one **sniffed from the
 * bytes**, and a file whose content does not match the allowed set is refused
 * outright. The declared type is only ever used to phrase a helpful error.
 *
 * ## Nothing unverified is ever written
 *
 * Uploads are buffered, verified, and only then handed to storage. A rejected
 * upload leaves no file behind, so there is no partial artefact for a later
 * request to stumble on.
 *
 * ## The file is not the authorization
 *
 * A storage key proves where a file lives, not who may read it. Every read goes
 * through `resolveDownload`, which decides from the document's own ownership and
 * visibility — never from the key, and never from anything the client sends.
 *
 * ## Downloads are never executed in our origin
 *
 * PDFs can contain JavaScript. A document is served with
 * `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and a
 * policy that forbids scripts entirely, so a hostile PDF opened from this origin
 * cannot script it.
 */

const path = require("path");

const Document = require("../models/Document");
const Request = require("../models/Request");
const Certificate = require("../models/Certificate");

const { ApiError } = require("../utils/ApiError");
const { userHasPermission, P } = require("../utils/permissions");
const { ROLES, AUDIT_ACTION } = require("../config/constants");
const { getStorage } = require("../config/storage");
const { MAX_FILE_BYTES } = require("../config/storage");
const { logger } = require("../config/logger");
const auditService = require("./audit.service");

/**
 * Types the platform accepts.
 *
 * An allowlist, never a blocklist: a format nobody has thought of cannot be
 * refused because nobody wrote its extension down.
 */
const ALLOWED = Object.freeze({
  "application/pdf": { extensions: ["pdf"], label: "PDF" },
  "image/jpeg": { extensions: ["jpg", "jpeg"], label: "JPEG image" },
  "image/png": { extensions: ["png"], label: "PNG image" },
});

/**
 * Identify a buffer from its leading bytes.
 *
 * Deliberately hand-written rather than pulled from a dependency: these three
 * signatures are stable, and the failure mode of getting one wrong is refusing
 * valid files — not accepting bad ones.
 *
 * @param {Buffer} buffer
 * @returns {string|null} Verified MIME type, or null when unrecognised.
 */
function sniffMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;

  // PDF: %PDF-
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (PNG.every((byte, index) => buffer[index] === byte)) {
    return "image/png";
  }

  return null;
}

/**
 * Reduce a client-supplied name to something safe to display.
 *
 * Never used to build a storage path — the storage adapter generates the key —
 * but it is shown in an interface and echoed in headers, so it must not carry
 * directory separators, NUL bytes or control characters.
 */
function safeDisplayName(name) {
  const base = path
    .basename(String(name ?? "upload"))
    // eslint-disable-next-line no-control-regex -- the point is to strip them
    .replace(/[\u0000-\u001f\u007f]/g, "");
  const cleaned = base.replace(/[^\w.\- ]+/g, "_").trim();
  return (cleaned || "upload").slice(0, 255);
}

/**
 * Attach a document to a request.
 *
 * @param {object} params
 * @param {object} params.user   The uploader.
 * @param {string} params.requestId
 * @param {object} params.file   Multer memory file.
 * @param {string} [params.label]
 * @param {object} [params.req]
 */
async function attachToRequest({ user, requestId, file, label, req }) {
  const request = await Request.findOne({
    $or: [{ _id: validId(requestId) }, { reference: String(requestId).toUpperCase() }],
  });

  if (!request) {
    throw ApiError.notFound("Request not found");
  }

  // Only the student who raised it may attach to it. Staff may read what is
  // attached, but a clerk cannot quietly add a document to a student's file.
  const isOwner = request.student?.toString() === user.student?.toString();

  if (!isOwner) {
    throw ApiError.forbidden(
      "Only the student who raised this request can attach documents"
    );
  }

  const document = await store({
    user,
    file,
    label,
    owner: { request: request._id, student: request.student },
  });

  // Whether this file fills a slot the request type actually demanded.
  // Reported back rather than enforced: a student who attaches the wrong scan
  // should be told which slot is still outstanding, not refused, because only
  // they can say what is in the photograph.
  document.satisfiesRequired = await isLabelRequired(request.requestType, label);

  await auditService.record({
    action: AUDIT_ACTION.DOCUMENT_UPLOADED,
    entity: "Request",
    entityId: request._id,
    entityRef: request.reference,
    metadata: { documentId: document._id, label: document.label, size: document.size },
    actor: user,
    req,
  });

  return document;
}

/**
 * Attach a document to a certificate application.
 */
async function attachToCertificate({ user, certificateId, file, label, req }) {
  const certificate = await Certificate.findOne({
    $or: [
      { _id: validId(certificateId) },
      { reference: String(certificateId).toUpperCase() },
    ],
  });

  if (!certificate) {
    throw ApiError.notFound("Certificate not found");
  }

  const isOwner = certificate.student?.toString() === user.student?.toString();

  if (!isOwner) {
    throw ApiError.forbidden(
      "Only the student may attach documents to their application"
    );
  }

  // Recorded, but never demanded: a certificate application declares no
  // required documents, so nothing is made of a missing label.
  const document = await store({
    user,
    file,
    label,
    owner: { certificate: certificate._id, student: certificate.student },
  });

  await auditService.record({
    action: AUDIT_ACTION.DOCUMENT_UPLOADED,
    entity: "Certificate",
    entityId: certificate._id,
    entityRef: certificate.reference,
    metadata: { documentId: document._id, label: document.label, size: document.size },
    actor: user,
    req,
  });

  return document;
}

/**
 * Whether this request type demands a document under exactly this name.
 *
 * Matched case-insensitively and trimmed, because a student types "id proof"
 * and the catalogue says "ID proof", and being that strict would report a
 * required document as outstanding while it sits attached.
 */
async function isLabelRequired(requestTypeId, label) {
  if (!requestTypeId) return false;

  const RequestType = require("../models/RequestType");
  const type = await RequestType.findById(requestTypeId)
    .select("requiredDocuments")
    .lean();

  if (!type?.requiredDocuments?.length) return false;

  const wanted = String(label ?? "")
    .trim()
    .toLowerCase();
  return type.requiredDocuments.some(
    (required) =>
      required.required &&
      String(required.name ?? "")
        .trim()
        .toLowerCase() === wanted
  );
}

/**
 * Verify and persist one uploaded file.
 */
async function store({ user, file, label, owner }) {
  if (!file?.buffer || file.buffer.length === 0) {
    throw ApiError.badRequest("The uploaded file is empty.");
  }

  if (file.buffer.length > MAX_FILE_BYTES) {
    throw ApiError.badRequest(
      `File is too large. The maximum is ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`
    );
  }

  const verified = sniffMimeType(file.buffer);

  if (!verified || !ALLOWED[verified]) {
    logger.warn(
      {
        userId: user._id,
        declared: file.mimetype,
        originalName: file.originalname,
        bytes: file.buffer.length,
      },
      "Rejected an upload whose content is not an accepted file type"
    );

    throw ApiError.badRequest(
      `That file type is not accepted. Upload a PDF, JPEG or PNG${
        file.mimetype ? ` (you sent ${file.mimetype})` : ""
      }.`
    );
  }

  const storage = getStorage();

  const stored = await storage.save(file.buffer, {
    folder: "documents",
    // The stored name is generated, never derived from the client's filename.
    // The original is kept on the record for display only.
    filename: `${owner.request ?? owner.certificate}.${ALLOWED[verified].extensions[0]}`,
    mimeType: verified,
  });

  return Document.create({
    storageKey: stored.key,
    originalName: safeDisplayName(file.originalname),
    mimeType: verified,
    size: file.buffer.length,
    uploadedBy: user._id,
    request: owner.request ?? null,
    certificate: owner.certificate ?? null,
    student: owner.student,
    label: label ? String(label).trim().slice(0, 120) : null,
    visibility: "STAFF",
    isDemo: user.settings?.isDemo === true,
  });
}

/** Documents attached to a request, visible to this viewer. */
async function listForRequest({ user, requestId }) {
  const request = await Request.findOne({
    $or: [{ _id: validId(requestId) }, { reference: String(requestId).toUpperCase() }],
  }).select("student department assignedTo");

  if (!request) {
    throw ApiError.notFound("Request not found");
  }

  assertMayReadRequest({ user, request });

  return Document.find({ request: request._id }).sort({ createdAt: -1 }).lean();
}

/** Documents attached to a certificate application. */
async function listForCertificate({ user, certificateId }) {
  const certificate = await Certificate.findOne({
    $or: [
      { _id: validId(certificateId) },
      { reference: String(certificateId).toUpperCase() },
    ],
  }).select("student");

  if (!certificate) {
    throw ApiError.notFound("Certificate not found");
  }

  const isOwner = certificate.student?.toString() === user.student?.toString();
  const isStaff = userHasPermission(user, P.CERTIFICATE_READ_INSTITUTION);

  if (!isOwner && !isStaff) {
    throw ApiError.notFound("Certificate not found");
  }

  return Document.find({ certificate: certificate._id }).sort({ createdAt: -1 }).lean();
}

/**
 * Decide whether this viewer may read a request's documents.
 *
 * Mirrors the request read rule rather than inventing a second one — a document
 * is as sensitive as the request it belongs to.
 */
function assertMayReadRequest({ user, request }) {
  if (user.role === ROLES.STUDENT) {
    if (request.student?.toString() !== user.student?.toString()) {
      throw ApiError.notFound("Request not found");
    }
    return;
  }

  const isAssigned = request.assignedTo?.toString() === user._id.toString();
  const isDepartmental =
    request.department &&
    user.department &&
    request.department.toString() === user.department.toString();

  const allowed =
    isAssigned ||
    (isDepartmental && userHasPermission(user, P.REQUEST_READ_DEPARTMENT)) ||
    userHasPermission(user, P.REQUEST_READ_INSTITUTION);

  if (!allowed) {
    // 404 rather than 403: whether a request exists is not a stranger's business.
    throw ApiError.notFound("Request not found");
  }
}

/**
 * Resolve a document for download, authorising first.
 *
 * @returns {Promise<{storageKey: string, mimeType: string, originalName: string, size: number}>}
 */
async function resolveDownload({ user, documentId }) {
  const document = await Document.findById(documentId);

  if (!document) {
    throw ApiError.notFound("Document not found");
  }

  if (document.request) {
    const request = await Request.findById(document.request).select(
      "student department assignedTo reference"
    );
    if (!request) throw ApiError.notFound("Document not found");
    assertMayReadRequest({ user, request });
  } else if (document.certificate) {
    const certificate = await Certificate.findById(document.certificate).select(
      "student reference"
    );
    const isOwner = certificate?.student?.toString() === user.student?.toString();
    const isStaff = userHasPermission(user, P.CERTIFICATE_READ_INSTITUTION);
    if (!isOwner && !isStaff) throw ApiError.notFound("Document not found");
  } else {
    // An orphan: no owner to authorise against, so nobody may fetch it.
    throw ApiError.notFound("Document not found");
  }

  // A PRIVATE document is the uploader's alone, whoever else may read the parent.
  if (
    document.visibility === "PRIVATE" &&
    document.uploadedBy?.toString() !== user._id.toString()
  ) {
    throw ApiError.notFound("Document not found");
  }

  return {
    storageKey: document.storageKey,
    mimeType: document.mimeType,
    originalName: document.originalName,
    size: document.size,
  };
}

/** Document bytes, fetched server-side from whatever storage adapter is configured. */
async function readBytes({ storageKey, mimeType } = {}) {
  const storage = getStorage();
  return { buffer: await storage.read(storageKey, { mimeType }) };
}

/** Remove a document. Only the uploader may, and only while it is unread. */
async function deleteDocument({ user, documentId, req }) {
  const document = await Document.findById(documentId);

  if (!document) {
    throw ApiError.notFound("Document not found");
  }

  if (document.uploadedBy?.toString() !== user._id.toString()) {
    throw ApiError.forbidden("Only the person who uploaded this document may remove it");
  }

  if (document.request) {
    const request = await Request.findById(document.request).select("status reference");
    // Once work has begun, the document is part of the record.
    if (request && !["DRAFT", "SUBMITTED"].includes(request.status)) {
      throw ApiError.conflict(
        "Documents cannot be removed once the request has started being processed."
      );
    }
  }

  await Document.deleteOne({ _id: document._id });

  // The stored bytes are left in place deliberately: removing them is a
  // storage-adapter concern, and an orphaned file is harmless where an orphaned
  // record would not be.
  logger.info({ documentId: document._id }, "Document record removed");

  void req;
  return { deleted: true };
}

/** Which required documents a request is still missing. */
async function missingRequiredDocuments({ requestId }) {
  const RequestType = require("../models/RequestType");
  const request = await Request.findOne({
    $or: [{ _id: validId(requestId) }, { reference: String(requestId).toUpperCase() }],
  }).select("requestType");

  if (!request) {
    throw ApiError.notFound("Request not found");
  }

  const type = await RequestType.findById(request.requestType)
    .select("requiredDocuments")
    .lean();

  const required = (type?.requiredDocuments ?? []).filter((doc) => doc.required);
  if (required.length === 0) return [];

  const attached = await Document.find({ request: request._id }).select("label").lean();

  const labels = new Set(
    attached.map((doc) =>
      String(doc.label ?? "")
        .trim()
        .toLowerCase()
    )
  );

  return required
    .filter(
      (doc) =>
        !labels.has(
          String(doc.name ?? "")
            .trim()
            .toLowerCase()
        )
    )
    .map((doc) => ({ name: doc.name, description: doc.description ?? null }));
}

/** ObjectId or null — avoids a Mongoose CastError on a non-id. */
function validId(value) {
  return require("mongoose").Types.ObjectId.isValid(value) ? value : null;
}

module.exports = {
  attachToRequest,
  attachToCertificate,
  listForRequest,
  listForCertificate,
  resolveDownload,
  readBytes,
  deleteDocument,
  missingRequiredDocuments,
  sniffMimeType,
  safeDisplayName,
  ALLOWED,
};
