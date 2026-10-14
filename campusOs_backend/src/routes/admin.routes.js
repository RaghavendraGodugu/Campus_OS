/**
 * Administration routes.
 *
 * The widest blast radius in the system: who can sign in, what they may see,
 * and which office owns which work.
 *
 * ## Reads are open to every signed-in account, writes are not
 *
 * Reading the department and programme lists is already in every role's base
 * permissions, because a request form needs a dropdown of departments. Adding a
 * privileged read here would produce a page the dropdown depends on and a
 * viewer cannot load. Writing requires an explicit manage permission.
 *
 * ## Role changes and deactivations are separate routes
 *
 * Not one `PATCH /users/:id`. Changing a name and changing what a person is
 * allowed to do are different acts; giving them one route and one permission
 * makes "fix the typo" indistinguishable from promotion, and the audit trail
 * records both as the same kind of update.
 */

const express = require("express");

const adminController = require("../controllers/admin.controller");
const { validate } = require("../middleware/validate");
const { authenticate, requirePermission } = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { P } = require("../utils/permissions");
const {
  createUserSchema,
  updateUserDetailsSchema,
  changeUserRoleSchema,
  setUserActiveSchema,
  resetUserPasswordSchema,
  listUsersSchema,
  userIdentifier,
  roleIdentifier,
  createDepartmentSchema,
  updateDepartmentSchema,
  setDepartmentActiveSchema,
  listDepartmentsSchema,
  departmentIdentifier,
  createProgramSchema,
  updateProgramSchema,
  setProgramActiveSchema,
  listProgramsSchema,
  programIdentifier,
  createRequestTypeSchema,
  updateRequestTypeSchema,
  setRequestTypeActiveSchema,
  listRequestTypesSchema,
  requestTypeIdentifier,
} = require("../validators/admin.validator");

const router = express.Router();

// ===== People =====

/** GET /api/v1/admin/roles/:role — what a role can do. */
router.get(
  "/admin/roles/:role",
  authenticate,
  validate({ params: roleIdentifier }),
  adminController.describeRole
);

/** GET /api/v1/admin/users */
router.get(
  "/admin/users",
  authenticate,
  requirePermission(P.USER_READ),
  validate({ query: listUsersSchema }),
  adminController.listUsers
);

/** POST /api/v1/admin/users — creates a staff account. */
router.post(
  "/admin/users",
  authenticate,
  csrfProtection,
  requirePermission(P.USER_MANAGE),
  validate({ body: createUserSchema }),
  adminController.createUser
);

/** PATCH /api/v1/admin/users/:id — name, phone, department. Never the role. */
router.patch(
  "/admin/users/:id",
  authenticate,
  csrfProtection,
  requirePermission(P.USER_MANAGE),
  validate({ params: userIdentifier, body: updateUserDetailsSchema }),
  adminController.updateUserDetails
);

/** POST /api/v1/admin/users/:id/role — its own permission, its own audit line. */
router.post(
  "/admin/users/:id/role",
  authenticate,
  csrfProtection,
  requirePermission(P.ROLE_CHANGE),
  validate({ params: userIdentifier, body: changeUserRoleSchema }),
  adminController.changeUserRole
);

/** POST /api/v1/admin/users/:id/active */
router.post(
  "/admin/users/:id/active",
  authenticate,
  csrfProtection,
  requirePermission(P.USER_MANAGE),
  validate({ params: userIdentifier, body: setUserActiveSchema }),
  adminController.setUserActive
);

/** POST /api/v1/admin/users/:id/reset-password */
router.post(
  "/admin/users/:id/reset-password",
  authenticate,
  csrfProtection,
  requirePermission(P.USER_MANAGE),
  validate({ params: userIdentifier, body: resetUserPasswordSchema }),
  adminController.resetUserPassword
);

// ===== Departments =====

router.get(
  "/admin/departments",
  authenticate,
  validate({ query: listDepartmentsSchema }),
  adminController.listDepartments
);

router.post(
  "/admin/departments",
  authenticate,
  csrfProtection,
  requirePermission(P.DEPARTMENT_MANAGE),
  validate({ body: createDepartmentSchema }),
  adminController.createDepartment
);

router.patch(
  "/admin/departments/:id",
  authenticate,
  csrfProtection,
  requirePermission(P.DEPARTMENT_MANAGE),
  validate({ params: departmentIdentifier, body: updateDepartmentSchema }),
  adminController.updateDepartment
);

router.post(
  "/admin/departments/:id/active",
  authenticate,
  csrfProtection,
  requirePermission(P.DEPARTMENT_MANAGE),
  validate({ params: departmentIdentifier, body: setDepartmentActiveSchema }),
  adminController.setDepartmentActive
);

// ===== Request types =====

router.get(
  "/admin/request-types",
  authenticate,
  requirePermission(P.REQUEST_TYPE_MANAGE),
  validate({ query: listRequestTypesSchema }),
  adminController.listRequestTypes
);

router.post(
  "/admin/request-types",
  authenticate,
  csrfProtection,
  requirePermission(P.REQUEST_TYPE_MANAGE),
  validate({ body: createRequestTypeSchema }),
  adminController.createRequestType
);

router.patch(
  "/admin/request-types/:id",
  authenticate,
  csrfProtection,
  requirePermission(P.REQUEST_TYPE_MANAGE),
  validate({ params: requestTypeIdentifier, body: updateRequestTypeSchema }),
  adminController.updateRequestType
);

router.post(
  "/admin/request-types/:id/active",
  authenticate,
  csrfProtection,
  requirePermission(P.REQUEST_TYPE_MANAGE),
  validate({ params: requestTypeIdentifier, body: setRequestTypeActiveSchema }),
  adminController.setRequestTypeActive
);

// ===== Programmes =====

router.get(
  "/admin/programs",
  authenticate,
  validate({ query: listProgramsSchema }),
  adminController.listPrograms
);

router.post(
  "/admin/programs",
  authenticate,
  csrfProtection,
  requirePermission(P.PROGRAM_MANAGE),
  validate({ body: createProgramSchema }),
  adminController.createProgram
);

router.patch(
  "/admin/programs/:id",
  authenticate,
  csrfProtection,
  requirePermission(P.PROGRAM_MANAGE),
  validate({ params: programIdentifier, body: updateProgramSchema }),
  adminController.updateProgram
);

router.post(
  "/admin/programs/:id/active",
  authenticate,
  csrfProtection,
  requirePermission(P.PROGRAM_MANAGE),
  validate({ params: programIdentifier, body: setProgramActiveSchema }),
  adminController.setProgramActive
);

module.exports = router;
