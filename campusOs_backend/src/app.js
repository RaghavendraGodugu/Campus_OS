/**
 * Express application assembly.
 *
 * Middleware order is load-bearing. The sequence below exists to satisfy four
 * specific requirements; changing it silently breaks one of them.
 *
 *  1. `helmet` first, so every later response (including errors) carries
 *     security headers.
 *  2. `cors` before any body parsing, so a rejected cross-origin preflight is
 *     answered without buffering an upload body.
 *  3. The payment webhook router, which needs the RAW request body, mounted
 *     above `express.json`. This is the one ordering constraint that is easy to
 *     break by accident; see the comment at its registration for why.
 *  4. `express.json` with an explicit size limit, ahead of cookie parsing, so
 *     an oversized body is rejected before anything else inspects it.
 *  5. Route mounting, then `notFoundHandler`, then `errorHandler` — Express
 *     requires the error handler to be registered last.
 *
 * Raw-body capture (needed for Razorpay webhook signature verification) is
 * intentionally NOT configured globally here; that route mounts its own
 * `express.raw()` so no other endpoint pays for buffering raw bytes.
 */

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const pinoHttp = require("pino-http");
const crypto = require("crypto");

const { getEnv } = require("./config/env");
const { logger } = require("./config/logger");

// Register every model before any route runs.
//
// Mongoose's `.populate()` resolves references through the model registry, and
// a model that has never been required is simply absent from it. Loading them
// lazily — only via the routes that happen to touch them — therefore makes
// populate throw `MissingSchemaError` for any reference owned by a model that
// no mounted route imported. This barrelled require guarantees the registry is
// complete regardless of which routers are mounted.
require("./models");
const routes = require("./routes");
const paymentWebhookRoutes = require("./routes/paymentWebhook.routes");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");
const { originGuard } = require("./middleware/csrf");
const { ApiError, ERROR_CODE } = require("./utils/ApiError");

/**
 * Build the CORS policy from the validated origin allowlist.
 *
 * The origin callback is used instead of a static array so an unknown origin
 * is rejected *without* the `Access-Control-Allow-Origin` header being set —
 * a blanket `origin: true` would reflect any caller and, combined with
 * `credentials: true`, let any site make authenticated cross-origin requests.
 */
function buildCorsOptions(trustedOrigins) {
  const allowed = new Set(trustedOrigins);

  return {
    origin(origin, callback) {
      // Same-origin/non-browser callers (curl, server-to-server, mobile)
      // send no Origin header. Those are not subject to CORS, so allow them;
      // cookie-based auth means a browser will always send Origin.
      if (!origin) {
        return callback(null, true);
      }
      if (allowed.has(origin)) {
        return callback(null, true);
      }
      logger.warn({ origin }, "Blocked cross-origin request from untrusted origin");
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "Idempotency-Key"],
    exposedHeaders: ["X-Request-Id", "Content-Disposition"],
    maxAge: 600,
  };
}

function createApp() {
  const env = getEnv();
  const app = express();

  // Trust the first proxy hop so req.ip and secure-cookie detection are
  // correct behind Render/Railway/Vercel. Exactly one hop, not `true`, which
  // would let a client spoof X-Forwarded-For.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // 1. Security headers on every response, including error responses.
  app.use(
    helmet({
      // The API serves JSON only; a restrictive CSP here would be inert but
      // misleading, and the frontend host sets its own policy.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
      hsts:
        env.NODE_ENV === "production"
          ? { maxAge: 31536000, includeSubDomains: true, preload: true }
          : false,
    })
  );

  // 2. CORS before body parsing.
  app.use(cors(buildCorsOptions(env.CLIENT_URL)));

  // 3. Request logging with automatic correlation id. Auto-generated id is
  //    attached to every log line for this request, including error logs.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers["x-request-id"] || crypto.randomUUID(),
      // Health checks would otherwise dominate the log volume.
      autoLogging: {
        ignore: (req) => req.url === "/health" || req.url === "/health/live",
      },
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    })
  );

  // 4. Compression (JSON responses benefit; already-compressed payloads are
  //    passed through untouched by the compression middleware).
  app.use(compression());

  // 5. Payment webhooks — BEFORE the JSON body parser.
  //
  //    Razorpay signs the exact bytes it transmitted. `express.json()` parses
  //    the body, after which the original bytes are gone and re-serialising
  //    cannot be relied on to reproduce them (key order and whitespace are not
  //    guaranteed to survive). A webhook route mounted after the JSON parser
  //    therefore could never verify its signature — or, worse, could verify a
  //    signature over a body the server had itself reformatted.
  //
  //    This route mounts its own `express.raw()` and must stay above the next
  //    line. Nothing else in the app needs the raw body.
  app.use("/api/v1", paymentWebhookRoutes);

  // 5b. Reject a mutating request carrying an untrusted browser Origin before
  //     any body is read. CORS prevents the attacker from reading the response,
  //     but not from causing the mutation; this is the CSRF origin gate.
  app.use(originGuard);

  // 6. Body parsing with an explicit ceiling. A college request form is small;
  //    1mb is generous and bounds memory use under load.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // 7. Cookies. `secret` lets us sign cookies if needed; the CSRF token is
  //    verified by HMAC in middleware/csrf.js rather than by cookie-parser.
  app.use(cookieParser());

  // 8. Reject unsupported content types on mutating verbs early, so a
  // text/plain body does not reach a handler as `undefined` req.body.
  app.use((req, res, next) => {
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    const hasBody = ["POST", "PATCH", "PUT"].includes(req.method);
    const contentType = req.headers["content-type"] ?? "";
    const isMultipart = contentType.startsWith("multipart/form-data");
    const isJson = contentType.startsWith("application/json");

    if (mutating && hasBody && !isMultipart && !isJson && contentType !== "") {
      return next(
        new ApiError(
          ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
          "Content-Type must be application/json"
        )
      );
    }
    return next();
  });

  // 9. Routes (including /health).
  app.use(routes);

  // 10. 404, then 11. error handler — order is mandatory in Express.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, buildCorsOptions };
