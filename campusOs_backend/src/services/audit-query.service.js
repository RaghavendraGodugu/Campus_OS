/**
 * Audit trail queries — the read side.
 *
 * ## The trail is append-only and read-only
 *
 * Nothing here writes, edits or deletes. The existing `audit.service.record()`
 * is the only way an entry comes into existence, and it stays that way.
 *
 * ## Department scope means "your own actions", and says so
 *
 * `AUDIT_READ_DEPARTMENT` is held only by HODs. The audit entry records who
 * acted, what they acted on, and when — it carries **no department**, so there
 * is nothing to filter a departmental scope by except the actor.
 *
 * Rather than widen the permission to institution scope, which would hand every
 * HOD the whole college's privileged-action history, department scope is
 * resolved to the viewer's own entries and the response states that in its
 * `scope` field. A reader is never left believing they are seeing more than
 * they are.
 *
 * Denormalising a department onto new audit entries would allow genuine
 * departmental filtering, but it would not cover the existing trail and would
 * change every call site that records an action. That is a deliberate later
 * decision, not something to fake here.
 */

const AuditLog = require("../models/AuditLog");
const { ApiError } = require("../utils/ApiError");
const { userHasPermission, P } = require("../utils/permissions");
const { AUDIT_ACTION } = require("../config/constants");

/** Longest window a single audit query may span. */
const MAX_RANGE_DAYS = 366;

const DEFAULT_RANGE_DAYS = 30;

/**
 * What this viewer may read.
 *
 * @returns {{scope: "INSTITUTION"|"DEPARTMENT_OWN_ACTIONS"|"NONE", actorFilter: object|null}}
 */
function resolveAuditScope(user) {
  if (userHasPermission(user, P.AUDIT_READ_INSTITUTION)) {
    return { scope: "INSTITUTION", actorFilter: null, note: null };
  }

  if (userHasPermission(user, P.AUDIT_READ_DEPARTMENT)) {
    return {
      scope: "DEPARTMENT_OWN_ACTIONS",
      actorFilter: { actor: user._id },
      note: "This view is limited to actions you performed. Audit entries do not record a department, so departmental filtering is not available at this access level.",
    };
  }

  throw ApiError.forbidden("You do not have permission to read the audit trail");
}

/** Bound and validate a requested period. */
function resolveAuditRange({ from, to } = {}) {
  const end = to ? new Date(to) : new Date();
  const start = from
    ? new Date(from)
    : new Date(end.getTime() - DEFAULT_RANGE_DAYS * 86400000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw ApiError.badRequest("The audit period contains an invalid date");
  }

  if (start > end) {
    throw ApiError.badRequest("The start of the period must not be after its end");
  }

  const days = (end - start) / 86400000;
  if (days > MAX_RANGE_DAYS) {
    throw ApiError.badRequest(
      `An audit query may span at most ${MAX_RANGE_DAYS} days. Requested ${Math.ceil(days)}.`
    );
  }

  return { from: start, to: end, days: Math.ceil(days) };
}

/**
 * Query the trail.
 *
 * Every filter is optional but the period is always applied, so the query can
 * never become an unbounded collection scan.
 */
async function queryAudit({
  user,
  action,
  entity,
  entityId,
  entityRef,
  actorId,
  from,
  to,
  page = 1,
  limit = 50,
}) {
  const scope = resolveAuditScope(user);
  const period = resolveAuditRange({ from, to });

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);

  const filter = { createdAt: { $gte: period.from, $lte: period.to } };

  // The scope filter is applied first and cannot be overridden by any
  // caller-supplied filter below it.
  if (scope.actorFilter) {
    Object.assign(filter, scope.actorFilter);
  }

  if (action) filter.action = action;
  if (entity) filter.entity = String(entity).trim().toUpperCase();
  if (entityId) filter.entityId = entityId;
  if (entityRef) filter.entityRef = String(entityRef).trim().toUpperCase();

  // A department-scoped viewer may narrow further, never widen.
  if (actorId) {
    if (scope.actorFilter && String(actorId) !== String(user._id)) {
      throw ApiError.forbidden(
        "You may only query your own audit entries at this access level"
      );
    }
    filter.actor = actorId;
  }

  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("actor", "fullName email role")
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  return {
    scope: scope.scope,
    scopeNote: scope.note,
    period: { from: period.from, to: period.to, days: period.days },
    filters: {
      action: action ?? null,
      entity: entity ?? null,
      entityRef: entityRef ?? null,
      actorId: actorId ?? null,
    },
    items: items.map(present),
    total,
    page: safePage,
    limit: safeLimit,
  };
}

