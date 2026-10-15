/**
 * Report controller.
 *
 * What a viewer may see is decided in the service, from their own permissions
 * and department. Nothing in a request can widen it — the only hint a client
 * sends is an optional department filter, which the service pins for a
 * department-scoped caller.
 */

const { ApiError } = require("../utils/ApiError");
const reportService = require("../services/report.service");
const reportExport = require("../services/reportExport.service");
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

/**
 * GET /api/v1/reports/:kind/export?format=csv|pdf
 *
 * ## The report is built by the same service the screen uses
 *
 * The scope is resolved once, here, by calling exactly the function the
 * on-screen report calls. If the export queried Mongo itself, a scoping bug in
 * one and not the other would hand one department another department's requests
 * in a spreadsheet — and a spreadsheet is the artefact people actually
 * circulate.
 */
const exportReport = asyncHandler(async (req, res) => {
  const kind = req.params.kind;
  const { format = "csv", from, to, department } = req.validated.query;

  const builders = {
    overview: () => reportService.overview({ user: req.user, from, to }),
    requests: () =>
      reportService.requestsReport({ user: req.user, from, to, department }),
    students: () =>
      reportService.studentsReport({ user: req.user, from, to, department }),
    complaints: () => reportService.complaintsReport({ user: req.user, from, to }),
    finance: () => reportService.financeReport({ user: req.user, from, to }),
  };

  const build = builders[kind];
  if (!build) {
    throw ApiError.notFound("No such report");
  }

  const report = await build();
  const table = reportExport.toTable(kind, report, [
    { label: "generatedBy", value: req.user.email ?? req.user._id },
  ]);

  res.setHeader("X-Content-Type-Options", "nosniff");
  // A generated file must never be cached by a shared proxy: it is scoped to
  // whoever asked for it.
  res.setHeader("Cache-Control", "private, no-store");

  if (format === "pdf") {
    const buffer = await reportExport.toPdf(table);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${reportExport.exportFilename(kind, "pdf")}"`
    );
    return res.send(buffer);
  }

  const csv = reportExport.toCsv(table.headers, table.rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${reportExport.exportFilename(kind, "csv")}"`
  );
  // The BOM is what makes Excel read UTF-8; without it a rupee sign arrives as
  // mojibake in every spreadsheet on Windows.
  return res.send(`\uFEFF${csv}`);
});

module.exports = { overview, requests, students, complaints, finance, exportReport };
