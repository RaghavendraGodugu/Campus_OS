const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated } = require("../utils/response");

const attendanceService = require("../services/attendance.service");

/** POST /api/v1/attendance/sessions — mark a class. */
const mark = asyncHandler(async (req, res) => {
  const result = await attendanceService.mark({
    user: req.user,
    payload: req.validated.body,
    req,
  });
  return sendCreated(res, {
    message: "Attendance marked",
    data: result,
  });
});

/** PATCH /api/v1/attendance/sessions/:id — correct a register, with a reason. */
const correct = asyncHandler(async (req, res) => {
  const result = await attendanceService.correct({
    user: req.user,
    id: req.params.id,
    payload: req.validated.body,
    req,
  });
  return sendSuccess(res, {
    message: `Attendance corrected (revision ${result.session.revision})`,
    data: result,
  });
});

/** GET /api/v1/attendance/entry/:id?date=YYYY-MM-DD — the marking screen. */
const entryContext = asyncHandler(async (req, res) => {
  const context = await attendanceService.entryContext({
    user: req.user,
    entryId: req.params.id,
    date: req.validated.query.date,
  });
  return sendSuccess(res, { message: "Class register", data: context });
});

/** GET /api/v1/attendance/day?date=YYYY-MM-DD — today's classes for faculty. */
const day = asyncHandler(async (req, res) => {
  const result = await attendanceService.day({
    user: req.user,
    date: req.validated.query.date,
  });
  return sendSuccess(res, { message: "Classes for the day", data: result });
});

/** GET /api/v1/attendance/me?term= — a student's own attendance. */
const mine = asyncHandler(async (req, res) => {
  const result = await attendanceService.mine({
    user: req.user,
    termId: req.validated.query.term,
  });
  return sendSuccess(res, {
    message: result.term ? "Attendance retrieved" : "No academic term is open",
    data: result,
  });
});

/** GET /api/v1/attendance/subjects/:subjectId?term= — per-student breakdown. */
const subjectSummary = asyncHandler(async (req, res) => {
  const result = await attendanceService.subjectSummary({
    user: req.user,
    subjectId: req.params.subjectId,
    termId: req.validated.query.term,
  });
  return sendSuccess(res, { message: "Subject attendance", data: result });
});

/** GET /api/v1/attendance/overview?term= — HOD / institution roll-up. */
const overview = asyncHandler(async (req, res) => {
  const result = await attendanceService.overview({
    user: req.user,
    termId: req.validated.query.term,
  });
  return sendSuccess(res, { message: "Attendance roll-up", data: result });
});

module.exports = { mark, correct, entryContext, day, mine, subjectSummary, overview };
