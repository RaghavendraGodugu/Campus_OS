const crypto = require("crypto");

/**
 * TOTP, RFC 6238, with no dependency.
 *
 * ## Why this is not a library
 *
 * TOTP is `HMAC-SHA1(counter, secret)` truncated to six digits, checked against
 * the neighbouring windows. That is the entire algorithm — about thirty lines —
 * and `node:crypto` already has everything it needs. Adding a package for it
 * would be thirty lines of somebody else's code to audit, plus a dependency
 * tree, in exchange for nothing.
 *
 * ## What is deliberately not built
 *
 * **No QR code.** That needs an image encoder, and an image encoder is a
 * dependency. Instead the enrolment screen shows the `otpauth://` URI and the
 * base32 secret, which every authenticator app accepts by manual entry.
 * shortcut: no QR image on enrolment. Upgrade path: add `qrcode` and render the
 * `provisioningUri` we already build — the URI is the hard part and it is done.
 *
 * **SHA-1.** This is the algorithm the RFC specifies and what every
 * authenticator app implements. It is not a weakness here: the threat is
 * guessing a six-digit code against a rate limit, not breaking a hash.
 *
 * ## The window
 *
 * One step either side of now, to tolerate clock skew between the phone and
 * the server. Two steps either side would accept roughly a million codes per
 * login attempt, which turns the six digits into a weak secret.
 */

/** Base32, RFC 4648. Uppercase, no padding — the alphabet apps expect. */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** One step either side. Two would widen the search space by a thousand. */
const WINDOW = 1;
/** The code is derived from an 8-byte counter, per the RFC. */
const COUNTER_BYTES = 8;

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input) {
  const cleaned = String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "");

  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of cleaned) {
    const index = BASE32.indexOf(char);
    if (index === -1) continue;

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** A 160-bit secret, base32 — what the RFC and every app expects. */
function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/**
 * The code for one counter value.
 *
 * Exported because the tests check the RFC 6238 test vectors against it, and a
 * hand-rolled implementation with no vectors is just a plausible-looking
 * function.
 */
function hotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);

  // The counter is a 64-bit big-endian integer, per the RFC.
  const buffer = Buffer.alloc(COUNTER_BYTES);
  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = crypto.createHmac("sha1", key).update(buffer).digest();

  // Dynamic truncation: the last nibble of the digest selects an offset.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The code for a moment in time. */
function totp(secretBase32, at = Date.now()) {
  return hotp(secretBase32, Math.floor(at / 1000 / PERIOD_SECONDS));
}

/**
 * Is this code valid?
 *
 * Constant-time comparison, because a six-digit code is short enough that a
 * timing difference is measurable over enough attempts.
 */
function verify(secretBase32, code, { at = Date.now(), window = WINDOW } = {}) {
  const candidate = String(code ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(candidate)) return false;

  const current = Math.floor(at / 1000 / PERIOD_SECONDS);

  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(secretBase32, current + offset);
    if (
      expected.length === candidate.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))
    ) {
      return true;
    }
  }

  return false;
}

/** The `otpauth://` URI an authenticator app scans or is given. */
function provisioningUri({ secret, account, issuer = "CampusOS" }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    // Both matter: the algorithm so the app does not default to something else,
    // and the period so a non-standard one still works.
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });

  return `otpauth://totp/${label}?${params}`;
}

/** Human-friendly grouping, so it can be read off a screen and typed in. */
function formatSecret(secret) {
  return (
    String(secret ?? "")
      .match(/.{1,4}/g)
      ?.join(" ") ?? ""
  );
}

module.exports = {
  generateSecret,
  base32Encode,
  base32Decode,
  hotp,
  totp,
  verify,
  provisioningUri,
  formatSecret,
  BASE32,
  DIGITS,
  PERIOD_SECONDS,
  WINDOW,
};
