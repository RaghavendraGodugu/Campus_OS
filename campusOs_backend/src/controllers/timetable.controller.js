const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated } = require("../utils/response");

const timetableService = require("../services/timetable.service");

/**
 * GET /api/v1/timetable
 *
 * The response always names the term it covers. "No classes" and "no term open"
 * are different states, and a client that cannot tell them apart renders the
 * wrong empty state.
 */
const list = asyncHandler(async (req, res) => {
  const { term, entries } = await timetableService.list({
    user: req.user,
    query: req.validated?.query ?? {},
  });

  return sendSuccess(res, {
    message: term ? "Timetable retrieved" : "No academic term is open",
    data: { term, entries },
    meta: { canManage: timetableService.canManage(req.user) },
  });
});

/** GET /api/v1/timetable/:id */
const getOne = asyncHandler(async (req, res) => {
  const entry = await timetableService.getById(req.params.id);
  return sendSuccess(res, { message: "Class retrieved", data: { entry } });
});

/** GET /api/v1/timetable/staff — who can be assigned to a class. */
const staff = asyncHandler(async (req, res) => {
  const people = await timetableService.listTeachingStaff({
    user: req.user,
    departmentId: req.validated?.query?.department,
  });
  return sendSuccess(res, { message: "Teaching staff listed", data: { staff: people } });
});

/** POST /api/v1/timetable */
const create = asyncHandler(async (req, res) => {
  const entry = await timetableService.create({
    user: req.user,
    payload: req.validated.body,
    req,
  });
  return sendCreated(res, { message: "Class scheduled", data: { entry } });
});

/** PATCH /api/v1/timetable/:id */
const update = asyncHandler(async (req, res) => {
  const entry = await timetableService.update({
    user: req.user,
    id: req.params.id,
    payload: req.validated.body,
    req,
  });
  return sendSuccess(res, { message: "Class updated", data: { entry } });
});

/** DELETE /api/v1/timetable/:id — soft removal from the grid. */
const remove = asyncHandler(async (req, res) => {
  const result = await timetableService.remove({
    user: req.user,
    id: req.params.id,
    req,
  });
  return sendSuccess(res, { message: "Class removed", data: result });
});

module.exports = { list, getOne, staff, create, update, remove };
