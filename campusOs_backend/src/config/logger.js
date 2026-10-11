/**
 * Structured logging via pino.
 *
 * Two hard requirements:
 *
 *  1. Secrets must never reach the log stream. `redact` below is the single
 *     place that decides what is sensitive; it covers body fields, headers and
 *     cookies, not just an explicit allowlist.
 *  2. Production must emit machine-parseable JSON (a log aggregator needs
 *     structure), while development stays readable via pino-pretty.
 *
 * The spec forbids logging passwords, payment secrets and full tokens, so
 * `req.headers.authorization`, `password`, token fields and Razorpay secrets
 * are all redacted here.
 */

const pino = require("pino");
const { getEnv } = require("./env");

/**
 * Paths redacted from every log object. Keys are matched anywhere in the
 * object graph by pino's path syntax (`a.b.c` and `*.b` wildcards).
 */
const redactPaths = [
  // Request bodies
  "req.body.password",
  "req.body.currentPassword",
  "req.body.newPassword",
  "req.body.confirmPassword",
  "password",
  "currentPassword",
  "newPassword",
  "confirmPassword",

  // Headers / cookies
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',

  // Tokens
  "token",
  "accessToken",
  "refreshToken",
  "csrfToken",
  "req.auth.token",

  // Payment secrets
  "razorpaySignature",
  "razorpay_webhook_secret",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "CLOUDINARY_API_SECRET",
  "SMTP_PASSWORD",
  "JWT_SECRET",
  "REFRESH_TOKEN_SECRET",
  "CSRF_SECRET",

  // Password hashes must not be logged even on success paths
  "passwordHash",
  "req.user.passwordHash",
];

function createLogger(options = {}) {
  const env = getEnv();
  const isProduction = env.NODE_ENV === "production";

  // Pretty transport is a devDependency; never require it in production.
  const usePretty =
    options.pretty !== undefined ? options.pretty : env.LOG_PRETTY && !isProduction;

  let transport;

  if (usePretty) {
    try {
      // pino resolves `target` as a module specifier in a worker thread, so it
      // must be the package name — passing an already-built stream here throws
      // ERR_INVALID_ARG_TYPE inside pino/lib/transport.js.
      require.resolve("pino-pretty");
      transport = {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname,reqId,responseTime",
          messageFormat: "{if reqId}[{reqId}] {end}{msg}",
        },
      };
    } catch {
      // pino-pretty not installed (e.g. a production install with devDeps
      // pruned) — fall through to plain JSON rather than crashing over a
      // logging preference.
      transport = undefined;
    }
  }

  // Tests set LOG_LEVEL=silent: a suite makes hundreds of requests, and the
  // resulting log volume buries real failures.
  const level = process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug");

  return pino({
    level,
    redact: {
      paths: redactPaths,
      censor: "[redacted]",
    },
    base: isProduction ? { service: "campusos-api" } : undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(transport ? { transport } : {}),
    ...options.overrides,
  });
}

/** Application-wide logger. Controllers and services import this. */
const logger = createLogger();

module.exports = { logger, createLogger, redactPaths };
