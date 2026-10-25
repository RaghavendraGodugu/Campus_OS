/**
 * Staff directory controller.
 *
 * Exists so the assignment workflow has a list to populate from. Gated on the
 * same permission that permits assigning — see directory.service.js.
 */

const directoryService = require("../services/directory.service");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");

/** GET /api/v1/users/staff */
const listStaff = asyncHandler(async (req, res) => {
  const staff = await directoryService.listAssignableStaff({
    user: req.user,
    departmentId: req.validated?.query?.department,
  });

  return sendSuccess(res, {
    message: `${staff.length} staff member(s) available`,
    data: staff,
  });
});

/**
 * GET /api/v1/directory/staff
 *
 * The searchable directory. See directory.service.js for who may call it and
 * what it leaks, which is as little as a finding-people tool needs.
 */
const searchStaff = asyncHandler(async (req, res) => {
  const results = await directoryService.searchStaff({
    user: req.user,
    q: req.validated?.query?.q,
    departmentId: req.validated?.query?.department,
    role: req.validated?.query?.role,
  });

  return sendSuccess(res, {
    message: `${results.length} results`,
    data: results,
  });
});

module.exports = { listStaff, searchStaff };
