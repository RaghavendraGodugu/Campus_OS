const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated } = require("../utils/response");

const resultService = require("../services/result.service");

/** GET /api/v1/results/assessments?subject=&term= */
const listAssessments = asyncHandler(async (req, res) => {
  const data = await resultService.listAssessments({
    user: req.user,
    subjectId: req.validated.query.subject,
    termId: req.validated.query.term,
  });
  return sendSuccess(res, { message: "Assessment components listed", data });
});

/** POST /api/v1/results/assessments */
const createAssessment = asyncHandler(async (req, res) => {
  const assessment = await resultService.createAssessment({
    user: req.user,
    payload: req.validated.body,
    req,
  });
  return sendCreated(res, { message: "Component created", data: { assessment } });
});

/** DELETE /api/v1/results/assessments/:id */
const removeAssessment = asyncHandler(async (req, res) => {
  const result = await resultService.removeAssessment({
    user: req.user,
    id: req.params.id,
    req,
  });
  return sendSuccess(res, { message: "Component removed", data: result });
});

/** GET /api/v1/results/subjects/:subjectId?term= — marks sheet and results. */
const marksGrid = asyncHandler(async (req, res) => {
  const data = await resultService.marksGrid({
    user: req.user,
    subjectId: req.params.subjectId,
    termId: req.validated.query.term,
  });
  return sendSuccess(res, { message: "Marks sheet", data });
});

/** POST /api/v1/results/marks — enter or update marks for one component. */
const saveMarks = asyncHandler(async (req, res) => {
  const data = await resultService.saveMarks({
    user: req.user,
    payload: req.validated.body,
    req,
  });
  return sendSuccess(res, { message: "Marks saved", data });
});

/** POST /api/v1/results/publish — release a programme's results. */
const publish = asyncHandler(async (req, res) => {
  const data = await resultService.publish({
    user: req.user,
    payload: req.validated.body,
    req,
  });
  return sendSuccess(res, {
    message: data.alreadyPublished
      ? "These results were already released"
      : "Results released",
    data,
  });
});

/** GET /api/v1/results/releases?term= */
const releases = asyncHandler(async (req, res) => {
  const data = await resultService.listReleases({
    user: req.user,
    termId: req.validated.query.term,
  });
  return sendSuccess(res, { message: "Releases listed", data: { releases: data } });
});

/** GET /api/v1/results/me?term= — a student's released results. */
const mine = asyncHandler(async (req, res) => {
  const data = await resultService.studentResults({
    user: req.user,
    termId: req.validated.query.term,
  });
  return sendSuccess(res, {
    message: data.published
      ? "Results retrieved"
      : "Results have not been released for your programme yet",
    data,
  });
});

module.exports = {
  listAssessments,
  createAssessment,
  removeAssessment,
  marksGrid,
  saveMarks,
  publish,
  releases,
  mine,
};
