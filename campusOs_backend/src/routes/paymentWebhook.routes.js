/**
 * Razorpay webhook endpoint.
 *
 * ## The raw body is non-negotiable
 *
 * Razorpay signs the **exact bytes** it sent. Express's `json()` middleware
 * parses the body, after which the original bytes no longer exist and a
 * re-serialised object may differ in key order or whitespace — so a signature
 * verified against `JSON.stringify(req.body)` is not a signature over what was
 * actually transmitted.
 *
 * This route therefore mounts `express.raw()` and is registered in `app.js`
 * **before** the global `express.json()`. That ordering is the whole reason the
 * middleware stack in app.js is arranged as it is.
 *
 * ## What this endpoint does and does not do
 *
 * It verifies the HMAC and applies the event idempotently. It never trusts the
 * body before verification, and it never marks an invoice paid on its own —
 * `applyWebhookEvent` is the only path to PAID.
 *
 * ## Always answering 200
 *
 * After a signature check, the endpoint returns 200 even for an event it did
 * not apply (duplicate, unknown order). A 4xx would make Razorpay retry a
 * delivery that will never succeed. Failures are surfaced in logs and the audit
 * trail instead.
 */

const express = require("express");
const crypto = require("crypto");

const { verifyWebhookSignature, getGateway } = require("../config/razorpay");
const financeService = require("../services/finance.service");
const { asyncHandler } = require("../utils/asyncHandler");
const { logger } = require("../config/logger");

const router = express.Router();

/**
 * POST /api/v1/payments/webhook/razorpay
 *
 * `express.raw` converts the request body into a Buffer. `verify: true` makes
 * body-parser confirm the declared Content-Type, so a text/plain request is
 * rejected rather than silently producing an empty buffer that would fail
 * verification for a confusing reason.
 */
router.post(
  "/payments/webhook/razorpay",
  express.raw({ type: "application/json", limit: "1mb" }),
  asyncHandler(async (req, res) => {
    const signature = req.get("x-razorpay-signature");
    const event = req.get("x-razorpay-event");

    // The Buffer must be captured before anything tries to parse it.
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : "");

    const gateway = getGateway();
    const webhookSecret = gateway.webhookSecret;

    const verified = verifyWebhookSignature(rawBody, signature, webhookSecret);

    if (!verified) {
      // Reject before parsing. An unsigned or wrongly-signed body must not
      // reach any handler that could act on it.
      logger.warn(
        {
          event,
          eventId: req.get("x-razorpay-event-id"),
          hasSignature: Boolean(signature),
        },
        "Rejected Razorpay webhook with an invalid signature"
      );
      return res.status(400).json({
        success: false,
        message: "Invalid webhook signature",
        code: "WEBHOOK_SIGNATURE_INVALID",
      });
    }

    // Safe to parse now.
    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      // A correctly-signed but unparseable body cannot happen with Razorpay;
      // refuse rather than guess.
      logger.error({ event }, "Verified Razorpay webhook had an unparseable body");
      return res.status(400).json({
        success: false,
        message: "Malformed webhook payload",
        code: "WEBHOOK_MALFORMED",
      });
    }

    /**
     * Dedup key.
     *
     * Razorpay does not guarantee a stable event id, so one is derived from the
     * event name and the entity it concerns. A retried delivery of the same event
     * therefore produces the same key and is absorbed, while a genuinely new
     * event about the same order (captured, then refunded) does not.
     */
    const entity = payload?.payload?.entity ?? {};
    const eventId =
      req.get("x-razorpay-event-id") ||
      crypto
        .createHash("sha256")
        .update(`${event}:${entity.order_id ?? ""}:${entity.id ?? ""}`)
        .digest("hex");

    const result = await financeService.applyWebhookEvent({
      eventId,
      event: event ?? "unknown",
      payload: entity,
    });

    logger.info(
      {
        event,
        eventId,
        applied: result.applied,
        reason: result.reason,
        status: result.status,
      },
      "Razorpay webhook processed"
    );

    // 200 regardless: a duplicate or unknown event is not a delivery failure,
    // and a non-200 would trigger pointless retries.
    return res.status(200).json({
      success: true,
      message: "Webhook received",
      data: { applied: result.applied, reason: result.reason ?? null },
    });
  })
);

module.exports = router;
