/**
 * Outbound email.
 *
 * ## Why there is no dependency
 *
 * SMTP over a socket is not something to hand-roll for a handful of messages,
 * but nodemailer is not needed to *have* email in development either. So this
 * module has two transports:
 *
 * - `dev` — writes the message to `dev-mailbox.jsonl` in the project root and
 *   logs the action link. Nothing to configure, and the link is one `grep`
 *   away, which is what makes verification and reset testable end to end
 *   without a provider account.
 * - `smtp` — used when `SMTP_HOST` is set. nodemailer is `require`d lazily and
 *   only then, so a deployment that never sets SMTP_HOST does not need it
 *   installed.
 *
 * ## Delivery must never break the workflow
 *
 * Email is a side effect of a state change, never a precondition for it. A
 * failed send is logged and returned as `{ delivered: false }`; the caller
 * decides whether that is fatal. Requesting a reset must still say the same
 * thing whether or not the message went out, or the response becomes an oracle
 * for which addresses exist.
 *
 * ## No secrets in the log
 *
 * Bodies contain single-use links. `dev-mailbox.jsonl` is gitignored, and the
 * logger records the recipient and subject only — never the body.
 */

const fs = require("node:fs");
const path = require("node:path");

const { getEnv } = require("../config/env");
const { logger } = require("../config/logger");

const MAILBOX_FILE = path.join(process.cwd(), "dev-mailbox.jsonl");

/** Which transport the current configuration selects. */
function transport() {
  return getEnv().SMTP_HOST ? "smtp" : "dev";
}

/**
 * Send one message.
 *
 * @returns {Promise<{delivered: boolean, transport: string, error?: string}>}
 * Never throws. See the note above: a caller that needs to know must be told
 * through the return value, because a throw here would turn an email outage
 * into a broken sign-in.
 */
async function send({ to, subject, text, html }) {
  const chosen = transport();

  try {
    if (chosen === "dev") {
      writeToMailbox({ to, subject, text, html });
      logger.info({ to, subject }, "Email written to the development mailbox");
      return { delivered: true, transport: "dev" };
    }

    const nodemailer = require("nodemailer");
    const env = getEnv();

    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      // 465 is implicit TLS; everything else starts plain and upgrades, which
      // is what STARTTLS servers expect.
      secure: Number(env.SMTP_PORT) === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });

    await transporter.sendMail({
      from: env.SMTP_FROM || "CampusOS <no-reply@campusos.local>",
      to,
      subject,
      text,
      html,
    });

    return { delivered: true, transport: "smtp" };
  } catch (error) {
    logger.error({ err: error, to, subject }, "Email delivery failed");
    return { delivered: false, transport: chosen, error: error.message };
  }
}

/** Append one JSON line. Kept append-only so a test can read the last message. */
function writeToMailbox(message) {
  fs.appendFileSync(
    MAILBOX_FILE,
    `${JSON.stringify({ at: new Date().toISOString(), ...message })}\n`
  );
}

/** The messages written so far. For tests and for reading links out by hand. */
function readMailbox() {
  if (!fs.existsSync(MAILBOX_FILE)) return [];

  return fs
    .readFileSync(MAILBOX_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Empty the mailbox. Tests call this so they read only their own messages. */
function clearMailbox() {
  if (fs.existsSync(MAILBOX_FILE)) fs.rmSync(MAILBOX_FILE);
}

/**
 * Build the link a person clicks in an email.
 *
 * Lives here rather than in each caller because getting it wrong is silent: a
 * link pointing at the wrong host still looks like a link, and the failure only
 * shows up as somebody stranded in front of a page that does not exist.
 */
function webUrl(path) {
  const base = getEnv().WEB_URL || "http://localhost:5173";
  return `${base.replace(/\/$/, "")}${path}`;
}

module.exports = { send, webUrl, readMailbox, clearMailbox, MAILBOX_FILE };
