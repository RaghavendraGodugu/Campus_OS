/**
 * Request validators.
 *
 * ## Why `status` is not accepted anywhere
 *
 * Every schema is `.strict()`, and none of them declare `status`. A client
 * sending `{"status": "COMPLETED"}` therefore receives a 400 naming the
 * unexpected key, rather than having it silently dropped. This is the first
 * line of defence behind the workflow table: a request body can never carry a
 * status, so only `workflow.service.js` can write one.
 */

const { z } = require("zod");
const mongoose = require("mongoose");

const { REQUEST_STATUS, REQUEST_STATUS_VALUES } = require("../config/constants");

/** A Mongo ObjectId supplied as a path or query parameter. */
const objectId = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "Must be a valid identifier",
});

/**
 * Request identifier: either a 24-character ObjectId or a reference like
 * `REQ-2026-000042`. Accepting the reference keeps URLs human-readable, and
 * the service resolves either form.
 */
const requestIdentifier = z
  .string()
  .trim()
  .min(1, "A request identifier is required")
  .max(64, "Request identifier is too long")
  .refine(
    (value) =>
      mongoose.Types.ObjectId.isValid(value) || /^[A-Z]+-\d{4}-\d{4,}$/.test(value),
    { message: "Must be a request id or reference" }
  );

/**
 * Submitted field values.
 *
 * Free-form by design: the shape is defined at runtime by the RequestType, and
 * `request.service.validateAgainstType` enforces it against that definition.
 * Unknown keys are rejected there, once the type is known.
 */
const requestData = z.record(z.string(), z.unknown());

/** POST /requests */
const createRequestSchema = z
  .object({
    requestType: objectId,
    title: z.string().trim().max(200, "Title cannot exceed 200 characters").optional(),
    description: z
      .string()
      .trim()
      .max(2000, "Description cannot exceed 2000 characters")
      .optional(),
    data: requestData.default({}),
  })
  .strict();

/** GET /requests */
const listRequestsSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(REQUEST_STATUS_VALUES).optional(),
    requestType: objectId.optional(),
    department: objectId.optional(),
    assignedToMe: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    search: z.string().trim().max(100, "Search term is too long").optional(),
    sort: z.enum(["newest", "oldest", "due", "status"]).default("newest"),
  })
  .strict();

/** GET /requests/:id */
const getRequestSchema = z.object({ id: requestIdentifier }).strict();

/**
 * POST /requests/:id/transition
 *
 * `expectedFrom` is mandatory. It makes the caller state which status they
 * believe the request is in, and the write filters on exactly that value — so
 * two officers acting on a stale view cannot both succeed.
 */
const transitionSchema = z
  .object({
    to: z.enum(REQUEST_STATUS_VALUES, {
      message: "Must be a valid status",
    }),
    expectedFrom: z.enum(REQUEST_STATUS_VALUES, {
      message: "expectedFrom must be a valid status",
    }),
    reason: z
      .string()
      .trim()
      .max(1000, "Reason cannot exceed 1000 characters")
      .optional(),
    resolution: z
      .string()
      .trim()
      .max(2000, "Resolution cannot exceed 2000 characters")
      .optional(),
    assignTo: objectId.optional(),
  })
  .strict();

/** POST /requests/:id/comments */
const commentSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "Comment cannot be empty")
      .max(2000, "Comment cannot exceed 2000 characters"),
  })
  .strict();

/** POST /requests/:id/internal-notes */
const internalNoteSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "Note cannot be empty")
      .max(2000, "Note cannot exceed 2000 characters"),
  })
  .strict();

/** POST /requests/:id/assign */
const assignSchema = z
  .object({
    assignTo: objectId,
    expectedFrom: z.enum(REQUEST_STATUS_VALUES),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.expectedFrom === REQUEST_STATUS.SUBMITTED ||
      d.expectedFrom === REQUEST_STATUS.ESCALATED,
    {
      message: "Only submitted or escalated requests can be assigned",
      path: ["expectedFrom"],
    }
  );

/** POST /requests/:id/feedback */
const feedbackSchema = z
  .object({
    rating: z.coerce.number().int().min(1, "Rating must be between 1 and 5").max(5),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();

/** POST /request-types */
const createRequestTypeSchema = z
  .object({
    name: z.string().trim().min(3).max(150),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]+$/, "Code must contain only letters, numbers and underscores")
      .max(30),
    description: z.string().trim().max(1000).optional(),
    department: objectId,
    fields: z
      .array(
        z
          .object({
            name: z
              .string()
              .trim()
              .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Invalid field name"),
            label: z.string().trim().min(1).max(120),
            type: z.enum(["TEXT", "TEXTAREA", "NUMBER", "DATE", "SELECT", "BOOLEAN"]),
            required: z.boolean().default(false),
            options: z.array(z.string().trim().min(1)).optional(),
            min: z.number().optional(),
            max: z.number().optional(),
            maxLength: z.number().int().positive().optional(),
            helpText: z.string().trim().max(300).optional(),
          })
          .strict()
      )
      .max(50, "A request type cannot define more than 50 fields")
      .default([]),
    requiredDocuments: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            description: z.string().trim().max(300).optional(),
            required: z.boolean().default(true),
          })
          .strict()
      )
      .max(20)
      .default([]),
    slaHours: z.number().int().min(1).max(2160).default(72),
    requiresPayment: z.boolean().default(false),
    requiresFeeClearance: z.boolean().default(false),
    isDemo: z.boolean().default(false),
  })
  .strict();

/** GET /request-types */
const listRequestTypesSchema = z
  .object({
    department: objectId.optional(),
    includeInactive: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

module.exports = {
  createRequestSchema,
  listRequestsSchema,
  getRequestSchema,
  transitionSchema,
  commentSchema,
  internalNoteSchema,
  assignSchema,
  feedbackSchema,
  createRequestTypeSchema,
  listRequestTypesSchema,
  requestIdentifier,
  objectId,
  requestData,
  REQUEST_STATUS,
};
