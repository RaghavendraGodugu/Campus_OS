/**
 * Money.
 *
 * ## The one rule
 *
 * **All amounts are integer minor units (paise).** No floats, anywhere, in any
 * financial path.
 *
 * `0.1 + 0.2 === 0.30000000000000004` in IEEE-754. In a fee ledger that is a
 * rounding error per line item that compounds into an unreconcilable total, and
 * it cannot be fixed retrospectively once a receipt has been issued. Storing
 * paise as an integer makes every operation exact and associative.
 *
 * ## Why paise, not rupees
 *
 * Razorpay expects the smallest currency unit — paise for INR. Storing the same
 * unit the gateway takes means no conversion happens anywhere in the system,
 * so there is no rounding step to disagree about. Rupees exist only at the
 * presentation boundary (`toRupees`) and on the rendered receipt.
 *
 * ## Bounds
 *
 * Amounts are validated against `MAX_SAFE_MINOR`. A value beyond
 * `Number.MAX_SAFE_INTEGER` cannot be represented exactly, so accepting one
 * would silently corrupt it; better to refuse the input at the edge.
 */

/** Currencies the platform supports, with their minor-unit exponent. */
const CURRENCIES = Object.freeze({
  INR: { code: "INR", minorUnits: 2, symbol: "₹" },
});

/**
 * Currency symbol used in generated PDFs.
 *
 * See formatForDocument(): U+20B9 has no glyph in the standard PDF fonts and
 * renders as a stray digit beside the amount.
 */
const DOCUMENT_CURRENCY_SYMBOL = "Rs. ";

/**
 * Largest amount representable exactly as a JS integer, in minor units.
 * ₹1,000,000 (one million rupees) is far beyond any institutional fee, and
 * leaves enormous headroom below the 2^53 ceiling.
 */
const MAX_SAFE_MINOR = 1_000_000_000_00; // 1e11 paise = ₹1 billion

/** Raised for any amount that cannot be trusted. */
class MoneyError extends Error {
  constructor(message) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Coerce a value to a safe integer number of minor units.
 *
 * Accepts an integer (already in paise) or a decimal string in major units.
 * **Rejects floats outright** when they are not exactly representable, because
 * accepting one is how 0.1 + 0.2 enters a ledger.
 *
 * @param {number|string} value Paise as an integer, or rupees as a decimal string.
 * @param {object} [options]
 * @param {string} [options.currency]
 * @returns {number} Integer minor units.
 * @throws {MoneyError}
 */
function toMinor(value, { currency = "INR" } = {}) {
  const config = CURRENCIES[currency];
  if (!config) {
    throw new MoneyError(`Unsupported currency: ${currency}`);
  }

  // Already in minor units: must be a safe integer.
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new MoneyError(
        `Amount ${value} is not an integer. Pass minor units as an integer, or major units as a string.`
      );
    }
    return assertInRange(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    // A bare integer string is treated as minor units only if it is explicitly
    // marked; otherwise "100" means ₹100. Callers wanting paise pass a number.
    const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
    if (!match) {
      throw new MoneyError(`Cannot parse amount: "${value}"`);
    }

    const [, sign, whole, fraction = ""] = match;
    const padded = fraction.padEnd(config.minorUnits, "0");
    const minor = Number(whole) * 10 ** config.minorUnits + Number(padded || 0);

    return assertInRange(sign ? -minor : minor);
  }

  throw new MoneyError(`Cannot interpret amount of type ${typeof value}`);
}

function assertInRange(amount) {
  if (!Number.isInteger(amount)) {
    // The range check alone would let 0.30000000000000004 through, because it
    // is a finite number below the limit. Enforcing integrality here is the
    // single choke point that makes every operation in this module exact —
    // and it means a float cannot enter a ledger by the back door via `add()`.
    throw new MoneyError(
      `Amount ${amount} is not an integer. Floating-point amounts are never accepted; ` +
        `use minor units (paise) or a decimal string in major units.`
    );
  }

  if (Math.abs(amount) > MAX_SAFE_MINOR) {
    throw new MoneyError(
      `Amount ${amount} exceeds the safe limit of ${MAX_SAFE_MINOR} minor units`
    );
  }

  return amount;
}

/** Add minor-unit amounts. Exact, because both operands are integers. */
function add(...amounts) {
  return assertInRange(
    amounts.reduce((sum, amount) => sum + assertInRange(Number(amount)), 0)
  );
}

/** Subtract. The result may be negative, which is legitimate (credit note). */
function subtract(a, b) {
  return assertInRange(assertInRange(Number(a)) - assertInRange(Number(b)));
}

/** Multiply by an integer quantity (copies, instalments). */
function multiply(amount, quantity) {
  if (!Number.isInteger(quantity)) {
    throw new MoneyError("Quantity must be an integer to keep the result exact");
  }
  return assertInRange(assertInRange(Number(amount)) * quantity);
}

