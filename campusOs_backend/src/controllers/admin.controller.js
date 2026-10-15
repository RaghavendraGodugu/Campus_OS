/**
 * Administration controller.
 *
 * Thin by design: every decision lives in the service, so a rule cannot be
 * enforced in one HTTP path and forgotten in another.
 */

const adminService = require("../services/admin.service");
const studentImportService = require("../services/studentImport.service");
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

/** POST /api/v1/admin/departments/:id/hod — appoint or clear the head. */
const assignHod = asyncHandler(async (req, res) => {
  const department = await adminService.assignHod({
    departmentId: req.params.id,
    userId: req.validated.body.userId ?? null,
    user: req.user,
    req,
  });

  return sendSuccess(res, {
    message: department.hod ? "Head of department updated" : "Head of department cleared",
    data: { department },
  });
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

// ===== Request types =====

const listRequestTypes = asyncHandler(async (req, res) => {
  const result = await adminService.listRequestTypes({
    query: req.validated.query,
    user: req.user,
  });

  return sendSuccess(res, {
    message: "Request types retrieved successfully",
    data: result.requestTypes,
  });
});

const createRequestType = asyncHandler(async (req, res) => {
  const requestType = await adminService.createRequestType({
    payload: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, {
    status: 201,
    message: "Request type created",
    data: requestType,
  });
});

const updateRequestType = asyncHandler(async (req, res) => {
  const requestType = await adminService.updateRequestType({
    requestTypeId: req.validated.params.id,
    changes: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, { message: "Request type updated", data: requestType });
});

const setRequestTypeActive = asyncHandler(async (req, res) => {
  const requestType = await adminService.setRequestTypeActive({
    requestTypeId: req.validated.params.id,
    changes: req.validated.body,
    user: req.user,
    req,
  });

  return sendSuccess(res, { message: "Request type updated", data: requestType });
});

// ===== Student import =====

/** POST /admin/students/import/validate — a dry run. Writes nothing. */
const validateStudentImport = asyncHandler(async (req, res) => {
  const report = await studentImportService.validateImport({
    csv: req.validated.body.csv,
  });

  return sendSuccess(res, { message: report.message, data: report });
});

/** POST /admin/students/import/commit — all rows or none. */
const commitStudentImport = asyncHandler(async (req, res) => {
  const result = await studentImportService.commitImport({
    csv: req.validated.body.csv,
    user: req.user,
    req,
  });

  return sendSuccess(res, {
    status: 201,
    message: `${result.imported} student${result.imported === 1 ? "" : "s"} imported`,
    data: { imported: result.imported },
    // Outside `data` so it is never cached or picked up by a client that
    // spreads the payload around. This is the only time it exists in clear.
    meta: { credentials: result.credentials, notice: result.notice },
  });
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
  assignHod,
  validateStudentImport,
  commitStudentImport,
  listRequestTypes,
  createRequestType,
  updateRequestType,
  setRequestTypeActive,
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
