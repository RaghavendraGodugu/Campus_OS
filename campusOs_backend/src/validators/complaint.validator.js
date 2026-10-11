/**
 * Complaint validators.
 *
 * As with requests, no schema accepts `status`, `confidential`, `assignedTo` or
 * any SLA field. Confidentiality is derived from the category by the model, and
 * assignment happens through a transition — so a client cannot file a
 * "sensitive" complaint to bypass ordinary routing, nor downgrade a harassment
 * complaint by sending `confidential: false`.
 */

const { z } = require("zod");
const mongoose = require("mongoose");

const {
  COMPLAINT_STATUS,
  COMPLAINT_STATUS_VALUES,
  COMPLAINT_PRIORITY,
  COMPLAINT_PRIORITY_VALUES,
} = require("../config/constants");
const { ALL_CATEGORIES } = require("../models/Complaint");

const objectId = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "Must be a valid identifier",
});

const complaintIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (value) =>
      mongoose.Types.ObjectId.isValid(value) || /^[A-Z]+-\d{4}-\d{4,}$/.test(value),
    { message: "Must be a complaint id or reference" }
  );

/** POST /complaints */
const createComplaintSchema = z
  .object({
    category: z.enum(ALL_CATEGORIES, {
      message: "Must be a valid complaint category",
    }),
    subCategory: z.string().trim().max(100).optional(),
    subject: z
      .string()
      .trim()
      .min(5, "Subject must be at least 5 characters")
      .max(200, "Subject cannot exceed 200 characters"),
    description: z
      .string()
      .trim()
      .min(20, "Please describe what happened in at least 20 characters")
      .max(5000, "Description cannot exceed 5000 characters"),
    /**
     * Priority is an institutional judgement, not a student preference: letting
     * a student mark their own complaint CRITICAL would let every case jump the
     * queue. The default applies instead.
     */
    priority: z.enum(COMPLAINT_PRIORITY_VALUES).optional(),
    department: objectId.optional(),
  })
  .strict();

/** GET /complaints */
const listComplaintsSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(COMPLAINT_STATUS_VALUES).optional(),
    category: z.enum(ALL_CATEGORIES).optional(),
    priority: z.enum(COMPLAINT_PRIORITY_VALUES).optional(),
    department: objectId.optional(),
    assignedToMe: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    confidential: z.enum(["true", "false"]).optional(),
    overdue: z.enum(["true", "false"]).optional(),
  })
  .strict();

/** GET /complaints/:id */
const getComplaintSchema = z.object({ id: complaintIdentifier }).strict();

/** POST /complaints/:id/transition */
const transitionSchema = z
  .object({
    to: z.enum(COMPLAINT_STATUS_VALUES, { message: "Must be a valid status" }),
    expectedFrom: z.enum(COMPLAINT_STATUS_VALUES, {
      message: "expectedFrom must be a valid status",
    }),
    /** Student-visible update. Required by some edges. */
    note: z.string().trim().max(2000).optional(),
    reason: z.string().trim().max(1000).optional(),
    resolution: z.string().trim().max(3000).optional(),
    assignTo: objectId.optional(),
  })
  .strict();

/** POST /complaints/:id/updates */
const updateSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "Update cannot be empty")
      .max(2000, "Update cannot exceed 2000 characters"),
  })
  .strict();

/** POST /complaints/:id/internal-notes */
const internalNoteSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "Note cannot be empty")
      .max(2000, "Note cannot exceed 2000 characters"),
  })
  .strict();

/** POST /complaints/:id/feedback */
const feedbackSchema = z
  .object({
    rating: z.coerce.number().int().min(1).max(5),
    satisfied: z.boolean(),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();

module.exports = {
  createComplaintSchema,
  listComplaintsSchema,
  getComplaintSchema,
  transitionSchema,
  updateSchema,
  internalNoteSchema,
  feedbackSchema,
  complaintIdentifier,
  objectId,
  COMPLAINT_STATUS,
  COMPLAINT_PRIORITY,
};
