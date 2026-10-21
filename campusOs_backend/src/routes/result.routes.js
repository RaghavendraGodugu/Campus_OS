const express = require("express");

const {
  authenticate,
  requirePermission,
  requireAnyPermission,
} = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { validate } = require("../middleware/validate");
const { P } = require("../utils/permissions");

const controller = require("../controllers/result.controller");
const {
  idParam,
  subjectParam,
  termQuery,
  subjectQuery,
  createAssessmentSchema,
  saveMarksSchema,
  publishSchema,
} = require("../validators/result.validator");

const router = express.Router();

/**
 * Marks and results.
 *
 * Reading is gated on a result read permission and narrowed per subject in the
 * service. Entering marks and managing components are separate grants. Release
 * has its own permission because it is the act that makes a result visible to a
 * student — and it is checked per programme, not just per role.
 */

const READ_ANY = [P.RESULT_READ_OWN, P.RESULT_READ_DEPARTMENT, P.RESULT_READ_INSTITUTION];

const MANAGE_ANY = [
  P.RESULT_ENTER_OWN,
  P.RESULT_MANAGE_DEPARTMENT,
  P.RESULT_MANAGE_INSTITUTION,
];

router.get(
  "/results/me",
  authenticate,
  requirePermission(P.RESULT_READ_OWN),
  validate({ query: termQuery }),
  controller.mine
);

router.get(
  "/results/releases",
  authenticate,
  requireAnyPermission(P.RESULT_READ_DEPARTMENT, P.RESULT_READ_INSTITUTION),
  validate({ query: termQuery }),
  controller.releases
);

router.get(
  "/results/assessments",
  authenticate,
  requireAnyPermission(...READ_ANY),
  validate({ query: subjectQuery }),
  controller.listAssessments
);

router.post(
  "/results/assessments",
  authenticate,
  csrfProtection,
  requireAnyPermission(...MANAGE_ANY),
  validate({ body: createAssessmentSchema }),
  controller.createAssessment
);

router.delete(
  "/results/assessments/:id",
  authenticate,
  csrfProtection,
  requireAnyPermission(...MANAGE_ANY),
  validate({ params: idParam }),
  controller.removeAssessment
);

router.get(
  "/results/subjects/:subjectId",
  authenticate,
  requireAnyPermission(...READ_ANY),
  validate({ params: subjectParam, query: termQuery }),
  controller.marksGrid
);

router.post(
  "/results/marks",
  authenticate,
  csrfProtection,
  requireAnyPermission(...MANAGE_ANY),
  validate({ body: saveMarksSchema }),
  controller.saveMarks
);

router.post(
  "/results/publish",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.RESULT_PUBLISH_DEPARTMENT, P.RESULT_PUBLISH_INSTITUTION),
  validate({ body: publishSchema }),
  controller.publish
);

module.exports = router;
