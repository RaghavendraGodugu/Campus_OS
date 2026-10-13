/**
 * Administration schemas: people, departments, programmes.
 *
 * Two ideas run through all of them.
 *
 * **A role change is not an edit.** Updating a person's name or phone is
 * ordinary profile work; changing what a person is *allowed to do* is a
 * different act with a different blast radius, so it gets its own route, its own
 * permission and its own audit entry. Conflating them is how a "fix the typo"
 * form quietly promotes somebody.
 *
 * **Deactivating is not deleting.** A user referenced by an invoice, a
 * certificate or an audit entry cannot be removed without either breaking those
 * records or cascading a delete through history that is supposed to be
 * append-only. Accounts are switched off, and the history they took part in
 * stays exactly where it was.
 */

const { z } = require("zod");

const { ROLES } = require("../config/constants");

const objectId = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Not a valid identifier");

/**
 * Roles an administrator may assign.
 *
 * SUPER_ADMIN is deliberately absent. It is not self-service: an account that
 * can mint another account able to mint accounts is how a super admin is lost,
 * quietly, through a well-meaning helpdesk action. The first one comes from a
 * script run on the server; further ones are a deliberate, reviewed decision.
 */
const ASSIGNABLE_ROLES = Object.freeze(
  Object.values(ROLES).filter((role) => role !== ROLES.SUPER_ADMIN)
);

const roleEnum = z.enum(ASSIGNABLE_ROLES, {
  message:
    `Role must be one of: ${ASSIGNABLE_ROLES.join(", ")}. ` +
    "Super administrator is deliberately not assignable here.",
});

/**
 * Programme levels, taken verbatim from the Program model.
 *
 * These are printed on certificates and transcripts, so the model's vocabulary is
 * the canonical one. Accepting shorter aliases at the API boundary would let a
 * programme be created that the model then rejects.
 */
const PROGRAM_LEVELS = Object.freeze([
  "UNDERGRADUATE",
  "POSTGRADUATE",
  "DIPLOMA",
  "CERTIFICATE",
  "DOCTORAL",
]);

const levelEnum = z.enum(PROGRAM_LEVELS, {
  message: `Level must be one of: ${PROGRAM_LEVELS.join(", ")}`,
});

/** Exactly what may be said about a new account. Nothing more. */
const createUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address"),
    fullName: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(150, "Name cannot exceed 150 characters"),
    role: roleEnum,
    department: objectId.optional(),
    phone: z
      .string()
      .trim()
      .max(20)
      .regex(/^\+?[0-9 ()-]{6,20}$/, "Enter a valid phone number")
      .optional()
      .or(z.literal("")),
  })
  .strict();

/**
 * The ordinary edits. Deliberately cannot touch `role`, `email` or `isActive`:
 * each of those is a separate route with a separate permission.
 */
const updateUserDetailsSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(150, "Name cannot exceed 150 characters")
      .optional(),
    phone: z
      .string()
      .trim()
      .max(20)
      .regex(/^\+?[0-9 ()-]{6,20}$/, "Enter a valid phone number")
      .optional()
      .or(z.literal("")),
    department: objectId.optional().nullable(),
  })
  .strict();

/** ROLE_CHANGE. Its own route so it can be refused on its own merits. */
const changeUserRoleSchema = z
  .object({
    role: roleEnum,
    department: objectId.optional().nullable(),
    /**
     * Why. Required, because a role change with no stated reason cannot be
     * reviewed six months later by anyone but the person who made it.
     */
    reason: z
      .string()
      .trim()
      .min(10, "Give a reason of at least 10 characters")
      .max(500, "Reason cannot exceed 500 characters"),
  })
  .strict();

/**
 * Switching an account off, or back on.
 *
 * Requires a reason for the same reason the role change does, and refuses
 * without one when turning an account *off* — an unexplained deactivation of a
 * senior officer is indistinguishable from an attack.
 */
const setUserActiveSchema = z
  .object({
    isActive: z.boolean(),
    reason: z
      .string()
      .trim()
      .min(10, "Give a reason of at least 10 characters")
      .max(500, "Reason cannot exceed 500 characters"),
  })
  .strict();

/** Issue a fresh temporary password, replacing whatever the account had. */
const resetUserPasswordSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(10, "Give a reason of at least 10 characters")
      .max(500, "Reason cannot exceed 500 characters"),
  })
  .strict();

const listUsersSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    role: roleEnum.optional(),
    department: objectId.optional(),
    /** Accepts "true"/"false"/"1"/"0", which is what a URL query can carry. */
    isActive: z
      .enum(["true", "false", "1", "0"])
      .transform((value) => value === "true" || value === "1")
      .optional(),
    search: z.string().trim().max(150).optional(),
  })
  .strict();

const userIdentifier = z.object({ id: objectId }).strict();

// ===== Departments =====

const createDepartmentSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(150, "Name cannot exceed 150 characters"),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2, "Code must be at least 2 characters")
      .max(20, "Code cannot exceed 20 characters")
      .regex(/^[A-Z0-9-]+$/, "Code may contain letters, numbers and hyphens only"),
  })
  .strict();

const updateDepartmentSchema = createDepartmentSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

const setDepartmentActiveSchema = z
  .object({
    isActive: z.boolean(),
    reason: z
      .string()
      .trim()
      .min(10, "Give a reason of at least 10 characters")
      .max(500, "Reason cannot exceed 500 characters"),
  })
  .strict();

const listDepartmentsSchema = z
  .object({
    includeInactive: z
      .enum(["true", "false", "1", "0"])
      .transform((value) => value === "true" || value === "1")
      .optional(),
    search: z.string().trim().max(150).optional(),
  })
  .strict();

const departmentIdentifier = z.object({ id: objectId }).strict();

const roleIdentifier = z.object({ role: roleEnum }).strict();

// ===== Programmes =====

const createProgramSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(150, "Name cannot exceed 150 characters"),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2, "Code must be at least 2 characters")
      .max(20, "Code cannot exceed 20 characters")
      .regex(/^[A-Z0-9-]+$/, "Code may contain letters, numbers and hyphens only"),
    department: objectId,
    level: levelEnum,
    durationYears: z.coerce
      .number()
      .int()
      .min(1, "Duration must be at least one year")
      .max(10, "Duration cannot exceed ten years"),
  })
  .strict();

const updateProgramSchema = createProgramSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

const setProgramActiveSchema = z
  .object({
    isActive: z.boolean(),
    reason: z
      .string()
      .trim()
      .min(10, "Give a reason of at least 10 characters")
      .max(500, "Reason cannot exceed 500 characters"),
  })
  .strict();

const listProgramsSchema = z
  .object({
    department: objectId.optional(),
    level: levelEnum.optional(),
    includeInactive: z
      .enum(["true", "false", "1", "0"])
      .transform((value) => value === "true" || value === "1")
      .optional(),
    search: z.string().trim().max(150).optional(),
  })
  .strict();

const programIdentifier = z.object({ id: objectId }).strict();

module.exports = {
  ASSIGNABLE_ROLES,
  PROGRAM_LEVELS,
  createUserSchema,
  updateUserDetailsSchema,
  changeUserRoleSchema,
  setUserActiveSchema,
  resetUserPasswordSchema,
  listUsersSchema,
  userIdentifier,
  createDepartmentSchema,
  updateDepartmentSchema,
  setDepartmentActiveSchema,
  listDepartmentsSchema,
  departmentIdentifier,
  roleIdentifier,
  createProgramSchema,
  updateProgramSchema,
  setProgramActiveSchema,
  listProgramsSchema,
  programIdentifier,
  objectId,
};
