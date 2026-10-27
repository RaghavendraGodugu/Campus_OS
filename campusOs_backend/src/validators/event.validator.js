const { z } = require("zod");
const mongoose = require("mongoose");

const objectId = z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), {
  message: "That is not a valid id",
});
const idParam = z.object({ id: objectId }).strict();
const isoDateTime = z.string().datetime({ offset: true }).or(z.string().datetime());

const EVENT_KINDS = ["WORKSHOP", "FEST", "SEMINAR", "SPORTS", "CULTURAL", "OTHER"];

const createEventSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(10).max(4000),
    kind: z.enum(EVENT_KINDS),
    venue: z.string().trim().max(160).optional(),
    startsAt: isoDateTime,
    endsAt: isoDateTime.optional(),
    capacity: z.coerce.number().int().min(1).max(5000).optional(),
    department: objectId.optional(),
    contact: z.string().trim().max(160).optional(),
    status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  })
  .strict();

const updateEventSchema = z
  .object({
    title: z.string().trim().min(3).max(160).optional(),
    description: z.string().trim().min(10).max(4000).optional(),
    kind: z.enum(EVENT_KINDS).optional(),
    venue: z.string().trim().max(160).optional(),
    startsAt: isoDateTime.optional(),
    endsAt: isoDateTime.optional(),
    capacity: z.coerce.number().int().min(1).max(5000).optional(),
    department: objectId.optional(),
    contact: z.string().trim().max(160).optional(),
    // Absent means "no status change": a venue correction should not need to
    // re-state where the event lives in its lifecycle.
    status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED"]).optional(),
  })
  .strict();

module.exports = {
  idParam,
  createEventSchema,
  updateEventSchema,
  EVENT_KINDS,
};
