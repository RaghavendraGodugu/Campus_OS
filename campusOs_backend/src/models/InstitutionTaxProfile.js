const mongoose = require("mongoose");

/**
 * The institution's GST profile.
 *
 * ## Why it exists and why there is exactly one
 *
 * A GST invoice is only valid if it carries the supplier's GSTIN, the legal
 * name that GSTIN is registered under, and the state the institution is in.
 * Without all three the tax is not chargeable at all, so the invoice is not a
 * tax invoice — it is an invoice with a number on it.
 *
 * The state is the load-bearing field: it decides whether a charge is split
 * into CGST and SGST (same state) or levied as IGST (another state). Getting it
 * wrong means charging the wrong split, which is a real compliance problem
 * rather than a cosmetic one.
 *
 * ## Exactly one profile, enforced by a singleton key
 *
 * There is one supplier. Two profiles would mean the invoice picks one at
 * random, and the GSTIN on a tax invoice must be the registered one. A partial
 * unique index on a constant `singleton` field makes a second row impossible at
 * the database level rather than by application code that races with itself.
 */

const institutionTaxProfileSchema = new mongoose.Schema(
  {
    /** Always the literal "primary". Exists solely to carry the unique index. */
    singleton: {
      type: String,
      default: "primary",
      enum: ["primary"],
      immutable: true,
    },

    /** The name the GSTIN is registered under. Not the trading name. */
    legalName: {
      type: String,
      required: [true, "The registered legal name is required"],
      trim: true,
      maxlength: 160,
    },

    /**
     * GSTIN: 15 characters, and the state code is its first two.
     *
     * The pattern is validated rather than merely length-checked because a
     * malformed GSTIN on a tax invoice is a rejected document, and the student
     * finds out at the counter.
     */
    gstin: {
      type: String,
      required: [true, "A GSTIN is required to issue a tax invoice"],
      trim: true,
      uppercase: true,
      match: [
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
        "A GSTIN looks like 29ABCDE1234F1Z5",
      ],
    },

    /** Two-digit state code the GSTIN is registered in. Derived, not typed. */
    stateCode: {
      type: String,
      required: true,
      uppercase: true,
      match: [/^[0-9]{2}$/, "A state code is two digits"],
    },

    /** Printed on the tax invoice as the place of supply. */
    placeOfSupply: {
      type: String,
      required: [true, "A place of supply is required on a tax invoice"],
      trim: true,
      maxlength: 120,
    },

    addressLine1: { type: String, required: true, trim: true, maxlength: 160 },
    addressLine2: { type: String, default: null, trim: true, maxlength: 160 },
    pincode: { type: String, default: null, trim: true, maxlength: 10 },
    email: { type: String, default: null, trim: true, maxlength: 160 },

    /** Signing authority's name, printed under the supplier block. */
    authorisedSignatory: { type: String, default: null, trim: true, maxlength: 160 },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/**
 * At most one profile.
 *
 * On a constant field, so the guarantee is structural: a second row cannot be
 * inserted whatever the application does.
 */
institutionTaxProfileSchema.index(
  { singleton: 1 },
  { unique: true, name: "one_institution_tax_profile" }
);

/** The state a student is in, used to decide CGST/SGST against IGST. */
institutionTaxProfileSchema.methods.supplyIsInterState = function supplyIsInterState(
  studentStateCode
) {
  if (!studentStateCode) return false;
  return String(studentStateCode).trim().toUpperCase() !== this.stateCode;
};

module.exports =
  mongoose.models.InstitutionTaxProfile ||
  mongoose.model("InstitutionTaxProfile", institutionTaxProfileSchema);
