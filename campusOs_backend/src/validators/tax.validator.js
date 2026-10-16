const { z } = require("zod");

/**
 * GST profile.
 *
 * The GSTIN pattern is enforced here rather than trusted from the client: the
 * first two digits are the state code the GSTIN is registered in, and the
 * profile's own `stateCode` has to agree with it. A mismatch would mean the
 * invoice claims one state and carries an identifier for another.
 */
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    "A GSTIN looks like 29ABCDE1234F1Z5"
  );

const taxProfileSchema = z
  .object({
    legalName: z.string().trim().min(2).max(160),
    gstin,
    placeOfSupply: z.string().trim().min(2).max(120),
    addressLine1: z.string().trim().min(2).max(160),
    addressLine2: z.string().trim().max(160).nullish(),
    pincode: z
      .string()
      .trim()
      .regex(/^[0-9]{6}$/, "A PIN code is six digits")
      .nullish(),
    email: z.string().trim().email().max(160).nullish(),
    authorisedSignatory: z.string().trim().max(160).nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    /*
     * Derived, and cross-checked.
     *
     * `stateCode` is taken from the GSTIN's first two digits rather than typed,
     * because the two can disagree and the GSTIN is the authoritative one. A
     * profile typed with stateCode "07" and a GSTIN beginning "29" would issue
     * invoices that claim the wrong state.
     */
    const fromGstin = value.gstin.slice(0, 2);
    if (!/^[0-9]{2}$/.test(fromGstin)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gstin"],
        message: "Could not read a state code from the first two digits of the GSTIN",
      });
    }
  })
  .transform((value) => ({ ...value, stateCode: value.gstin.slice(0, 2) }));

module.exports = { taxProfileSchema };
