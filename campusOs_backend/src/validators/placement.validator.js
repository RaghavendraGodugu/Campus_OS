const { z } = require("zod");
const mongoose = require("mongoose");

const objectId = z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), {
  message: "That is not a valid id",
});
const idParam = z.object({ id: objectId }).strict();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

const createCompanySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    sector: z.string().trim().max(80).optional(),
    website: z.string().trim().max(200).optional(),
  })
  .strict();

const createDriveSchema = z
  .object({
    company: objectId,
    title: z.string().trim().min(2).max(160),
    role: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).optional(),
    location: z.string().trim().max(120).optional(),
    ctcPaise: z.coerce.number().int().min(0).optional(),
    eligiblePrograms: z.array(objectId).max(50).optional(),
    eligibleSemesters: z.array(z.coerce.number().int().min(1).max(12)).max(12).optional(),
    applicationDeadline: isoDate,
    driveDate: isoDate,
  })
  .strict()
  .refine((v) => v.driveDate >= v.applicationDeadline, {
    message: "The drive cannot be before the application deadline",
    path: ["driveDate"],
  });

const driveStatusSchema = z.object({ status: z.enum(["OPEN", "CLOSED"]) }).strict();
const applicationStatusSchema = z
  .object({ status: z.enum(["SHORTLISTED", "SELECTED", "REJECTED"]) })
  .strict();

module.exports = {
  idParam,
  createCompanySchema,
  createDriveSchema,
  driveStatusSchema,
  applicationStatusSchema,
};
