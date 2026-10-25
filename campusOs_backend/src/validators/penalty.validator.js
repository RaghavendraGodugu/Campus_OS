const { z } = require("zod");

/**
 * Penalty sweep takes no parameters — the run is deterministic based on
 * invoice due dates and the current time. A dry-run preview is a separate
 * endpoint.
 */

const emptyBody = z.object({}).strict();

module.exports = {
  emptyBody,
};
