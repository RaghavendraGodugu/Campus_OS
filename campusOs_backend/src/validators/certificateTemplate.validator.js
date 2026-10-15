const mongoose = require("mongoose");
const { z } = require("zod");

const { CERTIFICATE_TYPES } = require("../config/constants");

const objectId = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "That is not a valid id",
});

/**
 * Template text.
 *
 * Length-capped, because this is rendered into a PDF page. A template longer
 * than the page would produce a document whose second page is a wall of text,
 * and no error.
 */
const templateText = (max) =>
  z
    .string()
    .trim()
    .max(max, `That text is too long for a certificate (max ${max} characters)`);

/**
 * {{token}} shape.
 *
 * Validated so a template cannot contain a lone brace or a stray `{{` that
 * renders as literal debris on an official document. The *allowed* token list
 * is enforced at render time rather than here, so an unknown token shows up as
 * literal text in a preview — visible to whoever is editing — instead of being
 * rejected on save with a message they cannot act on.
 */
const noMalformedTokens = (value, ctx) => {
  const opens = (value.match(/\{\{/g) ?? []).length;
  const closes = (value.match(/\}\}/g) ?? []).length;
  if (opens !== closes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "This has an unclosed {{placeholder}}",
    });
  }
};

const shape = {
  type: z.enum(CERTIFICATE_TYPES),
  name: z.string().trim().min(3, "Give the template a name").max(120),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  heading: templateText(200).nullish(),
  body: templateText(4000).nullish(),
  footer: templateText(1000).nullish(),
};

const createTemplateSchema = z
  .object(shape)
  .strict()
  .superRefine((value, ctx) => {
    for (const key of ["heading", "body", "footer"]) {
      if (value[key]) noMalformedTokens(value[key], ctx);
    }
  });

const updateTemplateSchema = z
  .object({
    name: shape.name.optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
    heading: shape.heading,
    body: shape.body,
    footer: shape.footer,
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of ["heading", "body", "footer"]) {
      if (value[key]) noMalformedTokens(value[key], ctx);
    }
  });

const templateIdentifier = z.object({ id: objectId }).strict();

/** GET /certificate-templates?type=... */
const listTemplatesSchema = z
  .object({ type: z.enum(CERTIFICATE_TYPES).optional() })
  .strict();

/** POST /certificates/bulk-issue */
const bulkIssueSchema = z
  .object({
    certificateIds: z.array(objectId).min(1, "Choose at least one certificate").max(200),
  })
  .strict();

/** POST /certificate-templates/preview */
const previewSchema = z
  .object({
    type: z.enum(CERTIFICATE_TYPES),
    templateId: objectId.nullish(),
  })
  .strict();

module.exports = {
  createTemplateSchema,
  updateTemplateSchema,
  templateIdentifier,
  listTemplatesSchema,
  bulkIssueSchema,
  previewSchema,
};
