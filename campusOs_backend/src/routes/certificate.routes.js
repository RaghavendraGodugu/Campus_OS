/**
 * Certificate routes.
 *
 * The download route is deliberately separated from the generic `/:id` route and
 * declared before it, so `/verify` is never captured as an identifier.
 *
 * `download` is NOT behind `authenticate` alone: the controller calls
 * `resolveDownload`, which either requires a full read permission or a valid
 * signed token. That keeps the endpoint usable from an emailed link while still
 * refusing a guessed id.
 */

const express = require("express");

const certificateController = require("../controllers/certificate.controller");
const {
  createTemplateSchema,
  updateTemplateSchema,
  templateIdentifier,
  listTemplatesSchema,
  bulkIssueSchema,
  previewSchema,
} = require("../validators/certificateTemplate.validator");
const { validate } = require("../middleware/validate");
const {
  authenticate,
  optionalAuthenticate,
  requirePermission,
  requireAnyPermission,
  requireStudentAccount,
} = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { P } = require("../utils/permissions");
const {
  applySchema,
  listSchema,
  getSchema,
  transitionSchema,
  issueSchema,
  revokeSchema,
  verifySchema,
} = require("../validators/certificate.validator");

const router = express.Router();

/** GET /api/v1/certificates/verify — authenticity check by printed code. */
router.get(
  "/certificates/verify",
  validate({ query: verifySchema }),
  certificateController.verify
);

/** POST /api/v1/certificates — students only. */
router.post(
  "/certificates",
  authenticate,
  csrfProtection,
  requirePermission(P.CERTIFICATE_APPLY),
  requireStudentAccount,
  validate({ body: applySchema }),
  certificateController.apply
);

/** GET /api/v1/certificates — scope-filtered. */
router.get(
  "/certificates",
  authenticate,
  validate({ query: listSchema }),
  certificateController.list
);

/**
 * GET /api/v1/certificates/:id/download
 *
 * `authenticate` runs here so `req.user` is populated for the normal,
 * session-based download. A caller with neither a valid session nor a valid
 * signed token simply reaches the controller with no user and is refused by
 * `resolveDownload` — which is what keeps this endpoint usable from an emailed
 * link without making it anonymous.
 */
router.get(
  "/certificates/:id/download",
  optionalAuthenticate,
  validate({ params: getSchema }),
  certificateController.download
);

/** GET /api/v1/certificates/:id */
router.get(
  "/certificates/:id",
  authenticate,
  validate({ params: getSchema }),
  certificateController.get
);

/** POST /api/v1/certificates/:id/transition */
router.post(
  "/certificates/:id/transition",
  authenticate,
  csrfProtection,
  validate({ params: getSchema, body: transitionSchema }),
  certificateController.transition
);

/**
 * POST /api/v1/certificates/:id/issue
 *
 * Gated on the issue permission. The service additionally refuses unless the
 * certificate is APPROVED with a recorded approver, so holding the permission
 * alone cannot manufacture an issued certificate from a draft.
 */
router.post(
  "/certificates/:id/issue",
  authenticate,
  csrfProtection,
  requirePermission(P.CERTIFICATE_ISSUE),
  validate({ params: getSchema, body: issueSchema }),
  certificateController.issue
);

/** POST /api/v1/certificates/:id/revoke */
router.post(
  "/certificates/:id/revoke",
  authenticate,
  csrfProtection,
  requirePermission(P.CERTIFICATE_REVOKE),
  validate({ params: getSchema, body: revokeSchema }),
  certificateController.revoke
);

/**
 * Certificate templates and bulk issuance.
 *
 * Templates are read by any staff who can issue; writing one is an
 * institution-wide act, because the default for a certificate type decides what
 * every subsequently issued document of that type says.
 */
router.get(
  "/certificate-templates",
  authenticate,
  requireAnyPermission(P.CERTIFICATE_ISSUE),
  validate({ query: listTemplatesSchema }),
  certificateController.listTemplates
);

router.post(
  "/certificate-templates/preview",
  authenticate,
  requireAnyPermission(P.CERTIFICATE_ISSUE),
  validate({ body: previewSchema }),
  certificateController.previewTemplate
);

router.post(
  "/certificate-templates",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.CERTIFICATE_ISSUE),
  validate({ body: createTemplateSchema }),
  certificateController.createTemplate
);

router.patch(
  "/certificate-templates/:id",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.CERTIFICATE_ISSUE),
  validate({ params: templateIdentifier, body: updateTemplateSchema }),
  certificateController.updateTemplate
);

router.delete(
  "/certificate-templates/:id",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.CERTIFICATE_ISSUE),
  validate({ params: templateIdentifier }),
  certificateController.deleteTemplate
);

/**
 * POST /api/v1/certificates/bulk-issue
 *
 * Declared before the `/:reference/...` routes below so the literal segment is
 * never captured as a certificate reference.
 */
router.post(
  "/certificates/bulk-issue",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.CERTIFICATE_ISSUE),
  validate({ body: bulkIssueSchema }),
  certificateController.bulkIssue
);

module.exports = router;
