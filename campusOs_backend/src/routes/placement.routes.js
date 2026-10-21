const express = require("express");
const {
  authenticate,
  requirePermission,
  requireAnyPermission,
} = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { validate } = require("../middleware/validate");
const { P } = require("../utils/permissions");
const controller = require("../controllers/placement.controller");
const {
  idParam,
  createCompanySchema,
  createDriveSchema,
  driveStatusSchema,
  applicationStatusSchema,
} = require("../validators/placement.validator");

const router = express.Router();

router.get(
  "/placement/companies",
  authenticate,
  requireAnyPermission(P.PLACEMENT_READ_OWN, P.PLACEMENT_READ_INSTITUTION),
  controller.listCompanies
);
router.get(
  "/placement/drives",
  authenticate,
  requireAnyPermission(P.PLACEMENT_READ_OWN, P.PLACEMENT_READ_INSTITUTION),
  controller.listDrives
);
router.post(
  "/placement/companies",
  authenticate,
  csrfProtection,
  requirePermission(P.PLACEMENT_MANAGE),
  validate({ body: createCompanySchema }),
  controller.createCompany
);
router.post(
  "/placement/drives",
  authenticate,
  csrfProtection,
  requirePermission(P.PLACEMENT_MANAGE),
  validate({ body: createDriveSchema }),
  controller.createDrive
);

router.get(
  "/placement/me",
  authenticate,
  requirePermission(P.PLACEMENT_READ_OWN),
  controller.mine
);

router.post(
  "/placement/drives/:id/status",
  authenticate,
  csrfProtection,
  requirePermission(P.PLACEMENT_MANAGE),
  validate({ params: idParam, body: driveStatusSchema }),
  controller.setDriveStatus
);
router.get(
  "/placement/drives/:id/applications",
  authenticate,
  requirePermission(P.PLACEMENT_READ_INSTITUTION),
  validate({ params: idParam }),
  controller.listApplications
);
router.post(
  "/placement/drives/:id/apply",
  authenticate,
  csrfProtection,
  requirePermission(P.PLACEMENT_APPLY_OWN),
  validate({ params: idParam }),
  controller.apply
);
router.post(
  "/placement/drives/:id/withdraw",
  authenticate,
  csrfProtection,
  requirePermission(P.PLACEMENT_APPLY_OWN),
  validate({ params: idParam }),
  controller.withdraw
);

router.patch(
  "/placement/applications/:id",
  authenticate,
  csrfProtection,
  requirePermission(P.PLACEMENT_MANAGE),
  validate({ params: idParam, body: applicationStatusSchema }),
  controller.decideApplication
);

module.exports = router;
