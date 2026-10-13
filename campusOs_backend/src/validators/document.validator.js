/**
 * Document route schemas.
 *
 * The parent may be addressed by ObjectId or by its printed reference, matching
 * every other route in the system.
 */

const { z } = require("zod");

const mongoose = require("mongoose");

const objectId = z
  .string()
  .refine((value) => mongoose.Types.ObjectId.isValid(value), "Must be a valid id");

/** REQ-2026-000001, DMCMP-2026-000001, or an ObjectId. */
const parentIdentifier = z.string().trim().min(1).max(64);

const uploadParamsSchema = z.object({ id: parentIdentifier }).strict();
const documentParamsSchema = z.object({ id: objectId }).strict();

module.exports = {
  uploadParamsSchema,
  documentParamsSchema,
  parentIdentifier,
  objectId,
};
