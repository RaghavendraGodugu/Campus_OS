/**
 * Announcement controller.
 *
 * HTTP layer only. Who may read an announcement is decided in the service, from
 * the viewer's own attributes, and never from anything in the request.
 */

const announcementService = require("../services/announcement.service");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated, sendPaginated } = require("../utils/response");

/** Shape one announcement for a client. */
function present(announcement) {
  return {
    id: announcement.id ?? announcement._id,
    reference: announcement.reference,
    title: announcement.title,
    body: announcement.body,
    priority: announcement.priority,
    pinned: announcement.pinned,
    audience: announcement.audience,
    status: announcement.status,
    publishedAt: announcement.publishedAt,
    expiresAt: announcement.expiresAt,
    author: announcement.createdBy
      ? {
          id: announcement.createdBy.id ?? announcement.createdBy._id,
          fullName: announcement.createdBy.fullName,
        }
      : null,
    hasAttachment: Boolean(announcement.attachment?.storageKey),
    notifiedCount: announcement.notifiedCount,
    fanOutTruncated: announcement.fanOutTruncated,
    createdAt: announcement.createdAt,
  };
}

/** POST /api/v1/announcements */
const createAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await announcementService.createAnnouncement({
    user: req.user,
    title: req.validated.body.title,
    body: req.validated.body.body,
    priority: req.validated.body.priority,
    pinned: req.validated.body.pinned,
    audience: req.validated.body.audience,
    publishedAt: req.validated.body.publishedAt,
    expiresAt: req.validated.body.expiresAt ?? null,
    req,
  });

  const fresh = await announcementService.getAnnouncement({
    user: req.user,
    id: announcement.reference,
    allowExpired: true,
  });

  return sendCreated(res, {
    message: announcement.fanOutTruncated
      ? `Announcement ${announcement.reference} posted. ${
          announcement.notifiedCount
        } inboxes were notified; the audience is larger, so some inboxes will not show it.`
      : `Announcement ${announcement.reference} posted and ${announcement.notifiedCount} recipient(s) notified`,
    data: { announcement: present(fresh) },
  });
});

/** GET /api/v1/announcements — only what this viewer may read. */
const listAnnouncements = asyncHandler(async (req, res) => {
  const { page, limit, includeExpired } = req.validated.query;

  const result = await announcementService.listAnnouncements({
    user: req.user,
    page,
    limit,
    includeExpired,
  });

  return sendPaginated(res, {
    items: result.items.map(present),
    total: result.total,
    page: result.page,
    limit: result.limit,
    message: "Announcements retrieved successfully",
  });
});

/** GET /api/v1/announcements/:id — 404 when outside the audience. */
const getAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await announcementService.getAnnouncement({
    user: req.user,
    id: req.params.id,
  });

  return sendSuccess(res, {
    message: "Announcement retrieved successfully",
    data: { announcement: present(announcement) },
  });
});

/** POST /api/v1/announcements/:id/archive */
const archiveAnnouncement = asyncHandler(async (req, res) => {
  const archived = await announcementService.archiveAnnouncement({
    user: req.user,
    id: req.params.id,
    req,
  });

  return sendSuccess(res, {
    message: `Announcement ${archived.reference} archived. It is no longer listed.`,
    data: { announcement: present(archived) },
  });
});

/** POST /api/v1/announcements/:id/pin */
const pinAnnouncement = asyncHandler(async (req, res) => {
  const updated = await announcementService.setPinned({
    user: req.user,
    id: req.params.id,
    pinned: req.validated.body.pinned,
    req,
  });

  return sendSuccess(res, {
    message: updated.pinned
      ? `Announcement ${updated.reference} pinned`
      : `Announcement ${updated.reference} unpinned`,
    data: { announcement: present(updated) },
  });
});

/** GET /api/v1/announcements/:id/attachment — private download. */
const downloadAttachment = asyncHandler(async (req, res) => {
  const resolved = await announcementService.resolveAttachment({
    user: req.user,
    id: req.params.id,
  });

  const { redirect, buffer } = await announcementService.readAttachmentBytes({
    storageKey: resolved.storageKey,
  });

  if (redirect) {
    return res.redirect(302, redirect);
  }

  res.setHeader("Content-Type", resolved.mimeType ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${resolved.filename}"`);
  // An announcement attachment is private: never cached by a shared proxy.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  return res.send(buffer);
});

module.exports = {
  createAnnouncement,
  listAnnouncements,
  getAnnouncement,
  archiveAnnouncement,
  pinAnnouncement,
  downloadAttachment,
};
