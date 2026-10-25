const express = require("express");

const controller = require("../controllers/penalty.controller");
const { validate } = require("../middleware/validate");
const { authenticate, requirePermission } = require("../middleware/auth");
const { csrfProtection } = require("../middleware/csrf");
const { P } = require("../utils/permissions");
const { emptyBody } = require("../validators/penalty.validator");

const router = express.Router();

/**
 * Penalty sweep — applies late-payment charges to overdue invoices.
 *
 * The sweep is idempotent: `chargePenalty` computes the delta from
 * `penalty.chargedAmount`, and the write filter matches the old
 * `chargedAmount`, so concurrent or retried runs only apply the difference.
 *
 * Writing requires FINANCE_ADMIN (institution-wide penalty authority).
 */

/** POST /api/v1/penalties/run — execute the sweep. */
router.post(
  "/penalties/run",
  authenticate,
  csrfProtection,
  requirePermission(P.FINANCE_ADMIN),
  validate({ body: emptyBody }),
  controller.run
);

/** POST /api/v1/penalties/preview — dry-run preview. */
router.post(
  "/penalties/preview",
  authenticate,
  csrfProtection,
  requirePermission(P.FINANCE_ADMIN),
  validate({ body: emptyBody }),
  controller.preview
);

module.exports = router;