/**
 * Apply a percentage, rounding half-up.
 *
 * Rounding is explicit rather than inherited from a float division: a 5% GST on
 * ₹333.33 is ₹16.67, and which side of the half-rupee it lands on must be a
 * decision, not an artefact.
 *
 * @param {number} amount    Minor units.
 * @param {number} percent   e.g. 18 for GST.
 * @returns {number} Minor units.
 */
function percentageOf(amount, percent) {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    throw new MoneyError("Percentage must be a finite number");
  }

  const base = assertInRange(Number(amount));

  // Round half-up explicitly, at the end, so the result is always whole paise:
  // 18% of 12345 is 2222.1 and must become 2222; 5% of 3333 is 166.65 and must
  // become 167, not 166. Rounding the intermediate instead would compound
  // errors across a multi-line invoice.
  const exact = (base * percent) / 100;
  return assertInRange(Math.round(exact));
}

/** Round half-up to the nearest minor unit. */
function round(amount) {
  return assertInRange(Math.round(Number(amount)));
}

/**
 * Convert minor units to a rupee decimal string for display.
 *
 * Returns a string, never a float: "1234" becomes "12.34", and
 * `Number(result)` is never used downstream.
 */
function toRupees(amount) {
  const minor = assertInRange(Number(amount));
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;

  return `${negative ? "-" : ""}${whole}.${String(fraction).padStart(2, "0")}`;
}

/** Format minor units for display, e.g. "₹12,350.00". */
function format(amount, { currency = "INR" } = {}) {
  const config = CURRENCIES[currency];
  if (!config) {
    throw new MoneyError(`Unsupported currency: ${currency}`);
  }

  const negative = Number(amount) < 0;
  const [whole, fraction] = toRupees(Math.abs(Number(amount))).split(".");

  // Indian digit grouping: the last three digits, then pairs.
  // 1234567 -> 12,34,567 (not 1,234,567).
  const lastThree = whole.slice(-3);
  const remaining = whole.slice(0, -3);
  const grouped = remaining
    ? `${remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}`
    : lastThree;

  return `${negative ? "-" : ""}${config.symbol}${grouped}.${fraction}`;
}

/**
 * Format minor units for a PDF or printed document.
 *
 * PDFKit's built-in fonts are WinAnsi-encoded and have no glyph for U+20B9
 * (₹). Rather than render nothing, PDFKit substitutes from the private-use
 * area and the symbol comes out as a spurious digit — a ₹5,900.00 receipt
 * printed "15,900.00", which is a wrong figure on a financial document.
 *
 * Embedding a font that carries the glyph would fix the appearance, but it
 * means shipping and licensing a binary font that must also exist inside any
 * container. "Rs." is unambiguous on an Indian financial document, renders in
 * every PDF viewer, and cannot corrupt the digits next to it.
 *
 * @param {number} amount Minor units.
 * @returns {string} e.g. "Rs.5,900.00"
 */
function formatForDocument(amount, { currency = "INR" } = {}) {
  return format(amount, { currency }).replace(
    CURRENCIES[currency].symbol,
    DOCUMENT_CURRENCY_SYMBOL
  );
}

/** Are these two amounts the same, to the paisa? */
function equals(a, b) {
  return Number(a) === Number(b);
}

/** Is this a strictly positive amount? */
function isPositive(amount) {
  return Number.isInteger(amount) && amount > 0;
}

/** Is this a safe, non-negative amount suitable for a payment? */
function isPayableAmount(amount) {
  return isPositive(amount) && Math.abs(amount) <= MAX_SAFE_MINOR;
}

/**
 * Split an amount into N parts that sum EXACTLY to the original.
 *
 * Used for instalments. Naive division loses or gains paise: 1000 / 3 gives
 * 333.33 × 3 = 999.99. The remainder is distributed one paisa at a time to the
 * earliest parts, so the parts always reconcile to the whole.
 *
 * @param {number} amount Total in minor units.
 * @param {number} parts  Number of instalments.
 * @returns {number[]} Exactly `parts` amounts summing to `amount`.
 */
function split(amount, parts) {
  const total = assertInRange(Number(amount));
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError("Number of parts must be a positive integer");
  }
  if (total < 0) {
    throw new MoneyError("Cannot split a negative amount");
  }

  const base = Math.floor(total / parts);
  const remainder = total - base * parts;

  return Array.from({ length: parts }, (_, index) =>
    // The first `remainder` parts absorb one extra paisa each.
    index < remainder ? base + 1 : base
  );
}

module.exports = {
  CURRENCIES,
  MAX_SAFE_MINOR,
  MoneyError,
  toMinor,
  add,
  subtract,
  multiply,
  percentageOf,
  round,
  toRupees,
  format,
  formatForDocument,
  equals,
  isPositive,
  isPayableAmount,
  split,
};
