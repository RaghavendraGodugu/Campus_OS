/**
 * SLA escalation sweep.
 *
 * ## Idempotency is the whole point
 *
 * The spec (§10) requires that duplicate escalation and duplicate notification
 * jobs not occur where retries happen. Scheduled jobs retry — a crash, a
 * redeploy, a manual re-run — and an unguarded sweep would escalate the same
 * complaint twice, notify two sets of people, and produce an audit trail that
 * lies about what happened.
 *
 * The guard is a `dedupeKey` written **into the complaint document**, so the
 * write and the marker are a single atomic operation:
 *
 *   - the update filter requires the marker not to exist yet
 *   - two concurrent runs cannot both match, because MongoDB re-evaluates a
 *     single-document predicate under the document lock
 *
 * Re-running the sweep is therefore safe by construction, not by bookkeeping.
 *
 * ## Levels
 *
 * Escalation is cumulative. Level N fires when the complaint has been overdue
 * for `afterHours` business time beyond its deadline, and stops at
 * MAX_ESCALATION_LEVEL.
 */

const Complaint = require("../models/Complaint");
const User = require("../models/User");
const { logger } = require("../config/logger");
const { ROLES, NOTIFICATION_TYPE, AUDIT_ACTION } = require("../config/constants");
const slaPolicy = require("../utils/slaPolicy");
const slaUtils = require("../utils/sla");
const notificationService = require("../services/notification.service");
const auditService = require("../services/audit.service");

/**
 * Build the dedupe key for a (complaint, level) pair.
 *
 * Deterministic and human-readable, so an operator reading the escalation log
 * can see immediately that a repeated entry is a retry rather than a second
 * decision.
 */
function escalationDedupeKey(complaintId, level) {
  return `esc:${complaintId}:L${level}`;
}

/**
 * How many business minutes past its deadline a complaint is.
 *
 * @returns {number} Negative when still inside the deadline.
 */
function overdueMinutes(complaint, now) {
  if (!complaint.dueAt) return 0;
  return slaUtils.businessMinutesBetween(
    complaint.dueAt,
    now,
    slaPolicy.calendarOptions()
  );
}

/**
 * Sweep for overdue complaints and escalate them.
 *
 * @param {object} [options]
 * @param {Date} [options.now]  Injectable clock, for deterministic tests.
 * @param {boolean} [options.dryRun] Report what would happen without writing.
 * @returns {Promise<{scanned:number, escalated:number, skipped:number, breaches:Array}>}
 */
async function runEscalationSweep({ now = new Date(), dryRun = false } = {}) {
  // Only unresolved complaints whose response clock is still running.
  const candidates = await Complaint.find({
    dueAt: { $lt: now },
    respondedAt: null,
    resolvedAt: null,
    isDemo: { $ne: true },
  })
    // NOTE: `dueAt` MUST appear in the projection. The query filters on it and
    // `overdueMinutes` reads it; omitting it from `.select()` silently yields
    // `undefined` for every candidate, making each one appear zero minutes
    // overdue, so escalation would never advance past level 1. Any field used by
    // the filter or the loop body belongs here.
    .select(
      "_id reference dueAt department assignedTo escalationLevel escalations confidential priority"
    )
    .limit(500)
    .lean();

  const result = { scanned: candidates.length, escalated: 0, skipped: 0, breaches: [] };

  for (const complaint of candidates) {
    const overdue = overdueMinutes(complaint, now);

    if (overdue < 0) continue;

    // Level 1 fires as soon as the deadline passes. Each subsequent level
    // requires the complaint to have been overdue for that level's `afterHours`
    // of additional business time.
    const reachable = slaPolicy.ESCALATION_LADDER.filter((step) =>
      step.afterHours === 0 ? overdue >= 0 : overdue >= step.afterHours * 60
    );

    if (reachable.length === 0) continue;

    const target = reachable[reachable.length - 1];
    const nextLevel = Math.min(target.level, slaPolicy.MAX_ESCALATION_LEVEL);

    if (complaint.escalationLevel >= nextLevel) {
      result.skipped += 1;
      continue;
    }

    const dedupeKey = escalationDedupeKey(complaint._id.toString(), nextLevel);

    if (dryRun) {
      result.escalated += 1;
      result.breaches.push({
        reference: complaint.reference,
        level: nextLevel,
        overdueBusinessMinutes: overdue,
      });
      continue;
    }

    // Atomic: match only while this level's marker is absent.
    //
    // The guard is `{"escalations.dedupeKey": {$ne: dedupeKey}}`, NOT
    // `{$not: {$elemMatch: ...}}`. In MongoDB a `$not` wrapping `$elemMatch`
    // fails to match a document whose array is *empty*, so the first-ever
    // escalation of every complaint would silently match nothing — and the
    // sweep would report "skipped" rather than failing loudly. The negated
    // field comparison matches an empty array correctly.
    const updated = await Complaint.findOneAndUpdate(
      {
        _id: complaint._id,
        escalationLevel: { $lt: nextLevel },
        "escalations.dedupeKey": { $ne: dedupeKey },
      },
      {
        $set: { escalationLevel: nextLevel },
        $push: {
          escalations: {
            level: nextLevel,
            escalatedAt: now,
            reason: `Response deadline exceeded by ${slaUtils.formatDuration(overdue)} (business time)`,
            dedupeKey,
            automatic: true,
          },
        },
      },
      { new: true }
    );

    if (!updated) {
      // Another run won the race. Not an error — the sweep is idempotent.
      result.skipped += 1;
      continue;
    }

    result.escalated += 1;
    result.breaches.push({
      reference: updated.reference,
      level: nextLevel,
      overdueBusinessMinutes: overdue,
    });

    await notifyEscalation(updated, nextLevel, overdue);
    await auditService.record({
      action: AUDIT_ACTION.STATUS_TRANSITION,
      entity: "Complaint",
      entityId: updated._id,
      entityRef: updated.reference,
      metadata: {
        event: "SLA_ESCALATION",
        level: nextLevel,
        overdueBusinessMinutes: overdue,
      },
      req: null,
    });

    logger.warn(
      { reference: updated.reference, level: nextLevel, overdueMinutes: overdue },
      "Complaint escalated after SLA breach"
    );
  }

  return result;
}

