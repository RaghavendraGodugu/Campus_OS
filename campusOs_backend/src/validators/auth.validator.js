/**
 * Auth request validators.
 *
 * Every schema uses `.strict()` so an unexpected key is a 400 rather than being
 * silently ignored. That is what prevents a client from POSTing
 * `{ email, password, role: "SUPER_ADMIN" }` and having the extra field quietly
 * reach a model.
 *
 * Password rules are enforced here as a shared schema so login and any future
 * change-password endpoint cannot drift apart.
 */

const { z } = require("zod");

/**
 * Shared password policy.
 *
 * Deliberately rejects the most common real-world passwords rather than only
 * checking character classes — length and predictability matter far more than
 * symbol count. The list is intentionally short; the real control is the
 * 15-minute per-IP and per-account login throttle.
 */
const password = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password cannot exceed 128 characters")
  .refine((value) => /[a-z]/.test(value), {
    message: "Password must contain a lowercase letter",
  })
  .refine((value) => /[A-Z]/.test(value), {
    message: "Password must contain an uppercase letter",
  })
  .refine((value) => /\d/.test(value), { message: "Password must contain a number" })
  .refine(
    (value) =>
      ![
        "password",
        "password1",
        "password123",
        "12345678",
        "123456789",
        "qwerty123",
        "admin123",
        "campus123",
        "welcome1",
      ].includes(value.toLowerCase()),
    { message: "This password is too common. Please choose another." }
  );

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .email("Please provide a valid email address")
  .max(200, "Email cannot exceed 200 characters");

/** POST /auth/login */
const loginSchema = z
  .object({
    email,
    password: z.string().min(1, "Password is required").max(128),
  })
  .strict();

/**
 * POST /auth/refresh takes no body — the refresh token is in an HttpOnly cookie
 * that JavaScript cannot read. Accepting it in the body as well would offer a
 * second transport that is far easier to leak.
 */
const refreshSchema = z.object({}).strict();

/** POST /auth/logout — no body required. */
const logoutSchema = z.object({}).strict().partial();

/** POST /auth/change-password */
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: password,
  })
  .strict()
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

/** POST /auth/logout-all */
const logoutAllSchema = z.object({}).strict().partial();

module.exports = {
  loginSchema,
  refreshSchema,
  logoutSchema,
  logoutAllSchema,
  changePasswordSchema,
  passwordSchema: password,
  emailSchema: email,
};
