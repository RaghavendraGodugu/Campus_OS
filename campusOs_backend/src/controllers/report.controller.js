/**
 * Report controller.
 *
 * What a viewer may see is decided in the service, from their own permissions
 * and department. Nothing in a request can widen it — the only hint a client
 * sends is an optional department filter, which the service pins for a
 * department-scoped caller.
 */

const reportService = require("../services/report.service");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");

/** GET /api/v1/reports/overview */
const overview = asyncHandler(async (req, res) => {
  const report = await reportService.overview({
    user: req.user,
    from: req.validated.query.from,
    to: req.validated.query.to,
  });

  return sendSuccess(res, {
    message: "Overview generated",
    data: report,
  });
});

/** GET /api/v1/reports/requests */
const requests = asyncHandler(async (req, res) => {
  const report = await reportService.requestsReport({
    user: req.user,
    from: req.validated.query.from,
    to: req.validated.query.to,
    department: req.validated.query.department,
  });

  return sendSuccess(res, {
    message: report.available
      ? "Request report generated"
      : "Request report is unavailable for this account",
    data: report,
  });
});

/** GET /api/v1/reports/students */
const students = asyncHandler(async (req, res) => {
  const report = await reportService.studentsReport({
    user: req.user,
    from: req.validated.query.from,
    to: req.validated.query.to,
    department: req.validated.query.department,
  });

  return sendSuccess(res, {
    message: report.available
      ? "Student report generated"
      : "Student report is unavailable for this account",
    data: report,
  });
});

/** GET /api/v1/reports/complaints — institution scope only. */
const complaints = asyncHandler(async (req, res) => {
  const report = await reportService.complaintsReport({
    user: req.user,
    from: req.validated.query.from,
    to: req.validated.query.to,
  });

  return sendSuccess(res, { message: "Complaint report generated", data: report });
});

/** GET /api/v1/reports/finance — institution scope only. */
const finance = asyncHandler(async (req, res) => {
  const report = await reportService.financeReport({
    user: req.user,
    from: req.validated.query.from,
    to: req.validated.query.to,
  });

  return sendSuccess(res, { message: "Finance report generated", data: report });
});

module.exports = { overview, requests, students, complaints, finance };
