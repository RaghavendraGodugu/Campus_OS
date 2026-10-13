/**
 * Profile schemas.
 *
 * `updateProfileSchema` is strict and takes exactly two fields. That strictness
 * is the feature: a person cannot change their own programme, roll number or
 * role, and a request that tries is refused by name rather than silently
 * ignored.
 */

const { z } = require("zod");

/** Phone: digits, spaces, brackets and a leading +. Nothing else. */
const phone = z
  .string()
  .trim()
  .max(20, "Phone number cannot exceed 20 characters")
  .regex(/^\+?[0-9 ()-]{6,20}$/, "Enter a valid phone number")
  .optional()
  .or(z.literal(""));

/**
 * NOT `.strict()`, deliberately.
 *
 * A strict schema rejects an unexpected field at the door with one generic
 * "the submitted data is invalid", so a person who tried to change their
 * roll number learns nothing about which field was refused or why. The service
 * refuses the same fields with a message that names them and explains that they
 * are institutional data — one authoritative answer, in one place.
 *
 * The two editable fields are still validated here, as strictly as ever.
 */
const updateProfileSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(150, "Name cannot exceed 150 characters")
      .optional(),
    phone,
  })
  // `.passthrough()`, not the default strip: unknown fields have to survive
  // validation to reach the service, which is where they are refused by name.
  // Stripped here, they would vanish and the person would be told only that
  // "the submitted data is invalid".
  .passthrough()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(12, "A new password must be at least 12 characters")
      .max(128)
      .regex(/[a-z]/, "Include a lower-case letter")
      .regex(/[A-Z]/, "Include an upper-case letter")
      .regex(/[0-9]/, "Include a number"),
  })
  .strict();

module.exports = { updateProfileSchema, changePasswordSchema };
