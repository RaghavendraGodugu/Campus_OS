const { z } = require("zod");

const PALETTES = [
  "midnight-vanilla",
  "oxblood-parchment",
  "deep-teal-chalk",
  "graphite-acid",
  "ink-blue-apricot",
  "plum-powder",
];

const brandingShape = {
  institutionName: z.string().trim().min(1).max(120).optional(),
  shortName: z.string().trim().min(1).max(24).optional(),
  logoUrl: z.string().url().nullable().optional(),
  faviconUrl: z.string().url().nullable().optional(),
  palette: z.enum(PALETTES).optional(),
  customVariables: z.record(z.string()).optional(),
  isActive: z.boolean().optional(),
};

const updateBrandingSchema = z
  .object(brandingShape)
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Supply at least one field to change",
  });

const toggleBrandingSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

module.exports = {
  updateBrandingSchema,
  toggleBrandingSchema,
};
