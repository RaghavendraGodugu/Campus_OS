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

module.exports = { listStaff };
