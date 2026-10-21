const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated } = require("../utils/response");

const subjectService = require("../services/subject.service");

/** GET /api/v1/subjects — academic reference data, readable by signed-in users. */
const list = asyncHandler(async (req, res) => {
  const subjects = await subjectService.list({ query: req.validated?.query ?? {} });
  return sendSuccess(res, { message: "Subjects listed", data: { subjects } });
});

/** GET /api/v1/subjects/:id */
const getOne = asyncHandler(async (req, res) => {
  const subject = await subjectService.getById(req.params.id);
  return sendSuccess(res, { message: "Subject retrieved", data: { subject } });
});

/** POST /api/v1/subjects */
const create = asyncHandler(async (req, res) => {
  const subject = await subjectService.create({
    user: req.user,
    payload: req.validated.body,
    req,
  });
  return sendCreated(res, { message: "Subject created", data: { subject } });
});

/** PATCH /api/v1/subjects/:id */
const update = asyncHandler(async (req, res) => {
  const subject = await subjectService.update({
    user: req.user,
    id: req.params.id,
    payload: req.validated.body,
    req,
  });
  return sendSuccess(res, { message: "Subject updated", data: { subject } });
});

/**
 * DELETE /api/v1/subjects/:id
 *
 * A retirement, not a deletion: the response carries `activeEntries` so the
 * caller can see that classes still reference the subject.
 */
const retire = asyncHandler(async (req, res) => {
  const subject = await subjectService.retire({
    user: req.user,
    id: req.params.id,
    req,
  });
  return sendSuccess(res, { message: "Subject retired", data: { subject } });
});

module.exports = { list, getOne, create, update, retire };
