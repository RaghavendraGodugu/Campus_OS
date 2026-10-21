const express = require("express");

const {
  authenticate,
  requirePermission,
  requireAnyPermission,
} = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { validate } = require("../middleware/validate");
const { P } = require("../utils/permissions");

const subjectController = require("../controllers/subject.controller");
const roomController = require("../controllers/room.controller");
const timetableController = require("../controllers/timetable.controller");

const {
  idParam,
  createSubjectSchema,
  updateSubjectSchema,
  listSubjectsQuerySchema,
  createRoomSchema,
  updateRoomSchema,
  listRoomsQuerySchema,
  createTimetableEntrySchema,
  updateTimetableEntrySchema,
  timetableQuerySchema,
} = require("../validators/academic.validator");

const router = express.Router();

/**
 * Academic structure and timetable.
 *
 * Three resources, one router because they are one feature: a subject is only
 * meaningful once it has a schedule, and a schedule is only possible once rooms
 * and subjects exist.
 *
 * Reading is gated by a read permission; writing is gated by **any** of the
 * institution or department manage permissions. Which one applied — and whether
 * the department matched — is decided in the service, because only the service
 * can see the record being changed.
 */

// ===== Subjects =====

router.get(
  "/subjects",
  authenticate,
  requirePermission(P.SUBJECT_READ),
  validate({ query: listSubjectsQuerySchema }),
  subjectController.list
);

router.get(
  "/subjects/:id",
  authenticate,
  requirePermission(P.SUBJECT_READ),
  validate({ params: idParam }),
  subjectController.getOne
);

router.post(
  "/subjects",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.SUBJECT_MANAGE, P.SUBJECT_MANAGE_DEPARTMENT),
  validate({ body: createSubjectSchema }),
  subjectController.create
);

router.patch(
  "/subjects/:id",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.SUBJECT_MANAGE, P.SUBJECT_MANAGE_DEPARTMENT),
  validate({ params: idParam, body: updateSubjectSchema }),
  subjectController.update
);

router.delete(
  "/subjects/:id",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.SUBJECT_MANAGE, P.SUBJECT_MANAGE_DEPARTMENT),
  validate({ params: idParam }),
  subjectController.retire
);

// ===== Rooms =====

router.get(
  "/rooms",
  authenticate,
  requirePermission(P.ROOM_READ),
  validate({ query: listRoomsQuerySchema }),
  roomController.list
);

router.get(
  "/rooms/:id",
  authenticate,
  requirePermission(P.ROOM_READ),
  validate({ params: idParam }),
  roomController.getOne
);

router.post(
  "/rooms",
  authenticate,
  csrfProtection,
  requirePermission(P.ROOM_MANAGE),
  validate({ body: createRoomSchema }),
  roomController.create
);

router.patch(
  "/rooms/:id",
  authenticate,
  csrfProtection,
  requirePermission(P.ROOM_MANAGE),
  validate({ params: idParam, body: updateRoomSchema }),
  roomController.update
);

router.delete(
  "/rooms/:id",
  authenticate,
  csrfProtection,
  requirePermission(P.ROOM_MANAGE),
  validate({ params: idParam }),
  roomController.retire
);

// ===== Timetable =====

/**
 * `/timetable/staff` is declared before `/timetable/:id`, so "staff" is never
 * captured as an id and rejected as a malformed one.
 */
router.get(
  "/timetable/staff",
  authenticate,
  requireAnyPermission(P.TIMETABLE_MANAGE, P.TIMETABLE_MANAGE_DEPARTMENT),
  timetableController.staff
);

router.get(
  "/timetable",
  authenticate,
  requireAnyPermission(
    P.TIMETABLE_READ_OWN,
    P.TIMETABLE_READ_DEPARTMENT,
    P.TIMETABLE_READ_INSTITUTION
  ),
  validate({ query: timetableQuerySchema }),
  timetableController.list
);

router.get(
  "/timetable/:id",
  authenticate,
  requireAnyPermission(
    P.TIMETABLE_READ_OWN,
    P.TIMETABLE_READ_DEPARTMENT,
    P.TIMETABLE_READ_INSTITUTION
  ),
  validate({ params: idParam }),
  timetableController.getOne
);

router.post(
  "/timetable",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.TIMETABLE_MANAGE, P.TIMETABLE_MANAGE_DEPARTMENT),
  validate({ body: createTimetableEntrySchema }),
  timetableController.create
);

router.patch(
  "/timetable/:id",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.TIMETABLE_MANAGE, P.TIMETABLE_MANAGE_DEPARTMENT),
  validate({ params: idParam, body: updateTimetableEntrySchema }),
  timetableController.update
);

router.delete(
  "/timetable/:id",
  authenticate,
  csrfProtection,
  requireAnyPermission(P.TIMETABLE_MANAGE, P.TIMETABLE_MANAGE_DEPARTMENT),
  validate({ params: idParam }),
  timetableController.remove
);

module.exports = router;
