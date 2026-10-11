/**
 * Zod request validation.
 *
 * ## Why parsed values go to `req.validated`
 *
 * Express 5 made `req.query` a **read-only getter**. Assigning
 * `req.query = parsed` throws in strict mode, and mutating its properties
 * (e.g. deleting a key) no longer affects what handlers read. Writing parsed
 * data back is therefore not an option.
 *
 * `req.validated = { body, query, params }` is the single place a handler
 * looks for validated input. Handlers read `req.validated.body.email`, never
 * `req.body.email`.
 *
 * ## Why `.strict()`
 *
 * Every schema uses `.strict()`, so an unexpected key is a 400 rather than
 * being silently dropped. This is what stops a client from sending
 * `{ email, role: "SUPER_ADMIN" }` and having a handler quietly ignore it —
 * or worse, pass the raw object to a model.
 *
 * ## Unknown-key errors do not echo values
 *
 * Zod's default path/message for an unrecognised key names the key only.
 * Values are never included, because a rejected payload may contain a password.
 */

const { ApiError } = require("../utils/ApiError");

/**
 * Build the validation middleware.
 *
 * @param {object} schemas
 * @param {import('zod').ZodTypeAny} [schemas.body]
 * @param {import('zod').ZodTypeAny} [schemas.query]
 * @param {import('zod').ZodTypeAny} [schemas.params]
 * @returns {import('express').RequestHandler}
 */
function validate(schemas = {}) {
  const { body, query, params } = schemas;

  return function validationMiddleware(req, res, next) {
    req.validated = req.validated || {};

    try {
      if (params) {
        req.validated.params = params.parse(req.params);
      }
      if (query) {
        // Express 5 parses `req.query` with the "simple" parser, producing
        // plain values. Zod coerces and constrains them here.
        req.validated.query = query.parse(req.query);
      }
      if (body) {
        // Express 5 leaves `req.body` undefined when no parser matched the
        // content type, so normalise to an object for a clean validation error
        // instead of a TypeError.
        req.validated.body = body.parse(req.body ?? {});
      }
    } catch (error) {
      if (error instanceof ApiError) {
        return next(error);
      }
      // ZodError is translated by the central error handler, which formats the
      // issues as { field, message, code }.
      return next(error);
    }

    return next();
  };
}

module.exports = { validate };
