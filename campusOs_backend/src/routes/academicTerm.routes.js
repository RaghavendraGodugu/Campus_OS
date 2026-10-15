const express = require("express");

const { authenticate, requirePermission } = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { validate } = require("../middleware/validate");
const { P } = require("../utils/permissions");
const controller = require("../controllers/academicTerm.controller");
const {
  createAcademicTermSchema,
  updateAcademicTermSchema,
  academicTermIdSchema,
} = require("../validators/academicTerm.validator");

const router = express.Router();

/**
 * Academic terms.
 *
 * Reading is open to every signed-in role, because forms and reports both need
 * to know which term they belong to. Writing is institution-wide, because a term
 * is an institution-level fact — one department opening its own term would
 * leave the college with two.
 */

router.get("/academic-terms/current", authenticate, controller.current);
router.get("/academic-terms", authenticate, controller.list);

router.post(
  "/academic-terms",
  authenticate,
  csrfProtection,
  requirePermission(P.ACADEMIC_TERM_MANAGE),
  validate({ body: createAcademicTermSchema }),
  controller.create,
);

/**
 * Declared after the literal routes above, so `current` is never captured as an
 * id and rejected as a malformed one.
 */
router.get("/academic-terms/:id", authenticate, validate({ params: academicTermIdSchema }), controller.getOne);

router.patch(
  "/academic-terms/:id",
  authenticate,
  csrfProtection,
  requirePermission(P.ACADEMIC_TERM_MANAGE),
  validate({ params: academicTermIdSchema, body: updateAcademicTermSchema }),
  controller.update,
);

router.post(
  "/academic-terms/:id/open",
  authenticate,
  csrfProtection,
  requirePermission(P.ACADEMIC_TERM_MANAGE),
  validate({ params: academicTermIdSchema }),
  controller.open,
);

router.post(
  "/academic-terms/:id/close",
  authenticate,
  csrfProtection,
  requirePermission(P.ACADEMIC_TERM_MANAGE),
  validate({ params: academicTermIdSchema }),
  controller.close,
);

router.delete(
  "/academic-terms/:id",
  authenticate,
  csrfProtection,
  requirePermission(P.ACADEMIC_TERM_MANAGE),
  validate({ params: academicTermIdSchema }),
  controller.remove,
);

module.exports = router;
