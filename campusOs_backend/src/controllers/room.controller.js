const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated } = require("../utils/response");

const roomService = require("../services/room.service");

/** GET /api/v1/rooms */
const list = asyncHandler(async (req, res) => {
  const rooms = await roomService.list({ query: req.validated?.query ?? {} });
  return sendSuccess(res, { message: "Rooms listed", data: { rooms } });
});

/** GET /api/v1/rooms/:id */
const getOne = asyncHandler(async (req, res) => {
  const room = await roomService.getById(req.params.id);
  return sendSuccess(res, { message: "Room retrieved", data: { room } });
});

/** POST /api/v1/rooms */
const create = asyncHandler(async (req, res) => {
  const room = await roomService.create({
    user: req.user,
    payload: req.validated.body,
    req,
  });
  return sendCreated(res, { message: "Room created", data: { room } });
});

/** PATCH /api/v1/rooms/:id */
const update = asyncHandler(async (req, res) => {
  const room = await roomService.update({
    user: req.user,
    id: req.params.id,
    payload: req.validated.body,
    req,
  });
  return sendSuccess(res, { message: "Room updated", data: { room } });
});

/** DELETE /api/v1/rooms/:id — retire, reporting classes still using it. */
const retire = asyncHandler(async (req, res) => {
  const room = await roomService.retire({
    user: req.user,
    id: req.params.id,
    req,
  });
  return sendSuccess(res, { message: "Room retired", data: { room } });
});

module.exports = { list, getOne, create, update, retire };
