const mongoose = require("mongoose");
const { z } = require("zod");

const objectId = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "That is not a valid id",
});

/**
 * Instalments and penalties.
 *
 * Bounds are deliberate. `capBps` above 10000 would mean a penalty larger than
 * the debt itself, and `periodDays` of zero would divide by zero when counting
 * elapsed periods — both are refused at the edge rather than defended against
 * inside the calculation.
 */
const policyShape = {
  rateBps: z.number().int().min(0).max(10000),
  periodDays: z.number().int().min(1).max(365),
  graceDays: z.number().int().min(0).max(90),
  capBps: z.number().int().min(0).max(10000),
};

/** POST /invoices/:id/schedule */
const scheduleSchema = z
  .object({
    instalments: z.number().int().min(1, "At least one instalment").max(24),
    firstDueAt: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    periodDays: z.number().int().min(1).max(365).default(30),
    policy: z.object(policyShape).partial().optional(),
  })
  .strict();

/** PATCH /invoices/:id/penalty-policy */
const penaltyPolicySchema = z.object(policyShape).partial().strict();

/** POST /invoices/penalty-sweep */
const penaltySweepSchema = z
  .object({
    /** Absent means "every overdue invoice", which is what a nightly job wants. */
    invoiceIds: z.array(objectId).max(500).optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

module.exports = { scheduleSchema, penaltyPolicySchema, penaltySweepSchema };