/**
 * Notify the roles responsible at this escalation level.
 *
 * Notification text is composed from status and timing only — never the
 * complaint's subject or description, which for a confidential matter would
 * defeat the point of the restriction.
 */
async function notifyEscalation(complaint, level, overdueMinutes) {
  const step = slaPolicy.ESCALATION_LADDER.find((s) => s.level === level);
  if (!step?.notifyRoles?.length) return;

  // A confidential complaint's escalation must not reach roles that could not
  // otherwise read it. Oversight roles are already permitted; department roles
  // are not, so they are excluded here.
  const eligibleRoles = complaint.confidential
    ? step.notifyRoles.filter((r) => [ROLES.DEAN, ROLES.PRINCIPAL].includes(r))
    : step.notifyRoles;

  if (eligibleRoles.length === 0) return;

  const recipients = await User.find({
    role: { $in: eligibleRoles },
    isActive: true,
    // Confidential material goes only to oversight roles, and only if their
    // role actually grants the confidential read.
    ...(complaint.confidential ? { role: { $in: [ROLES.DEAN, ROLES.PRINCIPAL] } } : {}),
  })
    .select("_id")
    .lean();

  await notificationService.notifyMany({
    userIds: recipients.map((r) => r._id.toString()),
    type: NOTIFICATION_TYPE.COMPLAINT_ESCALATED,
    title: `Complaint escalation level ${level}`,
    body: `A ${complaint.priority.toLowerCase()}-priority complaint is ${slaUtils.formatDuration(overdueMinutes)} past its response deadline. Reference ${complaint.reference}.`,
    link: `/management/complaints/${complaint.reference}`,
    // One notification per (complaint, level), even if the sweep re-runs.
    dedupeKeyPrefix: `esc:${complaint._id}:L${level}`,
  });
}

/**
 * Freeze the breach figure for complaints whose clock has stopped.
 * Called by the sweep so dashboards do not compute it on every read.
 */
async function freezeBreaches({ now = new Date() } = {}) {
  const closed = await Complaint.find({
    respondedAt: { $ne: null },
    slaBreachMinutes: 0,
    dueAt: { $ne: null },
  })
    .limit(200)
    .lean();

  let updated = 0;
  for (const complaint of closed) {
    const stoppedAt = complaint.respondedAt ?? complaint.resolvedAt ?? now;
    const minutes = slaUtils.businessMinutesBetween(
      complaint.dueAt,
      stoppedAt,
      slaPolicy.calendarOptions()
    );
    if (minutes > 0) {
      const res = await Complaint.updateOne(
        { _id: complaint._id, slaBreachMinutes: 0 },
        { $set: { slaBreachMinutes: minutes } }
      );
      updated += res.modifiedCount ?? 0;
    }
  }
  return updated;
}

module.exports = {
  runEscalationSweep,
  freezeBreaches,
  escalationDedupeKey,
  overdueMinutes,
};
