const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated } = require("../utils/response");

const termService = require("../services/academicTerm.service");

/** GET /api/v1/academic-terms — every role may read the current term. */
const list = asyncHandler(async (req, res) => {
  const terms = await termService.list();
  return sendSuccess(res, { message: "Terms listed", data: { terms } });
});

/** GET /api/v1/academic-terms/current */
const current = asyncHandler(async (req, res) => {
  const term = await termService.current();
  // Null here is a real answer rather than an error: a college between terms can
  // still read, export and audit, it simply cannot raise a fee against a term
  // that does not exist yet.
  return sendSuccess(res, {
    message: term ? "Current term" : "No term is currently open",
    data: { term },
  });
});

/** GET /api/v1/academic-terms/:id */
const getOne = asyncHandler(async (req, res) => {
  const term = await termService.getById(req.params.id);
  return sendSuccess(res, { message: "Term retrieved", data: { term } });
});

/** POST /api/v1/academic-terms */
const create = asyncHandler(async (req, res) => {
  const term = await termService.create({
    user: req.user,
    payload: req.validated.body,
    req,
  });
  return sendCreated(res, { message: "Term created", data: { term } });
});

/** PATCH /api/v1/academic-terms/:id */
const update = asyncHandler(async (req, res) => {
  const term = await termService.update({
    user: req.user,
    id: req.params.id,
    payload: req.validated.body,
    req,
  });
  return sendSuccess(res, { message: "Term updated", data: { term } });
});

/** POST /api/v1/academic-terms/:id/open */
const open = asyncHandler(async (req, res) => {
  const term = await termService.open({
    user: req.user,
    id: req.params.id,
    req,
  });
  return sendSuccess(res, { message: `${term.name} is now open`, data: { term } });
});

/** POST /api/v1/academic-terms/:id/close */
const close = asyncHandler(async (req, res) => {
  const term = await termService.close({
    user: req.user,
    id: req.params.id,
    req,
  });
  return sendSuccess(res, { message: `${term.name} is now closed`, data: { term } });
});

/** DELETE /api/v1/academic-terms/:id */
const remove = asyncHandler(async (req, res) => {
  await termService.remove({ user: req.user, id: req.params.id, req });
  return sendSuccess(res, { message: "Term deleted", data: { removed: true } });
});

/** POST /api/v1/academic-terms/rollover/prepare-next-year */
const prepareNextYear = asyncHandler(async (req, res) => {
  const { currentYear, nextYearStart } = req.validated.body;
  const terms = await termService.prepareNextYear({
    user: req.user,
    currentYear,
    nextYearStart: new Date(nextYearStart),
    req,
  });
  return sendCreated(res, {
    message: `${terms.length} term(s) prepared for the next academic year`,
    data: { terms },
  });
});

/** POST /api/v1/academic-terms/rollover/check — callable by external cron */
const autoRolloverCheck = asyncHandler(async (req, res) => {
  const result = await termService.autoRolloverCheck({ req });
  return sendSuccess(res, {
    message: "Automatic rollover check completed",
    data: result,
  });
});

module.exports = { list, current, getOne, create, update, open, close, remove, prepareNextYear, autoRolloverCheck };
