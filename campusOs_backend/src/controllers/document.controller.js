/**
 * Document controller.
 *
 * Authorization for every read is decided in the service, from the document's
 * own ownership and visibility. Nothing here trusts the request.
 */

const documentService = require("../services/document.service");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated } = require("../utils/response");

function present(document) {
  return {
    id: document.id ?? document._id,
    originalName: document.originalName,
    mimeType: document.mimeType,
    size: document.size,
    label: document.label ?? null,
    visibility: document.visibility,
    createdAt: document.createdAt,
  };
}

/** POST /api/v1/requests/:id/documents */
const uploadForRequest = asyncHandler(async (req, res) => {
  const document = await documentService.attachToRequest({
    user: req.user,
    requestId: req.params.id,
    file: req.file,
    label: req.body?.label,
    req,
  });

  return sendCreated(res, {
    message: document.satisfiesRequired
      ? "Document attached and recorded against a required item"
      : "Document attached",
    data: {
      document: present(document),
      satisfiesRequired: document.satisfiesRequired ?? false,
    },
  });
});

/** GET /api/v1/requests/:id/documents */
const listForRequest = asyncHandler(async (req, res) => {
  const items = await documentService.listForRequest({
    user: req.user,
    requestId: req.params.id,
  });

  return sendSuccess(res, {
    message: `${items.length} document(s) attached`,
    data: items.map(present),
    meta: {
      total: items.length,
      missing: await documentService.missingRequiredDocuments({
        requestId: req.params.id,
      }),
    },
  });
});

/** POST /api/v1/certificates/:id/documents */
const uploadForCertificate = asyncHandler(async (req, res) => {
  const document = await documentService.attachToCertificate({
    user: req.user,
    certificateId: req.params.id,
    file: req.file,
    label: req.body?.label,
    req,
  });

  return sendCreated(res, {
    message: "Document attached",
    data: { document: present(document) },
  });
});

/** GET /api/v1/certificates/:id/documents */
const listForCertificate = asyncHandler(async (req, res) => {
  const items = await documentService.listForCertificate({
    user: req.user,
    certificateId: req.params.id,
  });

  return sendSuccess(res, {
    message: `${items.length} document(s) attached`,
    data: items.map(present),
    meta: { total: items.length },
  });
});

/**
 * GET /api/v1/documents/:id/download
 *
 * Served as an attachment with a policy that forbids scripts. A PDF is an
 * active document format: one containing JavaScript, opened from this origin,
 * could script it. Attachment disposition plus a script-free policy means it
 * cannot.
 */
const download = asyncHandler(async (req, res) => {
  const resolved = await documentService.resolveDownload({
    user: req.user,
    documentId: req.params.id,
  });

  const { buffer } = await documentService.readBytes({
    storageKey: resolved.storageKey,
    mimeType: resolved.mimeType,
  });

  res.setHeader("Content-Type", resolved.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${resolved.originalName}"`);
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");

  return res.send(buffer);
});

/** DELETE /api/v1/documents/:id */
const remove = asyncHandler(async (req, res) => {
  const result = await documentService.deleteDocument({
    user: req.user,
    documentId: req.params.id,
    req,
  });

  return sendSuccess(res, { message: "Document removed", data: result });
});
module.exports = {
  uploadForRequest,
  listForRequest,
  uploadForCertificate,
  listForCertificate,
  download,
  remove,
};
