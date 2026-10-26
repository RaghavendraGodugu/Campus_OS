/**
 * Request routes.
 *
 * ## Middleware order per route
 *
 * `authenticate` -> `csrfProtection` -> `validate` -> controller.
 *
 * CSRF runs before validation so a forged cross-site request is rejected on
 * that ground alone, rather than reaching handler code. `authenticate` must
 * precede `csrfProtection` because the CSRF token is bound to the caller's
 * identity.
 *
 * ## Permissions on the route vs. in the service
 *
 * `requirePermission` here answers "may this role use this endpoint at all?".
 * The service layer answers "may this caller use it for *this* request?", which
 * only the database query and the atomic transition filter can decide. Both
 * are required; neither substitutes for the other.
 */

const express = require("express");

const requestController = require("../controllers/request.controller");
const { validate } = require("../middleware/validate");
const {
  authenticate,
  requirePermission,
  requireAnyPermission,
  requireStudentAccount,
} = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { P } = require("../utils/permissions");
const {
  createRequestSchema,
  listRequestsSchema,
  getRequestSchema,
  transitionSchema,
  commentSchema,
  internalNoteSchema,
  assignSchema,
  createRequestTypeSchema,
  listRequestTypesSchema,
  objectId,
} = require("../validators/request.validator");
const { z } = require("zod");

const router = express.Router();

// ===== Request types (catalogue) =====

/**
 * GET /api/v1/request-types
 * Available to any signed-in user: a student needs the catalogue to apply.
 */
router.get(
  "/request-types",
  authenticate,
  validate({ query: listRequestTypesSchema }),
  requestController.listRequestTypes
);

/** GET /api/v1/request-types/:id */
router.get(
  "/request-types/:id",
  authenticate,
  validate({ params: z.object({ id: objectId }).strict() }),
  requestController.getRequestType
);

/** POST /api/v1/request-types — catalogue administration. */
router.post(
  "/request-types",
  authenticate,
  csrfProtection,
  requirePermission(P.REQUEST_TYPE_MANAGE),
  validate({ body: createRequestTypeSchema }),
  requestController.createRequestType
);

// ===== Requests =====

/**
 * POST /api/v1/requests
 *
 * `requireStudentAccount` rejects a staff account from submitting "as" a
 * student, which would otherwise be a route to forge student-owned records.
 */
router.post(
  "/requests",
  authenticate,
  csrfProtection,
  requirePermission(P.REQUEST_CREATE),
  requireStudentAccount,
  validate({ body: createRequestSchema }),
  requestController.createRequest
);

/** GET /api/v1/requests — the caller's visible requests, scope-filtered. */
router.get(
  "/requests",
  authenticate,
  requireStudentAccount,
  validate({ query: listRequestsSchema }),
  requestController.listRequests
);

/** GET /api/v1/requests/:id */
router.get(
  "/requests/:id",
  authenticate,
  requireStudentAccount,
  validate({ params: getRequestSchema }),
  requestController.getRequest
);

/**
 * POST /api/v1/requests/:id/transition
 *
 * No route-level permission gate: which transitions are available depends on
 * both the current status and the caller, and both are enforced by the
 * workflow table plus the atomic filter in workflow.service.js. A blanket
 * `requirePermission` here would be wrong — it could not express "approve, but
 * only from APPROVAL_PENDING".
 */
router.post(
  "/requests/:id/transition",
  authenticate,
  csrfProtection,
  validate({ params: getRequestSchema, body: transitionSchema }),
  requestController.transitionRequest
);

/** POST /api/v1/requests/:id/assign */
router.post(
  "/requests/:id/assign",
  authenticate,
  csrfProtection,
  // Disjunction: an HOD may assign within their own department, a principal
  // anywhere. Using requirePermission here (AND) would deny every role.
  requireAnyPermission(P.REQUEST_ASSIGN_DEPARTMENT, P.REQUEST_ASSIGN_INSTITUTION),
  validate({ params: getRequestSchema, body: assignSchema }),
  requestController.assignRequest
);

/** POST /api/v1/requests/:id/comments — student-visible conversation. */
router.post(
  "/requests/:id/comments",
  authenticate,
  csrfProtection,
  validate({ params: getRequestSchema, body: commentSchema }),
  requestController.addComment
);

/** POST /api/v1/requests/:id/internal-notes — staff only. */
router.post(
  "/requests/:id/internal-notes",
  authenticate,
  csrfProtection,
  requirePermission(P.REQUEST_INTERNAL_NOTE),
  validate({ params: getRequestSchema, body: internalNoteSchema }),
  requestController.addInternalNote
);

module.exports = router;
