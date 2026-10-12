/**
 * Announcement request schemas.
 *
 * The audience is the security-relevant part of this file. `scope` decides how
 * the rest of the object is interpreted, so each scope's requirements are
 * enforced here rather than being discovered at read time — a DEPARTMENT
 * announcement with no department would otherwise address everyone.
 */

const { z } = require("zod");

const {
  ROLES,
  AUDIENCE_SCOPE_VALUES,
  ANNOUNCEMENT_PRIORITY_VALUES,
} = require("../config/constants");

const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Must be a valid id")
  .transform((value) => value);

/** A date that must parse, accepted as an ISO string. */
const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Must be a valid date")
  .transform((value) => new Date(value));

const announcementReference = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^AN-\d{4}-\d{6}$/, "Must be a reference like AN-2026-000001");

/**
 * The audience.
 *
 * `superRefine` is used rather than `discriminatedUnion` because the selector
 * is nested inside one object and the relationships between its fields matter
 * more than its shape.
 */
const audienceSchema = z
  .object({
    scope: z.enum(AUDIENCE_SCOPE_VALUES).default("ALL"),
    roles: z
      .array(z.enum(Object.values(ROLES)))
      .min(1, "Name at least one role")
      .max(12)
      .optional(),
    department: objectId.optional(),
    program: objectId.optional(),
  })
  .strict()
  .superRefine((audience, ctx) => {
    const { scope, roles, department, program } = audience;

    if (scope === "ROLES" && (!roles || roles.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roles"],
        message: "An audience of ROLES must name at least one role",
      });
    }

    if (scope === "DEPARTMENT" && !department) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["department"],
        message: "An audience of DEPARTMENT must name a department",
      });
    }

    if (scope === "PROGRAM" && !program) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["program"],
        message: "An audience of PROGRAM must name a programme",
      });
    }

    // A selector belonging to a different scope is a mistake worth surfacing:
    // it reads as though it narrows the audience, and does nothing.
    if (scope === "ALL" && (roles || department || program)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope"],
        message: "An announcement to everyone cannot also name an audience",
      });
    }
  });

/** POST /announcements */
const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(3, "Title must be at least 3 characters").max(160),
    body: z.string().trim().min(10, "Body must be at least 10 characters").max(5000),
    priority: z.enum(ANNOUNCEMENT_PRIORITY_VALUES).default("NORMAL"),
    pinned: z.boolean().default(false),
    audience: audienceSchema.default({ scope: "ALL" }),
    publishedAt: isoDate.optional(),
    expiresAt: isoDate.nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.expiresAt && value.publishedAt && value.expiresAt <= value.publishedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Expiry must come after the publication date",
      });
    }
  });

/** POST /announcements/:id/archive — no body. */
const archiveAnnouncementSchema = z.object({}).strict();

/** POST /announcements/:id/pin */
const pinAnnouncementSchema = z.object({ pinned: z.boolean() }).strict();

/** GET /announcements */
const listAnnouncementsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    /** Officers only — shows archived notices, for the management view. */
    includeExpired: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
  })
  .strict();

/** GET /announcements/:id */
const announcementIdentifier = z.object({ id: announcementReference });

module.exports = {
  createAnnouncementSchema,
  archiveAnnouncementSchema,
  pinAnnouncementSchema,
  listAnnouncementsSchema,
  announcementIdentifier,
  audienceSchema,
  announcementReference,
};
