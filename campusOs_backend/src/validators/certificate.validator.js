/**
 * Certificate validators.
 *
 * No schema accepts `status`, `verificationCode`, `issuedAt`, `issuedBy` or
 * `document`. Those are written only by the service, and a client that sends
 * them receives a 400 rather than having them quietly dropped — an ignored
 * `verificationCode` would be worse than a rejection, because it would look
 * like the request succeeded.
 */

const { z } = require("zod");
const mongoose = require("mongoose");

const { CERTIFICATE_STATUS_VALUES } = require("../config/constants");
const { CERTIFICATE_TYPES } = require("../models/Certificate");

const objectId = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "Must be a valid identifier",
});

const certificateIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (value) =>
      mongoose.Types.ObjectId.isValid(value) || /^[A-Z]+-\d{4}-\d{4,}$/.test(value),
    { message: "Must be a certificate id or reference" }
  );

/** POST /certificates */
const applySchema = z
  .object({
    type: z.enum(CERTIFICATE_TYPES, { message: "Must be a valid certificate type" }),
    purpose: z
      .string()
      .trim()
      .max(500, "Purpose cannot exceed 500 characters")
      .optional(),
    copies: z.coerce.number().int().min(1).max(10).default(1),
    department: objectId.optional(),
  })
  .strict();

/** GET /certificates */
const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(CERTIFICATE_STATUS_VALUES).optional(),
    type: z.enum(CERTIFICATE_TYPES).optional(),
    department: objectId.optional(),
  })
  .strict();

/** GET /certificates/:id */
const getSchema = z.object({ id: certificateIdentifier }).strict();

/** POST /certificates/:id/transition */
const transitionSchema = z
  .object({
    to: z.enum(CERTIFICATE_STATUS_VALUES),
    expectedFrom: z.enum(CERTIFICATE_STATUS_VALUES),
    reason: z.string().trim().max(1000).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

/** POST /certificates/:id/issue — no body; state comes from the record. */
const issueSchema = z.object({}).strict().partial();

/** POST /certificates/:id/revoke */
const revokeSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(10, "Revoking requires a stated reason of at least 10 characters")
      .max(1000),
  })
  .strict();

/** GET /certificates/verify?code=... */
const verifySchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(6, "Verification code is too short")
      .max(24, "Verification code is too long")
      .regex(/^[A-Z0-9-]+$/, "Verification code contains invalid characters"),
  })
  .strict();

module.exports = {
  applySchema,
  listSchema,
  getSchema,
  transitionSchema,
  issueSchema,
  revokeSchema,
  verifySchema,
  certificateIdentifier,
  objectId,
};
