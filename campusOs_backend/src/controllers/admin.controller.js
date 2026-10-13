/**
 * Administration controller.
 *
 * Thin by design: every decision lives in the service, so a rule cannot be
 * enforced in one HTTP path and forgotten in another.
 */

const adminService = require("../services/admin.service");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");

// ===== People =====

const listUsers = asyncHandler(async (req, res) => {
  const result = await adminService.listUsers({
    query: req.validated.query,
    user: req.user,
  });

  return sendSuccess(res, {
    message: "Users retrieved successfully",
    data: result.users,
    meta: { pagination: result.pagination },
  });
});

const createUser = asyncHandler(async (req, res) => {
  const result = await adminService.createUser({
    payload: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, {
    status: 201,
    message: "Account created",
    data: result.user,
    // Deliberately outside `data`: it must never be cached, logged by a
    // response interceptor, or picked up by a client that spreads `data`.
    meta: {
      temporaryPassword: result.temporaryPassword,
      notice: result.notice,
    },
  });
});

const updateUserDetails = asyncHandler(async (req, res) => {
  const user = await adminService.updateUserDetails({
    userId: req.validated.params.id,
    changes: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, { message: "Account updated", data: user });
});

const changeUserRole = asyncHandler(async (req, res) => {
  const user = await adminService.changeUserRole({
    userId: req.validated.params.id,
    changes: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, { message: "Role changed", data: user });
});

const setUserActive = asyncHandler(async (req, res) => {
  const user = await adminService.setUserActive({
    userId: req.validated.params.id,
    changes: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, { message: "Account updated", data: user });
});

const resetUserPassword = asyncHandler(async (req, res) => {
  const result = await adminService.resetUserPassword({
    userId: req.validated.params.id,
    changes: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, {
    message: "Password reset",
    data: result.user,
    meta: {
      temporaryPassword: result.temporaryPassword,
      notice: result.notice,
    },
  });
});

const describeRole = asyncHandler(async (req, res) => {
  const result = await adminService.describeRolePermissions({
    role: req.validated.params.role,
    user: req.user,
  });

  return sendSuccess(res, { message: "Role described", data: result });
});

// ===== Departments =====

const listDepartments = asyncHandler(async (req, res) => {
  const result = await adminService.listDepartments({
    query: req.validated.query,
    user: req.user,
  });

  return sendSuccess(res, {
    message: "Departments retrieved successfully",
    data: result.departments,
  });
});

const createDepartment = asyncHandler(async (req, res) => {
  const department = await adminService.createDepartment({
    payload: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, {
    status: 201,
    message: "Department created",
    data: department,
  });
});

const updateDepartment = asyncHandler(async (req, res) => {
  const department = await adminService.updateDepartment({
    departmentId: req.validated.params.id,
    changes: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, { message: "Department updated", data: department });
});

const setDepartmentActive = asyncHandler(async (req, res) => {
  const department = await adminService.setDepartmentActive({
    departmentId: req.validated.params.id,
    changes: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, { message: "Department updated", data: department });
});

// ===== Programmes =====

const listPrograms = asyncHandler(async (req, res) => {
  const result = await adminService.listPrograms({
    query: req.validated.query,
    user: req.user,
  });

  return sendSuccess(res, {
    message: "Programmes retrieved successfully",
    data: result.programs,
  });
});

const createProgram = asyncHandler(async (req, res) => {
  const programme = await adminService.createProgram({
    payload: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, {
    status: 201,
    message: "Programme created",
    data: programme,
  });
});

const updateProgram = asyncHandler(async (req, res) => {
  const programme = await adminService.updateProgram({
    programId: req.validated.params.id,
    changes: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, { message: "Programme updated", data: programme });
});

const setProgramActive = asyncHandler(async (req, res) => {
  const programme = await adminService.setProgramActive({
    programId: req.validated.params.id,
    changes: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, { message: "Programme updated", data: programme });
});

module.exports = {
  listUsers,
  createUser,
  updateUserDetails,
  changeUserRole,
  setUserActive,
  resetUserPassword,
  describeRole,
  listDepartments,
  createDepartment,
  updateDepartment,
  setDepartmentActive,
  listPrograms,
  createProgram,
  updateProgram,
  setProgramActive,
};
