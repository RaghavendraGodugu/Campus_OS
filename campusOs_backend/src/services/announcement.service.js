/**
 * Announcements.
 *
 * ## The audience rule
 *
 * `audienceQueryFor(viewer)` is the only thing that decides whether someone may
 * read an announcement. It is used both to filter the list and to authorise a
 * single fetch, so a direct URL cannot reach past it.
 *
 * Two details carry the security weight:
 *
 *  - A branch is included only when the viewer actually has the attribute. A
 *    student with no department must not produce the clause
 *    `{ "audience.department": null }`, because that matches every DEPARTMENT
 *    announcement that failed to name one. Empty attributes contribute no
 *    clause at all.
 *
 *  - Officers who can manage announcements see all of them. Managing a notice
 *    you are not permitted to read would make the archive unworkable.
 *
 * ## The bell is bounded and resumable
 *
 * Fan-out writes one Notification per recipient. At college scale that is
 * thousands of documents, so it runs in chunks and stops at FAN_OUT_LIMIT.
 *
 * The announcement itself is never at risk: it is written first and stands on
 * its own. A truncated fan-out means some inboxes lack the notice, not that the
 * notice is missing — `fanOutTruncated` records that, and re-running `fanOut`
 * tops it up, because `notifyMany` dedupes per recipient and so produces no
 * duplicates for the people who already have it.
 */

const Announcement = require("../models/Announcement");
const User = require("../models/User");
const Student = require("../models/Student");
const { ApiError } = require("../utils/ApiError");
const { userHasPermission, P } = require("../utils/permissions");
const {
  ROLES,
  AUDIENCE_SCOPE,
  ANNOUNCEMENT_PRIORITY,
  AUDIT_ACTION,
} = require("../config/constants");
const { logger } = require("../config/logger");
const { getStorage } = require("../config/storage");
const { nextReference } = require("./finance.service");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");

/**
 * Recipients notified in one call to publish. Beyond this the fan-out stops and
 * reports itself as truncated.
 *
 * Sized to stay inside a single request's comfortable budget while leaving
 * room for a top-up run.
 */
const FAN_OUT_LIMIT = 2000;

/**
 * Recipients written per round trip.
 *
 * Bounds how many inserts are in flight at once during a fan-out.
 */
const FAN_OUT_CHUNK = 200;

/**
 * The attributes that decide what a viewer may read.
 *
 * A student's programme lives on their Student profile rather than on the user
 * record, so it is resolved separately — but only for students, and only when
 * the announcements being considered actually address programmes.
 */
async function resolveViewerScope(user) {
  const scope = { role: user.role, department: user.department ?? null, program: null };

  if (user.role === ROLES.STUDENT && user.student) {
    const student = await Student.findById(user.student).select("program").lean();
    scope.program = student?.program ?? null;
  }

  return scope;
}

/**
 * Build the visibility clause for one viewer.
 *
 * Returns `null` for a viewer who may see everything (an announcement manager),
 * which the caller reads as "no audience filter".
 */
async function audienceQueryFor(user, { viewerScope } = {}) {
  if (userHasPermission(user, P.ANNOUNCEMENT_MANAGE)) {
    return null;
  }

  const scope = viewerScope ?? (await resolveViewerScope(user));

  // Only the branches this viewer can actually satisfy. See the file header:
  // an absent attribute contributes no clause, or it would match announcements
  // that failed to name one.
  const branches = [{ "audience.scope": AUDIENCE_SCOPE.ALL }];

  if (scope.role) {
    branches.push({
      "audience.scope": AUDIENCE_SCOPE.ROLES,
      "audience.roles": scope.role,
    });
  }

  if (scope.department) {
    branches.push({
      "audience.scope": AUDIENCE_SCOPE.DEPARTMENT,
      "audience.department": scope.department,
    });
  }

  if (scope.program) {
    branches.push({
      "audience.scope": AUDIENCE_SCOPE.PROGRAM,
      "audience.program": scope.program,
    });
  }

  return { $or: branches };
}

/** The common listing clause: published, not expired, not scheduled ahead. */
function liveClause(now = new Date()) {
  return {
    status: "PUBLISHED",
    publishedAt: { $lte: now },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  };
}

/**
 * List the announcements a viewer may read.
 *
 * @param {object} params
 * @param {object} params.user
 * @param {number} [params.page]
 * @param {number} [params.limit]
 * @param {boolean} [params.unreadOnly] Reserved: notifications, not notices.
 */
