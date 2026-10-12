/**
 * Notification controller.
 *
 * The recipient is taken from the session on every route. No route accepts a
 * user id, so there is no parameter through which one inbox could be read, or
 * marked read, in place of another.
 */

const notificationService = require("../services/notification.service");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");

/** Shape one notification. */
function present(notification) {
  return {
    id: notification.id ?? notification._id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    link: notification.link ?? null,
    readAt: notification.readAt ?? null,
    isRead: Boolean(notification.readAt),
    createdAt: notification.createdAt,
  };
}

/** GET /api/v1/notifications */
const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, unreadOnly } = req.validated.query;

  const result = await notificationService.listForUser({
    userId: req.user._id.toString(),
    page,
    limit,
    unreadOnly,
  });

  return sendPaginated(res, {
    items: result.items.map(present),
    total: result.total,
    page: result.page,
    limit: result.limit,
    message: "Notifications retrieved successfully",
  });
});

/** GET /api/v1/notifications/unread-count */
const unreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.unreadCount(req.user._id.toString());

  return sendSuccess(res, {
    message: "Unread count retrieved successfully",
    data: { unread: count },
  });
});

/**
 * POST /api/v1/notifications/:id/read
 *
 * `updated: false` is a normal answer, not an error: a notification that is
 * already read, or belongs to someone else, is reported as unchanged. Revealing
 * the difference would let a caller probe for the existence of other inboxes.
 */
const markRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markRead({
    notificationId: req.params.id,
    userId: req.user._id.toString(),
  });

  const unread = await notificationService.unreadCount(req.user._id.toString());

  return sendSuccess(res, {
    message: result.updated
      ? "Notification marked read"
      : "Notification was already read",
    data: { updated: result.updated, unread },
  });
});

/** POST /api/v1/notifications/read-all */
const markAllRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllRead({
    userId: req.user._id.toString(),
  });

  return sendSuccess(res, {
    message: `Marked ${result.updated} notification(s) read`,
    data: { updated: result.updated, unread: 0 },
  });
});

module.exports = {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
};
