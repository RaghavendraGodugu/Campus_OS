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
 * The primary browser defence is the `Origin` header. Browsers set it on
 * cross-origin mutating requests and a page cannot forge it. A request from the
 * configured `CLIENT_URL` is accepted; a request carrying any other Origin is
 * rejected even if it also has a token.
 *
 * The `X-CSRF-Token` double-submit check remains for callers that do not send
 * Origin (curl, native clients, older browsers). It cannot be the only
 * defence across Vercel and Render: cookies set by the API belong to the API's
 * host, so JavaScript on the Vercel page cannot read the CSRF cookie. That is
 * why the browser path uses Origin, and the token path is a fallback for
 * non-browser callers.
 *
 * The token is still bound to the user and session, so an attacker who can set
 * a cookie on the API host cannot forge one without CSRF_SECRET.
 *
 * ## Safe methods are exempt
 *
 * GET/HEAD/OPTIONS must not mutate state (spec §8, and REST generally). Those
 * verbs are skipped, which also means the token is only demanded on requests
 * where it is meaningful.
 */

const { getEnv } = require("../config/env");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { generateCsrfToken, verifyCsrfToken } = require("../utils/tokens");
const { COOKIE_NAMES, requiresCsrf } = require("../utils/cookies");

const CSRF_HEADER = "x-csrf-token";

/** Is the request's browser Origin one of the configured frontend origins? */
function isTrustedOrigin(req) {
  const origin = req.get("origin");
  return Boolean(origin) && getEnv().CLIENT_URL.includes(origin);
}

/**
 * Reject an explicitly untrusted browser Origin on every mutating request.
 *
 * CORS stops such a page from reading the response, but not from causing the
 * request to run. This guard runs before the routes so login, logout, password
 * reset, and other public mutations get the same protection as authenticated
 * ones. Requests with no Origin (server-to-server, curl, the Razorpay webhook)
 * pass through to route-specific authentication or signature checks.
 */
function originGuard(req, res, next) {
  if (!requiresCsrf(req)) {
    return next();
  }

  const origin = req.get("origin");
  if (!origin || isTrustedOrigin(req)) {
    return next();
  }

  return next(
    new ApiError(
      ERROR_CODE.CSRF_INVALID,
      "CSRF origin is not trusted. Use the configured frontend origin."
    )
  );
}

/**
 * Validate the CSRF token on state-changing requests.
 *
 * Must run **after** `authenticate` for protected routes, because the expected
 * token is derived from `req.user` and `req.sessionId` (both set by
 * `authenticate`).
 *
 * On unauthenticated mutating endpoints no user exists yet, so `originGuard`
 * has already rejected an untrusted browser Origin before the route runs.
 * `refresh` additionally checks the token when no Origin is present. `login`
 * needs no token because it authenticates rather than relying on an existing
 * session; forcing a login only signs the victim into an account the attacker
 * does not control. See routes/auth.routes.js for that reasoning inline.
 */
function csrfProtection(req, res, next) {
  if (!requiresCsrf(req)) {
    return next();
  }

  if (isTrustedOrigin(req)) {
    return next();
  }

  if (req.get("origin")) {
    return next(
      new ApiError(
        ERROR_CODE.CSRF_INVALID,
        "CSRF origin is not trusted. Use the configured frontend origin."
      )
    );
  }

  const cookieToken = req.cookies?.[COOKIE_NAMES.CSRF_TOKEN];
  const headerToken = req.get(CSRF_HEADER);

  // No Origin means a non-browser caller. Missing on both sides is almost
  // always a client that was never issued a token.
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
  originGuard,
  isTrustedOrigin,
  CSRF_HEADER,
};
