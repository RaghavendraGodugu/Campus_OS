const { z } = require("zod");

const { ACADEMIC_TERM_KINDS } = require("../config/constants");
const mongoose = require("mongoose");

const objectId = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "That is not a valid id",
});

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"))
  .transform((value) => new Date(value));

/**
 * Academic terms.
 *
 * The end-after-start rule is the only real invariant here, and it is enforced
 * in the schema as well as in the service — so a caller that reaches the
 * validator alone still cannot construct a term that ends before it starts.
 */

const termShape = {
  name: z.string().trim().min(3, "Give the term a name of at least 3 characters").max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "Give the term a code of at least 2 characters")
    .max(24)
    .regex(/^[A-Z0-9-]+$/, "A code may contain only letters, numbers and hyphens"),
  kind: z.enum(Object.values(ACADEMIC_TERM_KINDS)).default("SEMESTER"),
  academicYear: z
    .string()
    .trim()
    .regex(/^\d{4}(-\d{2,4})?$/, "An academic year looks like 2026 or 2026-27"),
  startsOn: isoDate,
  endsOn: isoDate,
  notes: z.string().trim().max(500).optional(),
};

const createAcademicTermSchema = z
  .object(termShape)
  .strict()
  .superRefine((value, ctx) => {
    if (new Date(value.endsOn) <= new Date(value.startsOn)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsOn"],
        message: "The end date must be after the start date",
      });
    }
  });

const updateAcademicTermSchema = z
  .object({
    name: termShape.name.optional(),
    kind: termShape.kind.optional(),
    academicYear: termShape.academicYear.optional(),
    startsOn: isoDate.optional(),
    endsOn: isoDate.optional(),
    notes: z.string().trim().max(500).nullish(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Supply at least one field to change",
  });

const academicTermIdSchema = z.object({ id: objectId }).strict();

const prepareRolloverSchema = z
  .object({
    currentYear: z
      .string()
      .trim()
      .regex(/^\d{4}(-\d{2,4})?$/, "An academic year looks like 2026 or 2026-27"),
    nextYearStart: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"))
      .transform((value) => new Date(value)),
  })
  .strict();

module.exports = {
  createAcademicTermSchema,
  updateAcademicTermSchema,
  academicTermIdSchema,
  prepareRolloverSchema,
};
