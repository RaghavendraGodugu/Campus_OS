const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated } = require("../utils/response");
const service = require("../services/hostel.service");

const listHostels = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Hostels listed",
    data: { hostels: await service.listHostels() },
  })
);

const createHostel = asyncHandler(async (req, res) =>
  sendCreated(res, {
    message: "Hostel created",
    data: {
      hostel: await service.createHostel({
        user: req.user,
        payload: req.validated.body,
        req,
      }),
    },
  })
);

const listRooms = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Rooms listed",
    data: { rooms: await service.listRooms(req.params.id) },
  })
);

const createRoom = asyncHandler(async (req, res) =>
  sendCreated(res, {
    message: "Room created",
    data: {
      room: await service.createRoom({
        user: req.user,
        hostelId: req.params.id,
        payload: req.validated.body,
        req,
      }),
    },
  })
);

const allocate = asyncHandler(async (req, res) =>
  sendCreated(res, {
    message: "Room allocated",
    data: {
      allocation: await service.allocate({
        user: req.user,
        payload: req.validated.body,
        req,
      }),
    },
  })
);

const vacate = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Allocation vacated",
    data: {
      allocation: await service.vacate({ user: req.user, id: req.params.id, req }),
    },
  })
);

const listAllocations = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Allocations listed",
    data: { allocations: await service.listAllocations(req.validated?.query ?? {}) },
  })
);

const mine = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Hostel details",
    data: await service.mine({ user: req.user }),
  })
);

const requestLeave = asyncHandler(async (req, res) =>
  sendCreated(res, {
    message: "Leave requested",
    data: {
      leave: await service.requestLeave({
        user: req.user,
        payload: req.validated.body,
        req,
      }),
    },
  })
);

const listLeaves = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Leave requests listed",
    data: { leaves: await service.listLeaves(req.validated?.query ?? {}) },
  })
);

const decideLeave = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Leave decided",
    data: {
      leave: await service.decideLeave({
        user: req.user,
        id: req.params.id,
        payload: req.validated.body,
        req,
      }),
    },
  })
);

module.exports = {
  listHostels,
  createHostel,
  listRooms,
  createRoom,
  allocate,
  vacate,
  listAllocations,
  mine,
  requestLeave,
  listLeaves,
  decideLeave,
};
