const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated } = require("../utils/response");
const service = require("../services/placement.service");

const listDrives = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Drives listed",
    data: { drives: await service.listDrives({ user: req.user }) },
  })
);

const listCompanies = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Companies listed",
    data: { companies: await service.listCompanies() },
  })
);

const createCompany = asyncHandler(async (req, res) =>
  sendCreated(res, {
    message: "Company created",
    data: {
      company: await service.createCompany({
        user: req.user,
        payload: req.validated.body,
        req,
      }),
    },
  })
);

const createDrive = asyncHandler(async (req, res) =>
  sendCreated(res, {
    message: "Drive created",
    data: {
      drive: await service.createDrive({
        user: req.user,
        payload: req.validated.body,
        req,
      }),
    },
  })
);

const setDriveStatus = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Drive updated",
    data: {
      drive: await service.setDriveStatus({
        user: req.user,
        id: req.params.id,
        payload: req.validated.body,
        req,
      }),
    },
  })
);

const apply = asyncHandler(async (req, res) =>
  sendCreated(res, {
    message: "Application submitted",
    data: {
      application: await service.apply({ user: req.user, driveId: req.params.id, req }),
    },
  })
);

const withdraw = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Application withdrawn",
    data: {
      application: await service.withdraw({
        user: req.user,
        driveId: req.params.id,
        req,
      }),
    },
  })
);

const mine = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Your applications",
    data: { applications: await service.mine({ user: req.user }) },
  })
);

const listApplications = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Applications listed",
    data: { applications: await service.listApplications({ driveId: req.params.id }) },
  })
);

const decideApplication = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Application updated",
    data: {
      application: await service.decideApplication({
        user: req.user,
        id: req.params.id,
        payload: req.validated.body,
        req,
      }),
    },
  })
);

module.exports = {
  listCompanies,
  listDrives,
  createCompany,
  createDrive,
  setDriveStatus,
  apply,
  withdraw,
  mine,
  listApplications,
  decideApplication,
};
