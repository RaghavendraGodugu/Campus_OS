
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
 * Normalize a string, comma-separated string, or array of origins.
 * Example:
 * "https://example.vercel.app, http://localhost:5173"
 */
function normalizeOrigins(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return values
    .filter((value) => typeof value === "string")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * Construct a strict credentialed CORS policy.
 */
function buildCorsOptions(trustedOrigins) {
  const allowed = new Set(normalizeOrigins(trustedOrigins));

  return {
    origin(origin, callback) {
      // Requests without Origin are not subject to browser CORS.
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

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // 1. Security headers.
  app.use(
    helmet({
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

  // 2. CORS must run before CSRF checks and routes.
  const corsOptions = buildCorsOptions(env.CLIENT_URL);

  app.use(cors(corsOptions));

  // Explicitly handle preflight requests before other middleware.
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
          req.url === "/health/live",
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
  app.use(originGuard);

  // 6. Request body parsing.
  app.use(express.json({ limit: "1mb" }));
  app.use(
    express.urlencoded({
      extended: true,
      limit: "1mb",
    })
  );

  // 7. Cookie parsing.
  app.use(cookieParser());

  // 8. Content-type validation.
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

  // 9. Mount the existing route aggregator.
  app.use(routes);

  // 10–11. Keep these last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
  buildCorsOptions,
  normalizeOrigins,
};
