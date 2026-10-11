/**
 * Notification service.
 *
 * ## Delivery must never break the workflow
 *
 * A notification is a side effect of a state change, never a precondition for
 * it. If the notifications collection were unavailable, an approval could still
 * proceed — so every write here is wrapped and failures are logged, never
 * rethrown.
 *
 * ## Idempotency
 *
 * Notifications are produced by things that can be retried (a webhook, a job,
 * a re-submitted transition). Each accepts a `dedupeKey`, backed by a unique
 * compound index, so a retry absorbs the duplicate instead of showing the user
 * the same message twice.
 *
 * ## Confidentiality
 *
 * `body` is composed here from a fixed template. Resource content is never
 * copied in, which is what prevents a confidential complaint's text from
 * reaching an inbox.
 */

const Notification = require("../models/Notification");
const { NOTIFICATION_TYPE } = require("../config/constants");
const { logger } = require("../config/logger");

/**
 * Deliver one notification.
 *
 * @param {object} params
 * @param {string} params.userId      Recipient.
 * @param {string} params.type        NOTIFICATION_TYPE value.
 * @param {string} params.title
 * @param {string} params.body        Template-composed text, never resource content.
 * @param {string} [params.link]      In-app route.
 * @param {string} [params.dedupeKey] Idempotency key.
 * @returns {Promise<object|null>} The notification, or null on failure/duplicate.
 */
async function notify({ userId, type, title, body, link, dedupeKey }) {
  if (!userId) {
    // A missing recipient is a caller bug, but never a reason to fail the
    // action that triggered it.
    logger.warn({ type, title }, "Notification skipped: no recipient");
    return null;
  }

  try {
    const payload = { user: userId, type, title, body };
    if (link) payload.link = link;
    if (dedupeKey) payload.dedupeKey = dedupeKey;

    return await Notification.create(payload);
  } catch (error) {
    // Duplicate key: the notification already exists, which is the desired
    // outcome of a retry. Not an error.
    if (error?.code === 11000) {
      logger.debug({ userId, dedupeKey }, "Duplicate notification suppressed");
      return null;
    }

    logger.error({ err: error, userId, type }, "Failed to deliver notification");
    return null;
  }
}

/**
 * Deliver the same notification to several recipients.
 *
 * @param {object} params
 * @param {string[]} params.userIds
 * @param {string} params.dedupeKeyPrefix Prepended to each user's key, so a
 *   group send still dedupes per recipient.
 */
async function notifyMany({ userIds, type, title, body, link, dedupeKeyPrefix }) {
  const recipients = [...new Set((userIds ?? []).filter(Boolean))];
  if (recipients.length === 0) return [];

  const results = await Promise.all(
    recipients.map((userId) =>
      notify({
        userId,
        type,
        title,
        body,
        link,
        dedupeKey: dedupeKeyPrefix ? `${dedupeKeyPrefix}:${userId}` : undefined,
      })
    )
  );

  return results.filter(Boolean);
}

/**
 * Unread count for the notification bell.
 *
 * Counted with an indexed `countDocuments` rather than by fetching documents.
 */
async function unreadCount(userId) {
  return Notification.countDocuments({ user: userId, readAt: null });
}

/**
 * List a user's notifications, newest first.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {number} params.page
 * @param {number} params.limit
 * @param {boolean} [params.unreadOnly]
 */
async function listForUser({ userId, page = 1, limit = 20, unreadOnly = false }) {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);

  const filter = { user: userId };
  if (unreadOnly) filter.readAt = null;

  const [items, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    Notification.countDocuments(filter),
  ]);

  return { items, total, page: safePage, limit: safeLimit };
}

/**
 * Mark one notification read.
 *
 * Scoped by both id and recipient, so a user cannot mark (or probe) another
 * user's notification by guessing its id.
 */
async function markRead({ notificationId, userId }) {
  const result = await Notification.updateOne(
    { _id: notificationId, user: userId, readAt: null },
    { $set: { readAt: new Date() } }
  );

  return { updated: result.modifiedCount > 0 };
}

/** Mark every unread notification read for a user. */
async function markAllRead({ userId }) {
  const result = await Notification.updateMany(
    { user: userId, readAt: null },
    { $set: { readAt: new Date() } }
  );

  return { updated: result.modifiedCount };
}

module.exports = {
  notify,
  notifyMany,
  unreadCount,
  listForUser,
  markRead,
  markAllRead,
  NOTIFICATION_TYPE,
};
