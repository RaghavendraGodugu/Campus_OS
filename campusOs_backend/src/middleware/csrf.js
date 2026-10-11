/**
 * CSRF protection (double-submit with an identity-bound token).
 *
 * ## The attack this prevents
 *
 * Session cookies are sent by the browser to *every* request to our origin,
 * including one triggered by a page on another site. A malicious page could
 * therefore cause a signed-in officer's browser to submit an approval request,
 * or a student's browser to pay an invoice, without the user's knowledge.
 *
 * SameSite cookies reduce this, but CampusOS sets `SameSite=None` in
 * production (Vercel frontend, Render API are different sites), so cookies are
 * sent cross-site by design and an explicit defence is mandatory.
 *
 * ## The defence
 *
 *  1. The server sets a CSRF cookie that JavaScript **can** read.
 *  2. The frontend echoes it in the `X-CSRF-Token` header.
 *  3. The server recomputes the expected value from the authenticated user and
 *     session, and requires both to match.
 *
 * A cross-origin attacker cannot read the cookie (the same-origin policy
 * forbids it), so it cannot construct a matching header.
 *
 * Binding to the user and session closes the flaw in naive double-submit: an
 * attacker who *can* set a cookie (via a subdomain, say) cannot forge a token
 * that also satisfies the server's HMAC, because they do not hold CSRF_SECRET.
 *
 * ## Safe methods are exempt
 *
 * GET/HEAD/OPTIONS must not mutate state (spec §8, and REST generally). Those
 * verbs are skipped, which also means the token is only demanded on requests
 * where it is meaningful.
 */

const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { generateCsrfToken, verifyCsrfToken } = require("../utils/tokens");
const { COOKIE_NAMES, requiresCsrf } = require("../utils/cookies");

const CSRF_HEADER = "x-csrf-token";

/**
 * Validate the CSRF token on state-changing requests.
 *
 * Must run **after** `authenticate` for protected routes, because the expected
 * token is derived from `req.user` and `req.sessionId` (both set by
 * `authenticate`).
 *
 * On unauthenticated mutating endpoints (login, refresh) no user exists yet.
 * Those routes are protected differently: `refresh` verifies that the
 * presented token matches the CSRF cookie, and `login` is safe without CSRF
 * because it authenticates rather than relies on an existing session — an
 * attacker can only force a login the victim controls, which is a known,
 * bounded exposure. See routes/auth.routes.js for that reasoning inline.
 */
function csrfProtection(req, res, next) {
  if (!requiresCsrf(req)) {
    return next();
  }

  const cookieToken = req.cookies?.[COOKIE_NAMES.CSRF_TOKEN];
  const headerToken = req.get(CSRF_HEADER);

  // Missing on both sides: almost always a non-browser client that was never
  // issued a token.
  if (!cookieToken || !headerToken) {
    return next(
      new ApiError(
        ERROR_CODE.CSRF_INVALID,
        "CSRF token missing. Send the X-CSRF-Token header with the value of the CSRF cookie."
      )
    );
  }

  // When the caller is authenticated, bind the check to their identity.
  // An unauthenticated mutating route falls through here; the auth service
  // performs its own verification for those.
  if (req.user) {
    const expected = generateCsrfToken({
      userId: req.user.id ?? req.user._id.toString(),
      sessionId: req.sessionId,
    });

    if (!verifyCsrfToken(headerToken, expected)) {
      return next(
        new ApiError(
          ERROR_CODE.CSRF_INVALID,
          "CSRF token invalid. Refresh the page and try again."
        )
      );
    }

    return next();
  }

  // Unauthenticated mutation with both tokens present: require the pair to at
  // least agree, so a mismatched cookie/header pair is rejected early even
  // before the auth service runs.
  if (!verifyCsrfToken(headerToken, cookieToken)) {
    return next(
      new ApiError(
        ERROR_CODE.CSRF_INVALID,
        "CSRF token invalid. Refresh the page and try again."
      )
    );
  }

  return next();
}

module.exports = {
  csrfProtection,
  CSRF_HEADER,
};
