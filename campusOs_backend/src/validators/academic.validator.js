const { z } = require("zod");
const mongoose = require("mongoose");

const { SUBJECT_KIND_VALUES, ROOM_KIND_VALUES } = require("../config/constants");

const objectId = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "That is not a valid id",
});

const idParam = z.object({ id: objectId }).strict();

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD form")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "That is not a real date")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

/**
 * Academic structure and timetable schemas.
 *
 * Every schema is `.strict()`: an unknown key is a 400 rather than being
 * silently dropped. That is what stops a client from setting `isActive` on a
 * create, or smuggling a department onto a subject it does not own.
 *
 * Times arrive as **minutes from midnight**, not "09:00". The frontend formats
 * them; the API stores and compares integers, because the clash check is
 * interval arithmetic and formatted strings cannot be subtracted reliably.
 */

// ===== Subjects =====

const subjectShape = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "A subject code needs at least 2 characters")
    .max(20, "A subject code cannot exceed 20 characters")
    .regex(/^[A-Z0-9-]+$/, "A code may contain only letters, numbers and hyphens"),
  name: z.string().trim().min(2, "A subject name needs at least 2 characters").max(160),
  department: objectId,
  program: objectId,
  semester: z.coerce
    .number()
    .int("Semester must be a whole number")
    .min(1, "Semester must be at least 1")
    .max(12, "Semester cannot exceed 12"),
  credits: z.coerce
    .number()
    .min(0, "Credits cannot be negative")
    .max(20, "Credits cannot exceed 20")
    .optional(),
  kind: z.enum(SUBJECT_KIND_VALUES).optional(),
};

const createSubjectSchema = z.object(subjectShape).strict();

const updateSubjectSchema = z
  .object({
    code: subjectShape.code.optional(),
    name: subjectShape.name.optional(),
    department: objectId.optional(),
    program: objectId.optional(),
    semester: subjectShape.semester.optional(),
    credits: subjectShape.credits,
    kind: subjectShape.kind,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Supply at least one field to change",
  });

const listSubjectsQuerySchema = z
  .object({
    program: objectId.optional(),
    department: objectId.optional(),
    semester: z.coerce.number().int().min(1).max(12).optional(),
    q: z.string().trim().max(80).optional(),
    active: z.enum(["true", "false"]).optional(),
  })
  .strict();

// ===== Rooms =====

const roomShape = {
  block: z.string().trim().max(80).optional(),
  name: z.string().trim().min(1, "A room needs a name").max(60),
  capacity: z.coerce
    .number()
    .int("Capacity must be a whole number")
    .min(1, "A room must hold at least one person")
    .max(2000)
    .optional(),
  kind: z.enum(ROOM_KIND_VALUES).optional(),
};

const createRoomSchema = z.object(roomShape).strict();

const updateRoomSchema = z
  .object({
    block: roomShape.block,
    name: roomShape.name.optional(),
    capacity: roomShape.capacity,
    kind: roomShape.kind,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Supply at least one field to change",
  });

const listRoomsQuerySchema = z
  .object({
    q: z.string().trim().max(80).optional(),
    kind: z.enum(ROOM_KIND_VALUES).optional(),
    active: z.enum(["true", "false"]).optional(),
  })
  .strict();

// ===== Timetable =====

const timeShape = {
  term: objectId,
  subject: objectId,
  faculty: objectId,
  room: objectId,
  dayOfWeek: z.coerce
    .number()
    .int("Weekday must be a whole number")
    .min(1, "Weekday must be 1 (Monday) to 7 (Sunday)")
    .max(7, "Weekday must be 1 (Monday) to 7 (Sunday)")
    .optional(),
  startsOn: calendarDate.optional(),
  repeatsWeekly: z.boolean().optional(),
  startMinute: z.coerce
    .number()
    .int("Start time must be a whole minute")
    .min(0, "Start time cannot be before midnight")
    .max(1439, "Start time must be before midnight"),
  endMinute: z.coerce
    .number()
    .int("End time must be a whole minute")
    .min(1, "End time must be after midnight")
    .max(1440, "End time cannot pass midnight"),
};

const createTimetableEntrySchema = z
  .object(timeShape)
  .strict()
  .superRefine((value, ctx) => {
    if (value.endMinute <= value.startMinute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endMinute"],
        message: "A class must end after it starts",
      });
    }
    if (!value.dayOfWeek && !value.startsOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startsOn"],
        message: "Choose a class date",
      });
    }
    if (value.repeatsWeekly === false && !value.startsOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startsOn"],
        message: "A one-off class needs a date",
      });
    }
  });

const updateTimetableEntrySchema = z
  .object({
    term: timeShape.term.optional(),
    subject: timeShape.subject.optional(),
    faculty: timeShape.faculty.optional(),
    room: timeShape.room.optional(),
    dayOfWeek: timeShape.dayOfWeek.optional(),
    startsOn: timeShape.startsOn,
    repeatsWeekly: timeShape.repeatsWeekly,
    startMinute: timeShape.startMinute.optional(),
    endMinute: timeShape.endMinute.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Supply at least one field to change",
  })
  .refine(
    (value) =>
      value.startMinute === undefined ||
      value.endMinute === undefined ||
      value.endMinute > value.startMinute,
    { message: "A class must end after it starts", path: ["endMinute"] }
  );

/**
 * The timetable query.
 *
 * `term` is optional so the client can ask for "the current term" without first
 * fetching it — the service resolves that. The other filters exist for the
 * management view; the student and faculty views are scoped by the caller's
 * identity and ignore them.
 */
const timetableQuerySchema = z
  .object({
    term: objectId.optional(),
    dayOfWeek: z.coerce.number().int().min(1).max(7).optional(),
    program: objectId.optional(),
    semester: z.coerce.number().int().min(1).max(12).optional(),
    faculty: objectId.optional(),
    room: objectId.optional(),
  })
  .strict();

module.exports = {
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
};
