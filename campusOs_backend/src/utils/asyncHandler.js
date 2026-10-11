/**
 * Explicit async route wrapper.
 *
 * Express 5 forwards rejected promises from handlers to the error middleware
 * automatically, so this wrapper is not strictly required. It is kept because
 * it makes the control flow visible at every route definition, and because it
 * guarantees correct behaviour regardless of the Express minor version — a
 * silently-swallowed rejected promise is exactly the class of bug this project
 * must not have.
 */

/**
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<*>} handler
 * @returns {import('express').RequestHandler}
 */
function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
