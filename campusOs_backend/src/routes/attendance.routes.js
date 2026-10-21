const express = require("express");

const {
  authenticate,
  requirePermission,
  requireAnyPermission,
} = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { validate } = require("../middleware/validate");
const { P } = require("../utils/permissions");

const controller = require("../controllers/attendance.controller");
const {
  markAttendanceSchema,
  correctAttendanceSchema,
  attendanceQuerySchema,
  dateQuerySchema,
  idParam,
  subjectParam,
} = require("../validators/attendance.validator");

const router = express.Router();

/**
 * Attendance.
 *
 * Reading is gated by a read permission and narrowed to the caller in the
 * service (own / department / institution). Marking is gated on
 * `attendance:mark:own`, which is deliberately not enough on its own: the
 * service also requires that the caller teaches *this* entry, or administers
 * its department. Correcting is a separate grant because changing a register is
 * a different act from writing one.
 */

router.get(
  "/attendance/me",
  authenticate,
  requirePermission(P.ATTENDANCE_READ_OWN),
  validate({ query: attendanceQuerySchema }),
  controller.mine
);

router.get(
  "/attendance/day",
  authenticate,
  requireAnyPermission(P.ATTENDANCE_MARK_OWN),
  validate({ query: dateQuerySchema }),
  controller.day
);

router.get(
  "/attendance/overview",
  authenticate,
  requireAnyPermission(P.ATTENDANCE_READ_DEPARTMENT, P.ATTENDANCE_READ_INSTITUTION),
  validate({ query: attendanceQuerySchema }),
  controller.overview
);

router.get(
  "/attendance/subjects/:subjectId",
  authenticate,
  requireAnyPermission(
    P.ATTENDANCE_READ_OWN,
    P.ATTENDANCE_READ_DEPARTMENT,
    P.ATTENDANCE_READ_INSTITUTION
  ),
  validate({ params: subjectParam, query: attendanceQuerySchema }),
  controller.subjectSummary
);

/**
 * Declared after the literal attendance routes, so `entry` is never captured as
 * a session id.
 */
router.get(
  "/attendance/entry/:id",
  authenticate,
  requireAnyPermission(
    P.ATTENDANCE_MARK_OWN,
    P.ATTENDANCE_CORRECT_DEPARTMENT,
    P.ATTENDANCE_CORRECT_INSTITUTION
  ),
  validate({ params: idParam, query: dateQuerySchema }),
  controller.entryContext
);

router.post(
  "/attendance/sessions",
  authenticate,
  csrfProtection,
  requirePermission(P.ATTENDANCE_MARK_OWN),
  validate({ body: markAttendanceSchema }),
  controller.mark
);

router.patch(
  "/attendance/sessions/:id",
  authenticate,
  csrfProtection,
  requireAnyPermission(
    P.ATTENDANCE_MARK_OWN,
    P.ATTENDANCE_CORRECT_DEPARTMENT,
    P.ATTENDANCE_CORRECT_INSTITUTION
  ),
  validate({ params: idParam, body: correctAttendanceSchema }),
  controller.correct
);

module.exports = router;
