/**
 * Health endpoints.
 *
 * Split deliberately into two, because deployment platforms check them for
 * different purposes and conflating them causes outages:
 *
 *  - `/health/live`  liveness: "is the process up?" No database access, so a
 *    transient DB blip cannot cause the platform to kill a healthy process.
 *  - `/health/ready` readiness: "can it serve traffic?" Requires a live DB.
 *
 * The detail endpoint (`/health`) returns component status for humans and is
 * excluded from the auto-logged list.
 */

const mongoose = require("mongoose");
const { getEnv } = require("../config/env");
const { isDbConnected } = require("../config/db");
const { sendSuccess } = require("../utils/response");

const startedAt = Date.now();

/** GET /health/live — liveness probe. Never touches the database. */
function live(req, res) {
  return sendSuccess(res, {
    message: "Service is running",
    data: { status: "alive", uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) },
  });
}

/** GET /health/ready — readiness probe. Fails with 503 when the DB is down. */
function ready(req, res) {
  const connected = isDbConnected();

  const body = {
    status: connected ? "ready" : "not_ready",
    database: connected ? "connected" : "disconnected",
  };

  return res.status(connected ? 200 : 503).json({
    success: connected,
    message: connected ? "Service is ready" : "Service is not ready",
    data: body,
  });
}

/** GET /health — component detail for humans and operators. */
function health(req, res) {
  const env = getEnv();
  const connected = isDbConnected();

  // Only ever echo *whether* a secret is configured, never its value.
  const integrations = {
    cloudinary: Boolean(env.CLOUDINARY_CLOUD_NAME),
    razorpay: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
    smtp: Boolean(env.SMTP_HOST),
  };

  return sendSuccess(res, {
    message: connected ? "Service healthy" : "Service running with database unavailable",
    data: {
      status: connected ? "healthy" : "degraded",
      environment: env.NODE_ENV,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      database: {
        connected,
        readyState: mongoose.connection.readyState,
        name: mongoose.connection.name || null,
      },
      integrations,
    },
  });
}

module.exports = { live, ready, health };