/** Shape one entry for a client. */
function present(entry) {
  return {
    id: entry.id ?? entry._id,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    entityRef: entry.entityRef ?? null,
    // Every field is always present, whether or not the user still exists.
    //
    // Omitting `fullName` when the actor has been deleted would give a client
    // two different shapes for the same field, so a deleted user reads as
    // "undefined" in one entry and a name in the next. Null is the honest
    // value: the person is unknown, not nameless.
    actor: entry.actor
      ? {
          id: entry.actor.id ?? entry.actor._id,
          fullName: entry.actor.fullName ?? null,
          email: entry.actor.email ?? null,
          role: entry.actor.role ?? null,
          deleted: false,
        }
      : {
          // Preserved even when the user record is gone, which is the point of
          // denormalising these fields onto the entry.
          id: entry.actor ?? null,
          fullName: null,
          email: entry.actorEmail ?? null,
          role: entry.actorRole ?? "SYSTEM",
          deleted: true,
        },
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
    requestId: entry.requestId ?? null,
    userAgent: entry.userAgent ?? null,
    createdAt: entry.createdAt,
  };
}

/**
 * The full history of one resource.
 *
 * Reachable by reference as well as id, because that is what an administrator
 * has in front of them when investigating.
 */
async function auditTrailFor({ user, entityId, entityRef, limit = 200 }) {
  const scope = resolveAuditScope(user);

  const condition = entityId
    ? { entityId }
    : entityRef
      ? { entityRef: String(entityRef).trim().toUpperCase() }
      : null;

  if (!condition) {
    throw ApiError.badRequest("An audit trail needs a resource id or reference");
  }

  const entries = await AuditLog.find({
    ...condition,
    ...(scope.actorFilter ?? {}),
  })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(1, Number(limit) || 200), 500))
    .populate("actor", "fullName email role")
    .lean();

  return {
    scope: scope.scope,
    scopeNote: scope.note,
    total: entries.length,
    items: entries.map(present),
  };
}

/**
 * The access-denied trail.
 *
 * Backed by a dedicated partial index, because this is the query run when
 * investigating a suspected data-access incident and it is the one most likely
 * to be needed under pressure.
 */
async function deniedAccessTrail({ user, from, to, page = 1, limit = 50 }) {
  const scope = resolveAuditScope(user);

  // Deliberately narrower than the general query: the investigation this
  // serves is never about a department's own conduct.
  if (scope.scope !== "INSTITUTION") {
    throw ApiError.forbidden(
      "The access-denied trail requires institution-wide audit access"
    );
  }

  const period = resolveAuditRange({ from, to });
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);

  const filter = {
    action: AUDIT_ACTION.ACCESS_DENIED,
    createdAt: { $gte: period.from, $lte: period.to },
  };

  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("actor", "fullName email role")
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  return {
    scope: scope.scope,
    period: { from: period.from, to: period.to, days: period.days },
    items: items.map(present),
    total,
    page: safePage,
    limit: safeLimit,
  };
}

module.exports = {
  queryAudit,
  auditTrailFor,
  deniedAccessTrail,
  resolveAuditScope,
  resolveAuditRange,
  MAX_RANGE_DAYS,
};
