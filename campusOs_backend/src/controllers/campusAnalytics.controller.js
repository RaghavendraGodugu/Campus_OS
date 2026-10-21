const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const service = require("../services/campusAnalytics.service");

/** GET /api/v1/analytics/campus */
const campus = asyncHandler(async (req, res) => {
  const data = await service.campus({ user: req.user });
  return sendSuccess(res, {
    message: "Campus analytics retrieved",
    data,
  });
});

module.exports = { campus };
