/**
 * Invoice — an amount a student owes.
 *
 * ## The total is derived, never supplied
 *
 * `subtotal`, `taxTotal` and `total` are computed from `items` by
 * `finance.service.calculateTotals()` and written together. There is no
 * endpoint that accepts a client-supplied total, so the amount a student is
 * charged is always a function of the line items the institution defined.
 *
 * ## Why an invoice is not mutated after issue
 *
 * Once `status` leaves DRAFT, the amounts are frozen. A corrected invoice is a
 * credit note plus a new invoice, not an edit — otherwise a payment already
 * taken against the old total would no longer reconcile.
 */

const mongoose = require("mongoose");

const { INVOICE_STATUS, INVOICE_STATUS_VALUES } = require("../config/constants");

const invoiceSchema = new mongoose.Schema(
  {
    /** Human-readable reference, e.g. "INV-2026-000042". */
    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Invoice must belong to a student"],
      index: true,
    },

    /**
     * What the invoice is for: a request type, a certificate, an admission
     * charge. Free-form because the institution defines its own fee heads.
     */
    purpose: {
      type: String,
      required: [true, "Purpose is required"],
      trim: true,
      maxlength: [300, "Purpose cannot exceed 300 characters"],
    },

    /** Linked request, when the fee arises from one. */
    request: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Request",
      default: null,
      index: true,
    },

    /**
     * Line items. Amounts are minor units (paise) — integers, never floats.
     * See utils/money.js.
     */
    items: {
      type: [
        {
          description: {
            type: String,
            required: [true, "Item description is required"],
            trim: true,
            maxlength: [300, "Item description cannot exceed 300 characters"],
          },
          /** Quantity is an integer so that quantity × amount stays exact. */
          quantity: { type: Number, required: true, min: 1, max: 999 },
          /** Unit price in minor units. */
          unitAmount: { type: Number, required: true, min: 0 },
          /** Line total in minor units; quantity × unitAmount. */
          amount: { type: Number, required: true, min: 0 },
          /** Tax percentage applied to this line, e.g. 18 for GST. */
          taxPercent: { type: Number, default: 0, min: 0, max: 100 },
          /**
           * Harmonised System of Nomenclature code.
           *
           * Required on a tax invoice and meaningless on a non-tax one, so it
           * is optional here and required by the validator when tax is present.
           */
          hsnCode: { type: String, default: null, trim: true, maxlength: 8 },
          /**
           * The CGST/SGST/IGST split for this line, computed at issue time.
           *
           * Stored, not recomputed on read. The split depends on the state the
           * student was in on the day of issue, and re-deriving it later — after
           * the student's address has changed — produces a tax invoice that no
           * longer matches the one that was issued.
           */
          taxComponents: {
            igst: { type: Number, default: 0, min: 0 },
            cgst: { type: Number, default: 0, min: 0 },
            sgst: { type: Number, default: 0, min: 0 },
            igstRate: { type: Number, default: 0 },
            cgstRate: { type: Number, default: 0 },
            sgstRate: { type: Number, default: 0 },
          },
          /** Tax amount in minor units for this line. */
          taxAmount: { type: Number, default: 0, min: 0 },
        },
      ],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "An invoice must have at least one line item",
      },
    },

    /** Sum of line amounts, before tax. Minor units. */
    subtotal: { type: Number, required: true, min: 0 },

    /** Sum of line taxes. Minor units. */
    taxTotal: { type: Number, required: true, min: 0, default: 0 },

    /** subtotal + taxTotal − discount. The authoritative amount. */
    total: { type: Number, required: true, min: 0 },

    discount: { type: Number, default: 0, min: 0 },

    currency: {
      type: String,
      required: true,
      default: "INR",
      enum: { values: ["INR"], message: "`{VALUE}` is not a supported currency" },
    },

    status: {
      type: String,
      required: true,
      enum: {
        values: INVOICE_STATUS_VALUES,
        message: "`{VALUE}` is not a valid invoice status",
      },
      default: INVOICE_STATUS.DRAFT,
      index: true,
    },

    /** Total of payments verified against this invoice. Minor units. */
    paidAmount: { type: Number, default: 0, min: 0 },

    /** total − paidAmount − refundedAmount. What is still owed. */
    balanceDue: { type: Number, required: true, min: 0 },

    issuedAt: { type: Date, default: null },
    dueAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    /** Set once the invoice is fully settled, so a partial payment cannot pass. */
    isFullyPaid: { type: Boolean, default: false, index: true },

    /** Who issued it. */
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    /*
     * Payment schedule.
     *
     * ## Instalments split the total; they never restate it
     *
     * `total` stays the amount the student owes. The instalments are how it is
     * paid. Recomputing the total from the schedule would mean a rounding
     * difference on the last instalment becomes a different invoice total, and
     * the student is charged for a rounding artefact.
     *
     * ## The last instalment absorbs the remainder, by design
     *
     * Splitting 1000 into three gives 333.33 × 3. The first two are floored and
     * the last takes what is left, so the schedule always sums to exactly
     * `total`. Floating-point thirds would not.
     */
    instalments: {
      type: [
        {
          _id: false,
          sequence: { type: Number, required: true, min: 1 },
          /** Minor units. Sums with the rest to exactly the invoice total. */
          amount: { type: Number, required: true, min: 0 },
          dueAt: { type: Date, required: true },
          paidAt: { type: Date, default: null },
          paidAmount: { type: Number, default: 0, min: 0 },
        },
      ],
      default: [],
    },

    /**
     * Late-payment penalty policy, snapshotted onto the invoice.
     *
     * Snapshotted rather than looked up at payment time on purpose. If the
     * college changes its penalty rate next month, invoices issued this month
     * must still be governed by the terms that were on them when the student
     * agreed — otherwise a student is charged a rate nobody told them about.
     */
    penalty: {
      /** Basis points of the overdue amount per period. 100 bps = 1%. */
      rateBps: { type: Number, default: 0, min: 0, max: 10000 },
      /** Days between chargeable periods. 30 = monthly. */
      periodDays: { type: Number, default: 30, min: 1, max: 365 },
      graceDays: { type: Number, default: 0, min: 0, max: 90 },
      /** Ceiling as a share of the invoice total, in basis points. 2000 = 20%. */
      capBps: { type: Number, default: 0, min: 0, max: 10000 },
      /** Charges already applied, so a recalculation never double-charges. */
      chargedAmount: { type: Number, default: 0, min: 0 },
      chargedAt: { type: Date, default: null },
    },

    /**
     * The supplier's GST details, snapshotted onto the invoice.
     *
     * The same reasoning as the penalty policy: a tax invoice must carry the
     * GSTIN and legal name that were valid when it was issued. Reading them from
     * the live profile at print time means a corrected profile silently changes
     * a document that has already been filed.
     */
    taxProfile: {
      legalName: { type: String, default: null },
      gstin: { type: String, default: null },
      stateCode: { type: String, default: null },
      placeOfSupply: { type: String, default: null },
      addressLine1: { type: String, default: null },
      addressLine2: { type: String, default: null },
      pincode: { type: String, default: null },
      /** Whether this invoice was taxed as an inter-state supply. */
      interState: { type: Boolean, default: false },
      reverseCharge: { type: Boolean, default: false },
      /** The rate-slab breakup, as printed on a tax invoice. */
      breakup: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },

    notes: {
      type: String,
      trim: true,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
    },
    isDemo: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;

        /*
         * Whether this can be filed as a tax invoice.
         *
         * Computed here rather than assigned by a service, because `toJSON`
         * builds its output from schema paths only: anything a service tacked
         * onto the document is silently dropped, and this flag had already been
         * lost that way once. Deriving it in the transform makes it impossible
         * for it to go missing on any route that serialises an invoice.
         *
         * An invoice with tax and no GSTIN is a real document and a perfectly
         * legitimate bill — it is just not a *tax* invoice.
         */
        ret.isTaxInvoice = Boolean(ret.taxProfile?.gstin);

        return ret;
      },
    },
  }
);

// The student's billing history.
invoiceSchema.index({ student: 1, createdAt: -1 });

// Outstanding-fee reports.
invoiceSchema.index({ student: 1, status: 1, balanceDue: 1 });

// "What is overdue" sweeps.
invoiceSchema.index({ status: 1, dueAt: 1 });

const Invoice = mongoose.model("Invoice", invoiceSchema);

module.exports = Invoice;
