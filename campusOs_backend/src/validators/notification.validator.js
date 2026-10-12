/**
 * Notification request schemas.
 *
 * Deliberately thin: there is nothing a client may choose here. The recipient
 * is always the session user, so the only inputs are paging and an id whose
 * use is already scoped server-side.
 */

const { z } = require("zod");

/** GET /notifications */
const listNotificationsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    /** The bell's "unread" filter. */
    unreadOnly: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
  })
  .strict();

/** POST /notifications/:id/read */
const notificationParamsSchema = z
  .object({
    id: z.string().regex(/^[a-f\d]{24}$/i, "Must be a valid id"),
  })
  .strict();

module.exports = {
  listNotificationsSchema,
  notificationParamsSchema,
};
