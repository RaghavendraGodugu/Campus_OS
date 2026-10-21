const { z } = require("zod");
const mongoose = require("mongoose");

const { ATTENDANCE_STATUS_VALUES } = require("../config/constants");

const objectId = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "That is not a valid id",
});

/**
 * A calendar date, with no time and no timezone ambiguity.
 *
 * The class meets on a date, not at an instant: "12 October" is the same day
 * whether the server is in IST or UTC. Parsing `YYYY-MM-DD` into a `Date`
 * produces UTC midnight, and every comparison and unique key uses that same
 * value. A timestamp with an offset is rejected rather than silently shifted —
 * which is how a Monday class ends up recorded on Sunday for half the year.
 */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD form")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "That is not a real date")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const attendanceRecord = z
  .object({
    student: objectId,
    status: z.enum(ATTENDANCE_STATUS_VALUES),
  })
  .strict();

const records = z
  .array(attendanceRecord)
  .min(1, "Mark at least one student")
  .max(500, "That is more students than one class can hold");

const markAttendanceSchema = z
  .object({
    entry: objectId,
    date: calendarDate,
    records,
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set(value.records.map((record) => record.student));
    if (ids.size !== value.records.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["records"],
        message: "A student may appear only once",
      });
    }
  });

const correctAttendanceSchema = z
  .object({
    records,
    reason: z
      .string()
      .trim()
      .min(5, "Give a reason of at least 5 characters")
      .max(500, "Keep the reason under 500 characters"),
  })
  .strict();

const attendanceQuerySchema = z
  .object({
    term: objectId.optional(),
  })
  .strict();

const dateQuerySchema = z
  .object({
    date: calendarDate,
  })
  .strict();

const idParam = z.object({ id: objectId }).strict();
const subjectParam = z.object({ subjectId: objectId }).strict();

module.exports = {
  markAttendanceSchema,
  correctAttendanceSchema,
  attendanceQuerySchema,
  dateQuerySchema,
  idParam,
  subjectParam,
};
