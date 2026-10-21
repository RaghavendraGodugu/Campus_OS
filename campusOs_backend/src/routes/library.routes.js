const express = require("express");
const {
  authenticate,
  requirePermission,
  requireAnyPermission,
} = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { validate } = require("../middleware/validate");
const { P } = require("../utils/permissions");
const controller = require("../controllers/library.controller");
const {
  idParam,
  createBookSchema,
  listBooksQuerySchema,
  issueSchema,
  issueQuerySchema,
} = require("../validators/library.validator");

const router = express.Router();

router.get(
  "/library/books",
  authenticate,
  requireAnyPermission(P.LIBRARY_READ_OWN, P.LIBRARY_READ_INSTITUTION),
  validate({ query: listBooksQuerySchema }),
  controller.listBooks
);
router.post(
  "/library/books",
  authenticate,
  csrfProtection,
  requirePermission(P.LIBRARY_MANAGE),
  validate({ body: createBookSchema }),
  controller.createBook
);

router.get(
  "/library/issues",
  authenticate,
  requirePermission(P.LIBRARY_READ_INSTITUTION),
  validate({ query: issueQuerySchema }),
  controller.listIssues
);
router.post(
  "/library/issues",
  authenticate,
  csrfProtection,
  requirePermission(P.LIBRARY_ISSUE),
  validate({ body: issueSchema }),
  controller.issueBook
);
router.post(
  "/library/issues/:id/return",
  authenticate,
  csrfProtection,
  requirePermission(P.LIBRARY_ISSUE),
  validate({ params: idParam }),
  controller.returnBook
);

router.get(
  "/library/me",
  authenticate,
  requirePermission(P.LIBRARY_READ_OWN),
  controller.mine
);

module.exports = router;
