/**
 * Certificate controller.
 *
 * The download endpoint is the security-critical one: authorization is resolved
 * by `certificate.service.resolveDownload` **before** any bytes or URL are
 * produced. Nothing here can bypass that, because it holds no logic of its own.
 */

const certificateService = require("../services/certificate.service");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated, sendPaginated } = require("../utils/response");
const { ApiError } = require("../utils/ApiError");
const { userHasPermission } = require("../utils/permissions");

/** POST /api/v1/certificates — apply. */
const apply = asyncHandler(async (req, res) => {
  const { type, purpose, copies, department } = req.validated.body;

  const certificate = await certificateService.apply({
    user: req.user,
    type,
    purpose,
    copies,
    department,
    req,
  });

  return sendCreated(res, {
    message: "Certificate application submitted",
    data: {
      id: certificate._id,
      reference: certificate.reference,
      type: certificate.type,
      status: certificate.status,
    },
  });
});

/** GET /api/v1/certificates — scope-filtered. */
const list = asyncHandler(async (req, res) => {
  const { page, limit, ...filters } = req.validated.query;

  const result = await certificateService.list({
    user: req.user,
    filters,
    page,
    limit,
  });

  return sendPaginated(res, {
    items: result.items,
    total: result.total,
    page: result.page,
    limit: result.limit,
    message: "Certificates retrieved successfully",
  });
});

/** GET /api/v1/certificates/:id */
const get = asyncHandler(async (req, res) => {
  const certificate = await certificateService.get({
    certificateId: req.validated.params.id,
    user: req.user,
  });

  const payload = certificate.toJSON ? certificate.toJSON() : { ...certificate };

  // Never expose the storage key: it is an internal handle, not a capability.
  if (payload.document) {
    delete payload.document.storageKey;
    payload.downloadable = certificate.status === "GENERATED";
  }

  payload.availableTransitions = certificateService
    .transitionsFrom(certificate.status)
    .filter((t) => userHasPermission(req.user, t.permission))
    .map((t) => ({ to: t.to, label: t.label, reasonRequired: t.reasonRequired }));

  return sendSuccess(res, {
    message: "Certificate retrieved successfully",
    data: payload,
  });
});

/** POST /api/v1/certificates/:id/transition */
const transition = asyncHandler(async (req, res) => {
  const { to, expectedFrom, reason, note } = req.validated.body;

  const certificate = await certificateService.transition({
    certificateId: req.validated.params.id,
    to,
    expectedFrom,
    reason,
    note,
    user: req.user,
    req,
  });

  return sendSuccess(res, {
    message: `Certificate moved to ${certificate.status}`,
    data: { reference: certificate.reference, status: certificate.status },
  });
});

/**
 * POST /api/v1/certificates/:id/issue
 *
 * Renders the PDF, stores it, and records the issue. The only route that can
 * make a certificate issued.
 */
const issue = asyncHandler(async (req, res) => {
  const certificate = await certificateService.generate({
    certificateId: req.validated.params.id,
    user: req.user,
    req,
  });

  return sendSuccess(res, {
    message: "Certificate generated and issued",
    data: {
      reference: certificate.reference,
      status: certificate.status,
      verificationCode: certificate.verificationCode,
      issuedAt: certificate.issuedAt,
    },
  });
});

/** POST /api/v1/certificates/:id/revoke */
const revoke = asyncHandler(async (req, res) => {
  const certificate = await certificateService.revoke({
    certificateId: req.validated.params.id,
    user: req.user,
    reason: req.validated.body.reason,
    req,
  });

  return sendSuccess(res, {
    message: "Certificate revoked",
    data: { reference: certificate.reference, status: certificate.status },
  });
});

/**
 * GET /api/v1/certificates/:id/download
 *
 * Authorization first, bytes second. An optional `token` query parameter lets a
 * previously-authorized holder re-fetch the file from the signed link, and the
 * token is still validated against the live record — revoking a certificate
 * invalidates outstanding links.
 */
const download = asyncHandler(async (req, res) => {
  const { id } = req.validated.params;
  const token = req.query.token;

  const resolved = await certificateService.resolveDownload({
    certificateId: id,
    user: req.user,
    token,
  });

  const payload = await certificateService.readDocument({
    storageKey: resolved.storageKey,
  });

  if (payload.redirect) {
    // Cloudinary serves the bytes under its own short-lived signature.
    return res.redirect(302, payload.redirect);
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${resolved.filename}"`);
  // A downloadable certificate must not be cached by shared proxies.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  return res.send(payload.buffer);
});

/**
 * GET /api/v1/certificates/verify?code=...
 *
 * Public-ish authenticity check for a printed code. Returns existence and
 * validity only — never the holder's identity, because a code may be read
 * aloud.
 */
const verify = asyncHandler(async (req, res) => {
  const result = await certificateService.verifyByCode({
    code: req.validated.query.code,
  });

  if (!result.found) {
    throw ApiError.notFound("No certificate matches that code");
  }

  return sendSuccess(res, {
    message: result.valid
      ? "Certificate is authentic"
      : "Certificate is not currently valid",
    data: result,
  });
});

module.exports = {
  apply,
  list,
  get,
  transition,
  issue,
  revoke,
  download,
  verify,
};
