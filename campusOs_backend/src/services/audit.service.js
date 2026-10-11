/**
 * Audit trail writer.
 *
 * ## What is never recorded
 *
 * The `metadata` field is the risk in this module. An audit entry that copied a
 * complaint body, a document name or a student's date of birth would leak that
 * content to anyone permitted to read audit logs — often a wider audience than
 * the resource itself. `redactMetadata` therefore strips free text and keeps
 * only identifiers and structural facts.
 *
 * ## Failure policy
 *
 * Audit writes must never break the request they describe. A failed write is
 * logged at error level and swallowed, so a full audit collection cannot take
 * the API offline. For actions where the absence of an audit entry is itself a
 * security failure (approvals, payments, role changes), the *action* is rolled
 * back by the caller before this returns — the write is awaited there.
 */

const AuditLog = require("../models/AuditLog");
const { logger } = require("../config/logger");
const { AUDIT_ACTION } = require("../config/constants");

/**
 * Keys that must never appear in audit metadata, at any depth.
 * Matched case-insensitively against the key name.
 */
const FORBIDDEN_METADATA_KEYS = new Set([
  "body",
  "description",
  "details",
  "narrative",
  "notes",
  "text",
  "message",
  "comment",
  "reason_detail",
  "address",
  "dob",
  "dateofbirth",
  "password",
  "passwordHash",
  "token",
  "refreshToken",
  "accessToken",
  "fileContent",
]);

/** Values longer than this are almost certainly free text, not an identifier. */
const MAX_METADATA_VALUE_LENGTH = 200;

/** Maximum keys retained, so one event cannot write an unbounded document. */
const MAX_METADATA_KEYS = 25;

/** Maximum nesting depth walked by the redactor. */
const MAX_METADATA_DEPTH = 3;

/**
 * Strip unsafe values from audit metadata.
 *
 * @param {*} value
 * @param {number} [depth]
 * @returns {*} Sanitised, JSON-safe copy.
 */
function redactMetadata(value, depth = 0) {
  if (value === null || value === undefined) return value;

  // Stop at primitives once past the root object.
  if (typeof value !== "object") {
    return typeof value === "string" && value.length > MAX_METADATA_VALUE_LENGTH
      ? `${value.slice(0, MAX_METADATA_VALUE_LENGTH)}…[truncated]`
      : value;
  }

  if (depth >= MAX_METADATA_DEPTH) return "[depth-limited]";

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => redactMetadata(item, depth + 1));
  }

  const out = {};
  let count = 0;

  for (const [key, val] of Object.entries(value)) {
    if (count >= MAX_METADATA_KEYS) break;

    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
      out[key] = "[redacted]";
      count++;
      continue;
    }

    if (val === null || typeof val !== "object") {
      if (typeof val === "string" && val.length > MAX_METADATA_VALUE_LENGTH) {
        out[key] = `${val.slice(0, MAX_METADATA_VALUE_LENGTH)}…[truncated]`;
      } else {
        out[key] = val;
      }
      count++;
      continue;
    }

    out[key] = redactMetadata(val, depth + 1);
    count++;
  }

  return out;
}

/**
 * Write one audit entry.
 *
 * @param {object} params
 * @param {string} params.action  An `AUDIT_ACTION` value.
 * @param {string} params.entity  Resource type, e.g. "Request".
 * @param {string} [params.entityId]
 * @param {string} [params.entityRef] Human-readable reference.
 * @param {object} [params.metadata]
 * @param {object} [params.actor]  A User document; omit for system events.
 * @param {object} [params.req]    Express request, for ip/userAgent/requestId.
 * @returns {Promise<object|null>} The entry, or null if the write failed.
 */
async function record({ action, entity, entityId, entityRef, metadata, actor, req }) {
  try {
    return await AuditLog.create({
      action,
      entity: String(entity || "Unknown").toUpperCase(),
      entityId: entityId ?? null,
      entityRef: entityRef ?? null,
      metadata: redactMetadata(metadata ?? {}),
      actor: actor?._id ?? null,
      // Denormalised so the trail survives deletion of the user document.
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? "SYSTEM",
      requestId: req?.id ?? null,
      // `req.ip` honours `trust proxy`; fall back to the raw socket address.
      ip: req?.ip ?? req?.socket?.remoteAddress ?? null,
      userAgent: req?.get?.("user-agent")?.slice(0, 300) ?? null,
    });
  } catch (error) {
    logger.error(
      { err: error, action, entity, entityId },
      "Failed to write audit entry — the audited action still completed"
    );
    return null;
  }
}

/**
 * Record an access denial.
 *
 * Called from services when a request is rejected at the resource level (not
 * just the route level), because those denials are the ones that indicate a
 * probing attempt.
 */
async function recordAccessDenied({ req, user, entity, entityId, required }) {
  return record({
    action: AUDIT_ACTION.ACCESS_DENIED,
    entity,
    entityId,
    metadata: { required },
    actor: user,
    req,
  });
}

module.exports = {
  record,
  recordAccessDenied,
  redactMetadata,
  FORBIDDEN_METADATA_KEYS,
};
