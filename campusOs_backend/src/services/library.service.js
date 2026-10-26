/**
 * Library: the catalogue, issues and returns.
 *
 * ## The last copy
 *
 * Availability is `copiesIssued < copiesTotal`, claimed with one atomic
 * `findOneAndUpdate` that increments only when a copy is free. Reading the
 * count and then incrementing would let two simultaneous issues take the same
 * last copy. The unique partial index on `{ book, student, ISSUED }` separately
 * stops one student borrowing the same title twice.
 */
const Book = require("../models/Book");
const BookIssue = require("../models/BookIssue");
const Student = require("../models/Student");
const { AUDIT_ACTION, BOOK_ISSUE_STATUS } = require("../config/constants");
const { ApiError } = require("../utils/ApiError");
const { P, userHasPermission } = require("../utils/permissions");
const auditService = require("./audit.service");
const studentDirectory = require("./studentDirectory.service");

function assertManage(user) {
  if (!userHasPermission(user, P.LIBRARY_MANAGE)) {
    throw ApiError.forbidden(
      "You do not have permission to manage the library catalogue"
    );
  }
}

function assertIssue(user) {
  if (!userHasPermission(user, P.LIBRARY_ISSUE)) {
    throw ApiError.forbidden("You do not have permission to issue or return books");
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function studentFor(user) {
  const student = await Student.findOne({ user: user._id }).select("rollNumber semester");
  return student; // null if no student record linked
}

async function listBooks({ q, category } = {}) {
  const filter = { isActive: true };
  if (category) filter.category = category;
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ title: pattern }, { author: pattern }, { isbn: pattern }];
  }
  return Book.find(filter).sort({ title: 1 }).limit(200).lean();
}

async function createBook({ user, payload, req }) {
  assertManage(user);
  const book = await Book.create(payload);
  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.CREATE,
    entity: "Book",
    entityId: book._id,
    entityRef: book.title,
    metadata: { copiesTotal: book.copiesTotal },
    req,
  });
  return book.toJSON();
}

async function issueBook({ user, payload, req }) {
  assertIssue(user);
  const student = await Student.findById(payload.student);
  if (!student) throw ApiError.notFound("Student not found");

  const book = await Book.findOneAndUpdate(
    {
      _id: payload.book,
      isActive: true,
      $expr: { $lt: ["$copiesIssued", "$copiesTotal"] },
    },
    { $inc: { copiesIssued: 1 } },
    { new: true }
  );

  if (!book) {
    throw ApiError.conflict("No copy of that book is available");
  }

  try {
    const issue = await BookIssue.create({
      book: book._id,
      student: student._id,
      issuedBy: user._id,
      dueAt: payload.dueAt,
    });

    await auditService.record({
      actor: user,
      action: AUDIT_ACTION.BOOK_ISSUED,
      entity: "BookIssue",
      entityId: issue._id,
      entityRef: `${student.rollNumber} · ${book.title}`,
      metadata: { book: String(book._id) },
      req,
    });
    return issue.toJSON();
  } catch (error) {
    await Book.updateOne({ _id: book._id }, { $inc: { copiesIssued: -1 } });
    if (error?.code === 11000) {
      throw ApiError.conflict("That student already has this book out");
    }
    throw error;
  }
}

async function returnBook({ user, id, req }) {
  assertIssue(user);
  const issue = await BookIssue.findById(id);
  if (!issue) throw ApiError.notFound("Issue not found");
  if (issue.status === BOOK_ISSUE_STATUS.RETURNED) {
    return issue.toJSON();
  }

  issue.status = BOOK_ISSUE_STATUS.RETURNED;
  issue.returnedAt = new Date();
  issue.returnedBy = user._id;
  await issue.save();

  await Book.updateOne(
    { _id: issue.book, copiesIssued: { $gt: 0 } },
    { $inc: { copiesIssued: -1 } }
  );

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.BOOK_RETURNED,
    entity: "BookIssue",
    entityId: issue._id,
    metadata: { book: String(issue.book) },
    req,
  });
  return issue.toJSON();
}

async function listIssues({ status } = {}) {
  const filter = {};
  if (status) filter.status = status;
  return BookIssue.find(filter)
    .populate("book", "title author")
    .populate({
      path: "student",
      select: "rollNumber",
      populate: { path: "user", select: "fullName" },
    })
    .sort({ issuedAt: -1 })
    .limit(200)
    .lean();
}

async function mine({ user }) {
  const student = await studentFor(user);
  return BookIssue.find({ student: student._id })
    .populate("book", "title author category")
    .sort({ issuedAt: -1 })
    .lean();
}

async function searchStudents({ q }) {
  return studentDirectory.search({ q });
}

module.exports = {
  searchStudents,
  listBooks,
  createBook,
  issueBook,
  returnBook,
  listIssues,
  mine,
};
