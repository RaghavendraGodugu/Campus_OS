/**
 * Sequence counter.
 *
 * Generates concurrency-safe human-readable reference numbers
 * (e.g. `REQ-2026-000123`).
 *
 * Why not `count()` then `insert()`: two simultaneous submissions would read
 * the same count and produce colliding references. `$inc` inside
 * `findOneAndUpdate` is a single atomic document operation, so concurrent
 * callers always receive distinct values with no coordination. This works on a
 * standalone `mongod` as well as on a replica set — which matters because
 * CampusOS deliberately avoids transactions (see config/db.js).
 *
 * Key design: the document `_id` is a composite string, `<namespace>:<year>`.
 * MongoDB guarantees `_id` uniqueness on its own, so no secondary index is
 * needed and there is no index to fall out of sync with the documents.
 */

const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema(
  {
    /**
     * Composite key: `${namespace}:${year}`, e.g. "request:2026".
     * Each year starts its own sequence, so references stay short and readable.
     */
    _id: {
      type: String,
      required: true,
    },

    /** Last value handed out. Starts at 0; the first $inc yields 1. */
    seq: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/**
 * Build the composite counter key.
 * @param {string} namespace e.g. "request"
 * @param {number|string} year
 */
const counterKey = (namespace, year) => `${namespace}:${year}`;

/** Zero-padding width for rendered references. */
const DEFAULT_PADDING = 6;

/**
 * Render a human-readable reference from a sequence value.
 * @param {string} prefix  e.g. "REQ"
 * @param {number} year
 * @param {number} seq
 * @param {number} [padding]
 * @returns {string} e.g. "REQ-2026-000123"
 */
function formatReference(prefix, year, seq, padding = DEFAULT_PADDING) {
  return `${prefix}-${year}-${String(seq).padStart(padding, "0")}`;
}

const Counter = mongoose.model("Counter", counterSchema);

module.exports = Counter;
module.exports.counterKey = counterKey;
module.exports.formatReference = formatReference;
module.exports.DEFAULT_PADDING = DEFAULT_PADDING;