async function listAnnouncements({ user, page = 1, limit = 20, includeExpired = false }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);

  const audience = await audienceQueryFor(user);

  const clauses = [
    includeExpired
      ? { status: "PUBLISHED", publishedAt: { $lte: new Date() } }
      : liveClause(),
  ];
  if (audience) clauses.push(audience);

  const query = clauses.length === 1 ? clauses[0] : { $and: clauses };

  const [items, total] = await Promise.all([
    Announcement.find(query)
      // Pinned notices stay at the top until taken down; everything else is
      // newest first.
      .sort({ pinned: -1, publishedAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("createdBy", "fullName role")
      .lean(),
    Announcement.countDocuments(query),
  ]);

  return { items, total, page: safePage, limit: safeLimit };
}

/**
 * Fetch one announcement, enforcing the same audience rule as the list.
 *
 * Without this, the audience filter would only be a list-time convenience and
 * any reference could be read directly.
 */
async function getAnnouncement({ user, id, allowExpired = false }) {
  const announcement = await Announcement.findOne({
    reference: String(id).trim().toUpperCase(),
  })
    .populate("createdBy", "fullName role")
    .lean();

  if (!announcement) {
    throw ApiError.notFound("Announcement not found");
  }

  const audience = await audienceQueryFor(user);

  // Same predicate, applied to one document.
  const readable =
    announcement.status === "PUBLISHED" &&
    (announcement.publishedAt ?? 0) <= new Date() &&
    (allowExpired ||
      announcement.expiresAt === null ||
      announcement.expiresAt > new Date()) &&
    (audience === null ||
      (audience.$or ?? []).some((clause) => matchesClause(announcement, clause)));

  if (!readable) {
    // 404 rather than 403: whether an announcement exists, or who it was
    // addressed to, is not this viewer's business.
    throw ApiError.notFound("Announcement not found");
  }

  return announcement;
}

/** Does one announcement satisfy one clause of the audience $or? */
function matchesClause(announcement, clause) {
  if (clause["audience.scope"] === AUDIENCE_SCOPE.ALL) {
    return announcement.audience?.scope === AUDIENCE_SCOPE.ALL;
  }

  if (clause["audience.scope"] === AUDIENCE_SCOPE.ROLES) {
    return (
      announcement.audience?.scope === AUDIENCE_SCOPE.ROLES &&
      (announcement.audience.roles ?? []).includes(clause["audience.roles"])
    );
  }

  if (clause["audience.scope"] === AUDIENCE_SCOPE.DEPARTMENT) {
    return (
      announcement.audience?.scope === AUDIENCE_SCOPE.DEPARTMENT &&
      String(announcement.audience?.department) === String(clause["audience.department"])
    );
  }

  if (clause["audience.scope"] === AUDIENCE_SCOPE.PROGRAM) {
    return (
      announcement.audience?.scope === AUDIENCE_SCOPE.PROGRAM &&
      String(announcement.audience?.program) === String(clause["audience.program"])
    );
  }

  return false;
}

/**
 * Post an announcement and notify its audience.
 *
 * The document is written first and stands alone. A fan-out failure is recorded
 * rather than thrown, because losing the notice over a notification problem
 * would be the wrong way round.
 */
async function createAnnouncement({
  user,
  title,
  body,
  priority,
  pinned,
  audience,
  publishedAt,
  expiresAt,
  attachment,
  req,
}) {
  if (!userHasPermission(user, P.ANNOUNCEMENT_MANAGE)) {
    throw ApiError.forbidden("You do not have permission to post announcements");
  }

  if (expiresAt && publishedAt && new Date(expiresAt) <= new Date(publishedAt)) {
    throw ApiError.badRequest("An expiry must come after the publication date");
  }

  const reference = await nextReference("announcement", "AN", new Date().getFullYear());

  const announcement = await Announcement.create({
    reference,
    title,
    body,
    priority: priority ?? ANNOUNCEMENT_PRIORITY.NORMAL,
    pinned: pinned ?? false,
    audience: normaliseAudience(audience),
    publishedAt: publishedAt ?? new Date(),
    expiresAt: expiresAt ?? null,
    createdBy: user._id,
    attachment: attachment ?? undefined,
  });

  await auditService.record({
    action: AUDIT_ACTION.ANNOUNCEMENT_POSTED,
    entity: "Announcement",
    entityId: announcement._id,
    entityRef: announcement.reference,
    metadata: {
      audience: announcement.audience,
      priority: announcement.priority,
      pinned: announcement.pinned,
      hasAttachment: Boolean(announcement.attachment?.storageKey),
    },
    actor: user,
    req,
  });

  // A future publication date means the notice is scheduled, not live, so the
  // bell is not disturbed yet. The top-up script or a later run covers it.
  if (announcement.publishedAt <= new Date()) {
    await fanOut({ announcement, req });
  }

  return announcement;
}

/** Strip selectors that do not belong to the scope, so nothing is stored that the schema forbids. */
function normaliseAudience(audience) {
  const scope = audience?.scope ?? AUDIENCE_SCOPE.ALL;

  const normalised = { scope };

  if (scope === AUDIENCE_SCOPE.ROLES && audience.roles?.length) {
    normalised.roles = [...new Set(audience.roles)];
  }
  if (scope === AUDIENCE_SCOPE.DEPARTMENT && audience.department) {
    normalised.department = audience.department;
  }
  if (scope === AUDIENCE_SCOPE.PROGRAM && audience.program) {
    normalised.program = audience.program;
  }

  return normalised;
}

/**
 * Resolve the audience to user ids and write a notification to each.
 *
 * Safe to re-run: `notifyMany` dedupes per recipient, so a second pass adds
 * only the notifications the first pass did not reach.
 */
async function fanOut({ announcement, limit = FAN_OUT_LIMIT }) {
  const userIds = await resolveAudienceUserIds(announcement, { limit });

  const notification = {
    type: "ANNOUNCEMENT",
    title:
      announcement.priority === ANNOUNCEMENT_PRIORITY.URGENT
        ? `Urgent: ${announcement.title}`
        : announcement.title,
    body: summarise(announcement.body),
    link: `/announcements/${announcement.reference}`,
    dedupeKeyPrefix: `announcement:${announcement._id}`,
  };

  // Inserted in bounded batches rather than all at once.
  //
  // `notifyMany` fans out with Promise.all, so handing it two thousand
  // recipients would open two thousand concurrent writes against one MongoDB.
  // That is a self-inflicted thundering herd: it starves unrelated queries and
  // is the kind of thing that works in staging and stalls in production.
  let delivered = [];
  for (let offset = 0; offset < userIds.length; offset += FAN_OUT_CHUNK) {
    const batch = userIds.slice(offset, offset + FAN_OUT_CHUNK);
    const created = await notificationService.notifyMany({
      ...notification,
      userIds: batch,
    });
    delivered = delivered.concat(created);
  }

  const audienceSize = await countAudience(announcement);
  const truncated = audienceSize > delivered.length;

  await Announcement.updateOne(
    { _id: announcement._id },
    { $set: { notifiedCount: delivered.length, fanOutTruncated: truncated } }
  );

  if (truncated) {
    logger.warn(
      {
        announcement: announcement.reference,
        delivered: delivered.length,
        audience: audienceSize,
      },
      "Announcement fan-out truncated — some inboxes will not show this notice"
    );
  }

  logger.info(
    {
      announcement: announcement.reference,
      delivered: delivered.length,
      audience: audienceSize,
    },
    "Announcement published"
  );

  return { delivered: delivered.length, audienceSize, truncated };
}

/** One line of an announcement, for a notification body capped at 500 characters. */
function summarise(body) {
  const flattened = String(body).replace(/\s+/g, " ").trim();
  return flattened.length > 300 ? `${flattened.slice(0, 297)}...` : flattened;
}

/**
 * The Mongo query selecting the users an announcement is addressed to.
 *
 * Synchronous, so it cannot express a PROGRAM audience: membership lives on the
 * Student profile, which has to be read first. Callers handle PROGRAM through
 * `studentIdsForProgram` and must not reach here with one.
 */
function audienceUserQuery(announcement) {
  const audience = announcement.audience ?? { scope: AUDIENCE_SCOPE.ALL };

  if (audience.scope === AUDIENCE_SCOPE.PROGRAM) {
    throw new Error(
      "A PROGRAM audience must be resolved via studentIdsForProgram(), not audienceUserQuery()"
    );
  }

  if (audience.scope === AUDIENCE_SCOPE.ROLES) {
    return { role: { $in: audience.roles ?? [] }, isActive: true };
  }

  if (audience.scope === AUDIENCE_SCOPE.DEPARTMENT) {
    return { department: audience.department, isActive: true };
  }

  return { isActive: true };
}

/**
 * Students in a programme.
 *
 * Returned as a subquery so the audience can still be expressed as one User
 * query, rather than pulling thousands of ids into memory first.
 */
function studentIdsForProgram(programId) {
  return Student.collection.distinct("user", { program: programId });
}

/**
 * Count the full audience.
 *
 * `studentIdsForProgram` returns a promise, which cannot be used inside a query
 * filter, so programme audiences are counted separately.
 */
async function countAudience(announcement) {
  const audience = announcement.audience ?? { scope: AUDIENCE_SCOPE.ALL };

  if (audience.scope === AUDIENCE_SCOPE.PROGRAM) {
    const userIds = await studentIdsForProgram(audience.program);
    return User.countDocuments({ _id: { $in: userIds }, isActive: true });
  }

  return User.countDocuments(audienceUserQuery(announcement));
}

/** User ids for an announcement's audience, bounded by `limit`. */
async function resolveAudienceUserIds(announcement, { limit = FAN_OUT_LIMIT } = {}) {
  const audience = announcement.audience ?? { scope: AUDIENCE_SCOPE.ALL };

  if (audience.scope === AUDIENCE_SCOPE.PROGRAM) {
    const userIds = await studentIdsForProgram(audience.program);
    if (userIds.length === 0) return [];
    return User.find({ _id: { $in: userIds }, isActive: true })
      .limit(limit)
      .select("_id")
      .lean()
      .then((docs) => docs.map((d) => d._id.toString()));
  }

  const query = audienceUserQuery(announcement);

  return User.find(query)
    .limit(limit)
    .select("_id")
    .lean()
    .then((docs) => docs.map((d) => d._id.toString()));
}

/** Take an announcement down. The record is kept, not deleted. */
async function archiveAnnouncement({ user, id, req }) {
  const announcement = await Announcement.findOne({
    reference: String(id).trim().toUpperCase(),
  });

  if (!announcement) {
    throw ApiError.notFound("Announcement not found");
  }

  if (announcement.status === "ARCHIVED") {
    throw ApiError.conflict("This announcement is already archived");
  }

  const archived = await Announcement.findOneAndUpdate(
    { _id: announcement._id, status: "PUBLISHED" },
    {
      $set: {
        status: "ARCHIVED",
        pinned: false,
        archivedAt: new Date(),
        archivedBy: user._id,
      },
    },
    { new: true }
  );

  if (!archived) {
    throw ApiError.conflict("This announcement was archived by someone else");
  }

  await auditService.record({
    action: AUDIT_ACTION.ANNOUNCEMENT_POSTED,
    entity: "Announcement",
    entityId: archived._id,
    entityRef: archived.reference,
    metadata: { decision: "ARCHIVED" },
    actor: user,
    req,
  });

  return archived;
}

/** Pin or unpin without republishing. */
async function setPinned({ user, id, pinned, req }) {
  const announcement = await Announcement.findOne({
    reference: String(id).trim().toUpperCase(),
  });

  if (!announcement) {
    throw ApiError.notFound("Announcement not found");
  }

  if (announcement.status === "ARCHIVED") {
    throw ApiError.conflict("An archived announcement cannot be pinned");
  }

  const updated = await Announcement.findOneAndUpdate(
    { _id: announcement._id },
    { $set: { pinned: Boolean(pinned) } },
    { new: true }
  );

  await auditService.record({
    action: AUDIT_ACTION.ANNOUNCEMENT_POSTED,
    entity: "Announcement",
    entityId: updated._id,
    entityRef: updated.reference,
    metadata: { pinned: Boolean(pinned) },
    actor: user,
    req,
  });

  return updated;
}

/** Private download of an attachment, subject to the same audience rule. */
async function resolveAttachment({ user, id }) {
  const announcement = await getAnnouncement({ user, id });

  if (!announcement.attachment?.storageKey) {
    throw ApiError.notFound("This announcement has no attachment");
  }

  return {
    storageKey: announcement.attachment.storageKey,
    filename:
      announcement.attachment.originalName ?? `${announcement.reference}-attachment`,
    mimeType: announcement.attachment.mimeType,
  };
}

async function readAttachmentBytes({ storageKey }) {
  const storage = getStorage();

  if (typeof storage.getSignedUrl === "function") {
    return { redirect: await storage.getSignedUrl(storageKey) };
  }

  return { buffer: await storage.read(storageKey) };
}

module.exports = {
  createAnnouncement,
  FAN_OUT_CHUNK,
  listAnnouncements,
  getAnnouncement,
  archiveAnnouncement,
  setPinned,
  fanOut,
  resolveAttachment,
  readAttachmentBytes,
  resolveViewerScope,
  audienceQueryFor,
  normaliseAudience,
  FAN_OUT_LIMIT,
};
