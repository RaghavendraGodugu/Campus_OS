const { z } = require("zod");
const mongoose = require("mongoose");
const { BOOK_ISSUE_STATUS } = require("../config/constants");

const objectId = z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), {
  message: "That is not a valid id",
});
const idParam = z.object({ id: objectId }).strict();

const createBookSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    author: z.string().trim().min(1).max(160),
    isbn: z.string().trim().max(24).optional(),
    category: z.string().trim().max(60).optional(),
    copiesTotal: z.coerce.number().int().min(1).max(1000),
  })
  .strict();

const listBooksQuerySchema = z
  .object({
    q: z.string().trim().max(80).optional(),
    category: z.string().trim().max(60).optional(),
  })
  .strict();

const issueSchema = z
  .object({
    book: objectId,
    student: objectId,
    dueAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .transform((v) => new Date(`${v}T23:59:59.000Z`)),
  })
  .strict();

const issueQuerySchema = z
  .object({
    status: z.enum(Object.values(BOOK_ISSUE_STATUS)).optional(),
  })
  .strict();

module.exports = {
  idParam,
  createBookSchema,
  listBooksQuerySchema,
  issueSchema,
  issueQuerySchema,
};
