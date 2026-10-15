/**
 * Report and audit query schemas.
 *
 * The date bounds are not cosmetic. Report aggregations are unbounded scans by
 * nature, so a caller able to name any `from` could turn one permission into a
 * full-collection scan of a live database. Every list query therefore takes a
 * bounded period, either supplied or defaulted by the service.
 */

const { z } = require("zod");

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Must be a valid date")
  .transform((value) => new Date(value));

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Must be a valid id");

/** Shared period filters for every report. */
const periodFields = {
  from: isoDate.optional(),
  to: isoDate.optional(),
};

/** GET /reports/overview */
const overviewSchema = z.object(periodFields).strict();

/** GET /reports/requests, /reports/students */
const scopedReportSchema = z
  .object({
    ...periodFields,
    /**
     * Honoured only by an institution-scoped viewer. A department-scoped
     * viewer supplying another department's id is ignored, not obeyed — the
     * service pins the filter to their own department.
     */
    department: objectId.optional(),
  })
  .strict();

/** GET /reports/complaints, /reports/finance */
const institutionReportSchema = z.object(periodFields).strict();

/**
 * GET /reports/:kind/export
 *
 * `format` is validated rather than defaulted blindly, because the export path
 * decides the Content-Type: an unrecognised value would otherwise fall through
 * to the CSV branch and hand someone a PDF named `.csv`.
 */
const exportQuerySchema = z
  .object({
    ...periodFields,
    department: objectId.optional(),
    format: z.enum(["csv", "pdf"]).default("csv"),
  })
  .strict();

/** GET /audit */
const auditQuerySchema = z
  .object({
    action: z.string().trim().min(1).max(60).optional(),
    entity: z.string().trim().toUpperCase().min(1).max(40).optional(),
    entityId: objectId.optional(),
    entityRef: z.string().trim().toUpperCase().max(60).optional(),
    actorId: objectId.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/** GET /audit/denied */
const deniedQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/** GET /audit/trail */
const trailSchema = z
  .object({
    entityId: objectId.optional(),
    entityRef: z.string().trim().toUpperCase().max(60).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict()
  .refine((value) => value.entityId || value.entityRef, {
    message: "An audit trail needs a resource id or reference",
  });

module.exports = {
  overviewSchema,
  scopedReportSchema,
  institutionReportSchema,
  exportQuerySchema,
  auditQuerySchema,
  deniedQuerySchema,
  trailSchema,
};
