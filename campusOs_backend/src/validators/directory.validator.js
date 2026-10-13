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

module.exports = { listStaffSchema };
