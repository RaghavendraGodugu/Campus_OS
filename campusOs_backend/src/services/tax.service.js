/**
 * GST computation.
 *
 * ## Intra-state splits, inter-state does not
 *
 * A supply inside the supplier's own state is charged **CGST + SGST**, half
 * each. A supply to another state is charged **IGST** at the full rate. This is
 * not a formatting difference: CGST and SGST are revenue for two different
 * governments and IGST is centrally pooled and later apportioned.
 *
 * Getting the split wrong means a tax invoice that does not reconcile, and the
 * error is invisible on the face of the document — the total is the same either
 * way. It is caught by an auditor, not by a student.
 *
 * ## The split is exact, not approximate
 *
 * CGST is half the tax amount and SGST is the remainder. Both integers, because
 * a tax figure of ₹16.665 is not a figure a tax authority accepts, and
 * rounding both halves independently can make them differ from the tax total by
 * a paisa. The larger half takes the odd paisa, so they always reconcile.
 *
 * ## HSN codes are validated by structure
 *
 * An HSN is 2, 4, 6 or 8 digits. That check is cheap and catches the most
 * common real mistake — a code typed with a trailing letter — before the
 * document is issued rather than after.
 */

const { add, subtract, percentageOf } = require("../utils/money");

/**
 * HSN/SAC codes: 2 to 8 digits, all numeric.
 *
 * Deliberately looser than the 2/4/6/8 lengths the classification hierarchy
 * formally uses. In practice colleges carry codes of other lengths, and refusing
 * one blocks a legitimate invoice to no benefit — what actually matters for a
 * return is that the field is all digits and of a plausible length, which is
 * what catches the real typo (a trailing letter, a space from a paste).
 */
const HSN_PATTERN = /^[0-9]{2,8}$/;

/** GST rate slabs. Rates outside these are refused rather than rounded. */
const GST_RATES = Object.freeze([0, 0.25, 3, 5, 12, 18, 28]);

/** Reverse charge: the recipient owes the tax, not the supplier. */
const TAX_CHARGE = Object.freeze({
  FORWARD: "FORWARD",
  REVERSE: "REVERSE",
});

/**
 * Split a tax amount into CGST and SGST.
 *
 * One half is floored and the other takes the odd paisa, so the two halves
 * always sum to exactly the tax. Rounding both independently — which is what
 * `Math.round(x/2)` twice does — can leave them a paisa apart from the tax
 * total, and a tax invoice whose halves do not reconcile is a rejected document.
 *
 * @param {number} taxAmount Minor units.
 * @returns {{cgst: number, sgst: number}}
 */
function splitStateTax(taxAmount) {
  const cgst = Math.floor(taxAmount / 2);
  const sgst = subtract(taxAmount, cgst);
  return { cgst, sgst };
}

/**
 * Compute tax on one line, split correctly for the place of supply.
 *
 * @param {{amount: number, taxPercent: number}} line
 * @param {boolean} interState
 * @returns {{taxAmount: number, components: object}}
 */
function computeLineTax(line, interState) {
  const taxAmount = percentageOf(line.amount ?? 0, line.taxPercent ?? 0);

  if (interState) {
    return {
      taxAmount,
      components: {
        igst: taxAmount,
        cgst: 0,
        sgst: 0,
        igstRate: line.taxPercent ?? 0,
        cgstRate: 0,
        sgstRate: 0,
      },
    };
  }

  const { cgst, sgst } = splitStateTax(taxAmount);
  const halfRate = (line.taxPercent ?? 0) / 2;

  return {
    taxAmount,
    components: {
      igst: 0,
      cgst,
      sgst,
      igstRate: 0,
      cgstRate: halfRate,
      sgstRate: halfRate,
    },
  };
}

/**
 * Tax for a whole invoice, with a per-rate breakup.
 *
 * ## The breakup is by *rate*, not by component
 *
 * A GST invoice groups by rate slab — "5% CGST 2.50 + 5% SGST 2.50", "18%
 * IGST 18.00" — rather than listing every line's halves. That is how the
 * return is filed and how the document is checked, so producing it any other
 * way makes the invoice harder to verify than it needs to be.
 *
 * @param {Array<object>} lines
 * @param {{interState: boolean, reverseCharge?: boolean}} options
 */
function computeInvoiceTax(
  lines,
  { interState, reverseCharge = TAX_CHARGE.FORWARD } = {}
) {
  const priced = [];
  let subtotal = 0;
  let taxTotal = 0;

  for (const line of lines ?? []) {
    const amount = line.amount ?? 0;
    const { taxAmount, components } = computeLineTax(line, interState);

    priced.push({
      ...line,
      taxAmount,
      taxComponents: components,
      hsnCode: line.hsnCode ?? null,
    });

    subtotal = add(subtotal, amount);
    taxTotal = add(taxTotal, taxAmount);
  }

  const total = add(subtotal, taxTotal);

  return {
    items: priced,
    subtotal,
    taxTotal,
    total,
    interState,
    reverseCharge,
    breakup: buildBreakup(priced),
  };
}

/** Group the priced lines into the rate slabs a GST invoice is checked against. */
function buildBreakup(priced) {
  const groups = new Map();

  for (const line of priced) {
    const key = `${line.taxPercent ?? 0}|${line.hsnCode ?? ""}`;

    if (!groups.has(key)) {
      groups.set(key, {
        rate: line.taxPercent ?? 0,
        hsnCode: line.hsnCode ?? null,
        taxableValue: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
      });
    }

    const group = groups.get(key);
    group.taxableValue = add(group.taxableValue, line.amount ?? 0);
    group.igst = add(group.igst, line.taxComponents.igst);
    group.cgst = add(group.cgst, line.taxComponents.cgst);
    group.sgst = add(group.sgst, line.taxComponents.sgst);
  }

  return [...groups.values()]
    .sort((a, b) => a.rate - b.rate)
    .map((group) => ({
      ...group,
      total: add(group.taxableValue, add(group.igst, add(group.cgst, group.sgst))),
    }));
}

/**
 * Validate a line's HSN code.
 *
 * @returns {{valid: boolean, reason: string|null}}
 */
function checkHsn(code) {
  if (code === null || code === undefined || code === "") {
    return { valid: true, reason: null };
  }
  if (!HSN_PATTERN.test(String(code))) {
    return {
      valid: false,
      reason: "An HSN code is 2 to 8 digits, all numeric",
    };
  }
  return { valid: true, reason: null };
}

/** Is this a rate a GST return can actually accept? */
function checkRate(rate) {
  if (GST_RATES.includes(Number(rate))) return { valid: true, reason: null };
  return {
    valid: false,
    reason: `A GST rate must be one of ${GST_RATES.join(", ")}`,
  };
}

module.exports = {
  splitStateTax,
  computeLineTax,
  computeInvoiceTax,
  buildBreakup,
  checkHsn,
  checkRate,
  HSN_PATTERN,
  GST_RATES,
  TAX_CHARGE,
};
