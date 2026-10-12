/**
 * Display formatting.
 *
 * ## Money is formatted, never parsed
 *
 * Amounts arrive from the server as integer paise and are rendered here.
 * Nothing in this file — or anywhere else in the client — turns a rupee string
 * back into a number. That round trip is how a float reaches a total, and a
 * float reaching a total is how a college is billed 0.1 + 0.2.
 *
 * The server already sends a pre-formatted string for most figures, and where it
 * does this file is the fallback for the ones it does not.
 */

/**
 * Format integer paise as a rupee string.
 *
 * Mirrors the server's `money.format` — Indian digit grouping, where the last
 * three digits group together and the rest pair off: 12,34,567 not 1,234,567.
 *
 * @param {number} minorUnits Integer paise.
 * @returns {string} e.g. "₹12,34,567.00"
 */
export function formatMoney(minorUnits, { showSymbol = true } = {}) {
  // Checked before the numeric coercion, not after.
  //
  // `Number(null)` is 0 and `Number("")` is 0, so testing the coerced value
  // would render a missing amount as ₹0.00 — a claim that something is free,
  // on a screen whose whole purpose is to state what is owed. Caught by the
  // test written to prevent it.
  if (minorUnits === null || minorUnits === undefined || minorUnits === "") {
    return "—";
  }

  const minor = Number(minorUnits);

  if (!Number.isFinite(minor)) {
    return "—";
  }

  const negative = minor < 0;
  const absolute = Math.abs(Math.trunc(minor));

  const whole = Math.floor(absolute / 100);
  const paise = absolute % 100;

  const grouped = groupIndian(whole);
  const formatted = `${grouped}.${String(paise).padStart(2, "0")}`;

  return `${negative ? "-" : ""}${showSymbol ? "₹" : ""}${formatted}`;
}

/** Indian digit grouping: the last three, then pairs. */
function groupIndian(value) {
  const digits = String(value);

  if (digits.length <= 3) return digits;

  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const paired = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");

  return `${paired},${lastThree}`;
}

/**
 * Prefer the server's own formatted string, fall back to formatting here.
 *
 * The server is the authority on money. This exists for figures that arrive
 * bare — a report total, or a figure added in a later slice — and is formatted
 * by the same rules rather than by a second implementation that could drift.
 */
export function money(preformatted, minorUnits) {
  if (typeof preformatted === "string" && preformatted.length > 0)
    return preformatted;
  return formatMoney(minorUnits);
}

/** A date, in the reader's locale but unambiguous: 12 Oct 2026. */
export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** A date and time, to the minute. */
export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A relative time, for "how long ago".
 *
 * Beyond a month it stops guessing and shows the date, because "43 days ago"
 * stops being useful information and starts being noise.
 */
export function formatRelative(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days <= 30) return `${days}d ago`;

  return formatDate(value);
}

/**
 * Turn a SCREAMING_SNAKE status into a readable label.
 *
 * `PARTIALLY_PAID` becomes `Partially paid`. Done once here so no component
 * grows its own ad-hoc replace chain.
 */
export function humanise(value) {
  if (!value) return "—";

  const words = String(value).toLowerCase().split("_").filter(Boolean);

  if (words.length === 0) return "—";

  return (
    words[0].charAt(0).toUpperCase() +
    words[0].slice(1) +
    (words.length > 1 ? ` ${words.slice(1).join(" ")}` : "")
  );
}

/** The initials shown in an avatar. Never more than two. */
export function initials(name) {
  if (!name) return "?";
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
