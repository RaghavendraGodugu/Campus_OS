const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated } = require("../utils/response");
const service = require("../services/event.service");

const listEvents = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Events listed",
    data: { events: await service.listEvents({ user: req.user }) },
  }),
);

const createEvent = asyncHandler(async (req, res) =>
  sendCreated(res, {
    message: "Event created",
    data: {
      event: await service.createEvent({
        user: req.user,
        payload: req.validated.body,
        req,
      }),
    },
  }),
);

const updateEvent = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Event updated",
    data: {
      event: await service.updateEvent({
        user: req.user,
        id: req.validated.params.id,
        payload: req.validated.body,
        req,
      }),
    },
  }),
);

const rsvp = asyncHandler(async (req, res) =>
  sendCreated(res, {
    message: "Registered",
    data: await service.rsvp({ user: req.user, id: req.validated.params.id, req }),
  }),
);

const withdraw = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Registration released",
    data: await service.withdraw({ user: req.user, id: req.validated.params.id, req }),
  }),
);

module.exports = { listEvents, createEvent, updateEvent, rsvp, withdraw };
