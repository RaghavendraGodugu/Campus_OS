/**
 * Audit trail controller.
 *
 * Read-only by construction: this controller exposes no way to create, amend or
 * remove an entry. Writes happen inside the workflows themselves, through
 * `audit.service.record`.
 */

const auditQueryService = require("../services/audit-query.service");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");

/** GET /api/v1/audit */
const query = asyncHandler(async (req, res) => {
  const result = await auditQueryService.queryAudit({
    user: req.user,
    ...req.validated.query,
  });

  return sendPaginated(res, {
    items: result.items,
    total: result.total,
    page: result.page,
    limit: result.limit,
    message: "Audit trail retrieved successfully",
    // Stated on every response so a reader never mistakes a narrowed view for
    // the whole trail.
    scope: result.scope,
    scopeNote: result.scopeNote,
    period: result.period,
  });
});

/** GET /api/v1/audit/denied — the access-denied investigation trail. */
const denied = asyncHandler(async (req, res) => {
  const result = await auditQueryService.deniedAccessTrail({
    user: req.user,
    ...req.validated.query,
  });

  return sendPaginated(res, {
    items: result.items,
    total: result.total,
    page: result.page,
    limit: result.limit,
    message: "Access-denied trail retrieved successfully",
    scope: result.scope,
    period: result.period,
  });
});

/** GET /api/v1/audit/trail — the history of one resource. */
const trail = asyncHandler(async (req, res) => {
  const result = await auditQueryService.auditTrailFor({
    user: req.user,
    entityId: req.validated.query.entityId,
    entityRef: req.validated.query.entityRef,
    limit: req.validated.query.limit,
  });

  return sendSuccess(res, {
    message: "Resource audit trail retrieved successfully",
    data: {
      scope: result.scope,
      scopeNote: result.scopeNote,
      total: result.total,
      items: result.items,
    },
  });
});

module.exports = { query, denied, trail };
