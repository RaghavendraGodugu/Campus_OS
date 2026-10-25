/**
 * Directory query schemas.
 */

const { z } = require("zod");

/** GET /users/staff */
const listStaffSchema = z
  .object({
    /** Honoured only by an institution-wide assigner; ignored otherwise. */
    department: z
      .string()
      .regex(/^[a-f\d]{24}$/i, "Must be a valid id")
      .optional(),
  })
  .strict();

/** GET /directory/staff */
const searchStaffSchema = z
  .object({
    /** Fragment of a name, designation or declared expertise. */
    q: z.string().trim().min(1).max(80).optional(),
    department: z
      .string()
      .regex(/^[a-f0-9]{24}$/i, "Must be a valid id")
      .optional(),
    /** Only staff roles are searchable. */
    role: z
      .enum([
        "SUPPORT_STAFF",
        "FACULTY",
        "HOD",
        "EXAM_ADMIN",
        "ACCOUNTS_ADMIN",
        "HOSTEL_ADMIN",
        "PLACEMENT_ADMIN",
        "LIBRARY_ADMIN",
        "DEAN",
        "PRINCIPAL",
        "SUPER_ADMIN",
      ])
      .optional(),
  })
  .strict();

module.exports = { listStaffSchema, searchStaffSchema };
