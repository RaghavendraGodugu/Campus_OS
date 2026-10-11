/**
 * Authentication routes.
 *
 * Implemented in slice 3. This placeholder exists so the route table resolves
 * and slice 1 can be verified in isolation; it will be replaced by the real
 * router.
 */

const express = require("express");

const router = express.Router();

router.use((req, res) => {
  res.status(501).json({
    success: false,
    message: "Authentication routes are not implemented yet",
    code: "NOT_IMPLEMENTED",
  });
});

module.exports = router;
