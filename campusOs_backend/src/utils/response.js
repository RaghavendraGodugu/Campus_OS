/**
 * Response envelope helpers.
 *
 * Every successful response in CampusOS uses the same shape (spec §7):
 *
 *   { success: true, message: "...", data: {}, meta: {} }
 *
 * Controllers call these rather than `res.json(...)` directly so the contract
 * cannot drift between endpoints. `res.locals` is populated once per request
 * by the request-context middleware; these helpers depend on it.
 */

/**
 * Pagination metadata. Computed in one place so `page`/`limit` semantics and
 * the `totalPages`/`hasNext` fields are identical across every list endpoint.
 *
 * @param {number} total   Total matching documents (not just the page).
 * @param {number} page    1-based current page.
 * @param {number} limit   Page size.
 */
function buildPaginationMeta(total, page, limit) {
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));

  return {
    page,
    limit: safeLimit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Send a success response.
 *
 * @param {import('express').Response} res
 * @param {object} options
 * @param {string} options.message Human-readable summary.
 * @param {*} [options.data]        Payload, or null for a bodyless response.
 * @param {object} [options.meta]   Pagination or extra metadata.
 * @param {number} [options.status] Defaults to 200.
 */
function sendSuccess(res, { message, data = null, meta, status = 200 }) {
  const body = { success: true, message };
  if (data !== null && data !== undefined) {
    body.data = data;
  }
  if (meta && Object.keys(meta).length) {
    body.meta = meta;
  }
  return res.status(status).json(body);
}

const sendCreated = (res, options) =>
  sendSuccess(res, { ...options, status: options.status ?? 201 });

const sendOk = (res, message, data) => sendSuccess(res, { message, data });

const sendNoContent = (res) => res.status(204).end();

/**
 * Send a paginated list response, normalising the Mongoose result shape.
 *
 * @param {import('express').Response} res
 * @param {object[]} items        Documents from the query (already projected).
 * @param {number}   total        Total matching count.
 * @param {number}   page         1-based page.
 * @param {number}   limit        Page size.
 * @param {string}   message
 * @param {object}   [extraMeta]  Additional metadata merged alongside pagination.
 */
function sendPaginated(res, { items, total, page, limit, message, ...extraMeta }) {
  return sendSuccess(res, {
    message,
    data: items,
    meta: { ...buildPaginationMeta(total, page, limit), ...extraMeta },
  });
}

module.exports = {
  sendSuccess,
  sendCreated,
  sendOk,
  sendNoContent,
  sendPaginated,
  buildPaginationMeta,
};
