const { asyncHandler } = require("../utils/asyncHandler");

const { sendSuccess } = require("../utils/response");
const { runPenaltySweep } = require("../jobs/penalty.job");

/**
 * POST /api/v1/penalties/run — callable by external cron.
 *
 * Runs the penalty sweep once and returns what it did.
 */
const run = asyncHandler(async (req, res) => {
  const result = await runPenaltySweep({ req });
  return sendSuccess(res, {
    message: "Penalty sweep completed",
    data: result,
  });
});

/**
 * POST /api/v1/penalties/preview — dry-run to see what would happen.
 */
const preview = asyncHandler(async (req, res) => {
  const result = await runPenaltySweep({ dryRun: true, req });
  return sendSuccess(res, {
    message: "Penalty sweep preview (no changes made)",
    data: result,
  });
});

module.exports.run = run;
module.exports.preview = preview;
