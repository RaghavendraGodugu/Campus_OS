
/**
 * Express application assembly.
 *
 * Middleware order:
 * 1. Helmet security headers
 * 2. CORS and preflight handling
 * 3. Request logging
 * 4. Compression
 * 5. CSRF Origin guard
 * 6. Body parsing
 * 7. Cookie parsing
 * 8. Content-type validation
 * 9. API routes
 * 10. Not-found handler
 * 11. Error handler
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

require("./models");

const routes = require("./routes");
const {
  errorHandler,
  notFoundHandler,
} = require("./middleware/errorHandler");
const { originGuard } = require("./middleware/csrf");
const { ApiError, ERROR_CODE } = require("./utils/ApiError");

/**
 * Normalize trusted origins.
 *
 * Supports:
 * - A validated array from config/env.js
 * - A comma-separated string
 *
 * Origins must not contain paths or trailing slashes.
 */
function normalizeOrigins(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return [
    ...new Set(
      values
        .filter((origin) => typeof origin === "string")
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter(Boolean)
    ),
  ];
}

/**
 * Build a strict CORS policy for trusted frontend origins.
 * Credentials are allowed only for explicitly trusted origins.
 */
function buildCorsOptions(trustedOrigins) {
  const allowed = new Set(normalizeOrigins(trustedOrigins));

  return {
    origin(origin, callback) {
      // Non-browser requests without an Origin header are not subject
      // to browser CORS enforcement.
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = origin.trim().replace(/\/+$/, "");

      if (allowed.has(normalizedOrigin)) {
        return callback(null, true);
      }

      logger.warn(
        { origin },
        "Blocked cross-origin request from untrusted origin"
      );

      // Do not reflect untrusted origins in the response.
      return callback(null, false);
    },

    credentials: true,

    methods: [
      "GET",
      "HEAD",
      "POST",
      "PATCH",
      "PUT",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-CSRF-Token",
      "Idempotency-Key",
    ],

    exposedHeaders: [
      "X-Request-Id",
      "Content-Disposition",
    ],

    maxAge: 600,
    optionsSuccessStatus: 204,
  };
}

function createApp() {
  const env = getEnv();
  const app = express();

  // Correct proxy-aware client IP and HTTPS detection behind Render.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // 1. Security headers.
  app.use(
    helmet({
      // The API serves JSON; frontend CSP is configured separately.
      contentSecurityPolicy: false,

      crossOriginResourcePolicy: {
        policy: "same-site",
      },

      referrerPolicy: {
        policy: "no-referrer",
      },

      hsts:
        env.NODE_ENV === "production"
          ? {
              maxAge: 31536000,
              includeSubDomains: true,
              preload: true,
            }
          : false,
    })
  );

  // 2. CORS. Must run before CSRF middleware and routes.
  const corsOptions = buildCorsOptions(env.CLIENT_URL);

  app.use(cors(corsOptions));

  // Express 5-compatible catch-all OPTIONS route.
  // This lets the CORS middleware answer browser preflight requests.
  app.options(/.*/, cors(corsOptions));

  // 3. Request logging.
  app.use(
    pinoHttp({
      logger,

      genReqId: (req) =>
        req.headers["x-request-id"] || crypto.randomUUID(),

      autoLogging: {
        ignore: (req) =>
          req.url === "/health" ||
          req.url === "/health/live" ||
          req.url === "/health/ready",
      },

      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    })
  );

  // 4. Compression.
  app.use(compression());

  // 5. CSRF Origin guard.
  // Preserve the existing security policy for mutating requests.
  app.use(originGuard);

  // 6. Parse JSON and URL-encoded request bodies.
  app.use(express.json({ limit: "1mb" }));

  app.use(
    express.urlencoded({
      extended: true,
      limit: "1mb",
    })
  );

  // 7. Parse cookies before authentication routes use them.
  app.use(cookieParser());

  // 8. Reject unsupported content types on mutating requests.
  app.use((req, res, next) => {
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(
      req.method
    );

    const hasBody = ["POST", "PATCH", "PUT"].includes(
      req.method
    );

    const contentType = req.headers["content-type"] ?? "";

    const isMultipart = contentType.startsWith(
      "multipart/form-data"
    );

    const isJson = contentType.startsWith(
      "application/json"
    );

    if (
      mutating &&
      hasBody &&
      !isMultipart &&
      !isJson &&
      contentType !== ""
    ) {
      return next(
        new ApiError(
          ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
          "Content-Type must be application/json"
        )
      );
    }

    return next();
  });

  // 9. Existing route aggregator.
  // Includes /health, /health/live, /health/ready,
  // and versioned API routes such as /api/v1/auth/me.
  app.use(routes);

  // 10. Handle unmatched routes.
  app.use(notFoundHandler);

  // 11. Error handler must remain last.
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
  buildCorsOptions,
  normalizeOrigins,
};
