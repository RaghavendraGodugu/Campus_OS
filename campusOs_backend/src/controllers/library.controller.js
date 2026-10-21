const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated } = require("../utils/response");
const service = require("../services/library.service");

const listBooks = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Books listed",
    data: { books: await service.listBooks(req.validated?.query ?? {}) },
  })
);

const createBook = asyncHandler(async (req, res) =>
  sendCreated(res, {
    message: "Book added",
    data: {
      book: await service.createBook({
        user: req.user,
        payload: req.validated.body,
        req,
      }),
    },
  })
);

const issueBook = asyncHandler(async (req, res) =>
  sendCreated(res, {
    message: "Book issued",
    data: {
      issue: await service.issueBook({
        user: req.user,
        payload: req.validated.body,
        req,
      }),
    },
  })
);

const returnBook = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Book returned",
    data: { issue: await service.returnBook({ user: req.user, id: req.params.id, req }) },
  })
);

const listIssues = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Issues listed",
    data: { issues: await service.listIssues(req.validated?.query ?? {}) },
  })
);

const mine = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Your library record",
    data: { issues: await service.mine({ user: req.user }) },
  })
);

const searchStudents = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: "Students found",
    data: { students: await service.searchStudents({ q: req.query.q }) },
  })
);

module.exports = {
  searchStudents,
  listBooks,
  createBook,
  issueBook,
  returnBook,
  listIssues,
  mine,
};
