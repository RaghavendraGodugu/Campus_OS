const { z } = require("zod");
const mongoose = require("mongoose");

const { ASSESSMENT_KIND_VALUES } = require("../config/constants");

const objectId = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "That is not a valid id",
});

const idParam = z.object({ id: objectId }).strict();
const subjectParam = z.object({ subjectId: objectId }).strict();

const termQuery = z.object({ term: objectId.optional() }).strict();
const subjectQuery = z.object({ subject: objectId, term: objectId.optional() }).strict();

/**
 * Assessment components.
 *
 * `maxMarks` is required at creation: a component without a denominator cannot
 * contribute to a percentage, and adding it later would silently change every
 * student's result. Marks are validated against it in the service.
 */
const createAssessmentSchema = z
  .object({
    term: objectId,
    subject: objectId,
    name: z.string().trim().min(2, "Give the component a name").max(80),
    kind: z.enum(ASSESSMENT_KIND_VALUES).optional(),
    maxMarks: z.coerce
      .number()
      .int("Maximum marks must be a whole number")
      .min(1, "Maximum marks must be at least 1")
      .max(500, "Maximum marks look wrong"),
    sequence: z.coerce.number().int().min(0).max(100).optional(),
  })
  .strict();

const saveMarksSchema = z
  .object({
    assessment: objectId,
    marks: z
      .array(
        z
          .object({
            student: objectId,
            marksObtained: z.coerce
              .number()
              .min(0, "Marks cannot be negative")
              .max(500, "Marks look wrong"),
          })
          .strict()
      )
      .min(1, "Enter at least one mark")
      .max(500, "That is more students than one component can hold"),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set(value.marks.map((mark) => mark.student));
    if (ids.size !== value.marks.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["marks"],
        message: "A student may appear only once",
      });
    }
  });

const publishSchema = z
  .object({
    term: objectId,
    program: objectId,
  })
  .strict();

module.exports = {
  idParam,
  subjectParam,
  termQuery,
  subjectQuery,
  createAssessmentSchema,
  saveMarksSchema,
  publishSchema,
};
