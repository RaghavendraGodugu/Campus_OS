/**
 * Document routes.
 *
 * Uploads arrive as multipart. `app.js` already exempts multipart from its
 * JSON-only Content-Type rule, and JSON parsing skips it, so the file reaches
 * the handler intact.
 *
 * ## The CSRF check runs before the file is read
 *
 * `csrfProtection` is declared ahead of the multipart parser on purpose. A
 * rejected upload should cost a header comparison, not 10 MB of buffering — and
 * more to the point, an unauthenticated caller should never get the application
 * to hold their bytes at all.
 */

const express = require("express");

const documentController = require("../controllers/document.controller");
const { validate } = require("../middleware/validate");
const { authenticate, requirePermission } = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { parseSingleFile, requireFile } = require("../middleware/upload");
const { P } = require("../utils/permissions");
const {
  uploadParamsSchema,
  documentParamsSchema,
} = require("../validators/document.validator");

const router = express.Router();

const upload = [authenticate, csrfProtection, parseSingleFile("file"), requireFile];

// ===== Requests =====

/** POST /api/v1/requests/:id/documents — the student who raised it. */
router.post(
  "/requests/:id/documents",
  ...upload,
  requirePermission(P.DOCUMENT_UPLOAD_OWN),
  validate({ params: uploadParamsSchema }),
  documentController.uploadForRequest
);

/** GET /api/v1/requests/:id/documents — owner or staff handling it. */
router.get(
  "/requests/:id/documents",
  authenticate,
  validate({ params: uploadParamsSchema }),
  documentController.listForRequest
);

// ===== Certificates =====

/** POST /api/v1/certificates/:id/documents */
router.post(
  "/certificates/:id/documents",
  ...upload,
  requirePermission(P.DOCUMENT_UPLOAD_OWN),
  validate({ params: uploadParamsSchema }),
  documentController.uploadForCertificate
);

/** GET /api/v1/certificates/:id/documents */
router.get(
  "/certificates/:id/documents",
  authenticate,
  validate({ params: uploadParamsSchema }),
  documentController.listForCertificate
);

// ===== The document itself =====

/**
 * GET /api/v1/documents/:id/download
 *
 * Authorisation is per-document, decided in the service from ownership and
 * visibility. A student cannot reach another student's document by guessing an
 * id.
 */
router.get(
  "/documents/:id/download",
  authenticate,
  validate({ params: documentParamsSchema }),
  documentController.download
);

/** DELETE /api/v1/documents/:id — the uploader, while the parent is untouched. */
router.delete(
  "/documents/:id",
  authenticate,
  csrfProtection,
  validate({ params: documentParamsSchema }),
  documentController.remove
);

module.exports = router;
