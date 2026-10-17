/**
 * GST.
 *
 * The arithmetic is the easy part; the split is not. CGST and SGST inside the
 * state, IGST outside it, and the total is identical either way — so a wrong
 * split is invisible on the face of the document and is caught by an auditor
 * rather than by a student.
 */

const {
  splitStateTax,
  computeLineTax,
  computeInvoiceTax,
  checkHsn,
  checkRate,
} = require("../src/services/tax.service");

const { taxProfileSchema } = require("../src/validators/tax.validator");

describe("the state tax split", () => {
  it("splits into CGST and SGST inside the state", () => {
    const { components } = computeLineTax({ amount: 10000, taxPercent: 18 }, false);

    // 18% is 1800, which is 900 each.
    expect(components.cgst).toBe(900);
    expect(components.sgst).toBe(900);
    expect(components.igst).toBe(0);
    expect(components.cgstRate).toBe(9);
  });

  it("charges IGST at the full rate outside the state", () => {
    const { components } = computeLineTax({ amount: 10000, taxPercent: 18 }, true);

    // Not 900/900 — IGST is the whole 1800, because it goes to the centre and
    // is apportioned later. Splitting it would understate the invoice.
    expect(components.igst).toBe(1800);
    expect(components.cgst).toBe(0);
    expect(components.sgst).toBe(0);
    expect(components.igstRate).toBe(18);
  });

  /**
   * The halves must reconcile exactly.
   *
   * 101 paise of tax cannot be 50.5 each. Rounding both halves independently
   * gives 51 and 50 — which sum to 101, fine — but other amounts drift, and a
   * tax invoice whose halves do not add to the tax total is rejected.
   */
  it("always splits into two halves that sum to the tax", () => {
    for (const amount of [1, 2, 3, 99, 101, 999, 1001, 33333]) {
      const { cgst, sgst } = splitStateTax(amount);
      expect(cgst + sgst).toBe(amount);
    }
  });

  it("gives the odd paisa to SGST rather than rounding both", () => {
    expect(splitStateTax(101)).toEqual({ cgst: 50, sgst: 51 });
  });

  it("charges nothing when there is no tax", () => {
    const { taxAmount, components } = computeLineTax(
      { amount: 10000, taxPercent: 0 },
      false
    );
    expect(taxAmount).toBe(0);
    expect(components.cgst).toBe(0);
    expect(components.sgst).toBe(0);
  });
});

describe("invoice tax and its breakup", () => {
  const lines = [
    { description: "Tuition", amount: 100000, taxPercent: 18, hsnCode: "996311" },
    { description: "Library", amount: 20000, taxPercent: 5, hsnCode: "997311" },
  ];

  it("totals match the sum of the lines", () => {
    const result = computeInvoiceTax(lines, { interState: false });
    expect(result.subtotal).toBe(120000);
    expect(result.taxTotal).toBe(19000); // 18000 + 1000
    expect(result.total).toBe(139000);
  });

  /**
   * A GST invoice is checked against rate slabs, not against every line.
   *
   * Producing any other grouping makes the document harder to reconcile than
   * it needs to be, and the return has to be re-derived by hand.
   */
  it("groups the breakup by rate slab and HSN", () => {
    const result = computeInvoiceTax(lines, { interState: false });

    expect(result.breakup).toHaveLength(2);
    expect(result.breakup[0]).toMatchObject({
      rate: 5,
      hsnCode: "997311",
      taxableValue: 20000,
    });
    expect(result.breakup[1]).toMatchObject({
      rate: 18,
      hsnCode: "996311",
      taxableValue: 100000,
    });
    // Ascending by rate, as filed.
    expect(result.breakup[0].rate).toBeLessThan(result.breakup[1].rate);
  });

  it("merges lines sharing a rate and HSN", () => {
    const merged = computeInvoiceTax(
      [
        { description: "Tuition A", amount: 50000, taxPercent: 18, hsnCode: "996311" },
        { description: "Tuition B", amount: 50000, taxPercent: 18, hsnCode: "996311" },
      ],
      { interState: false }
    );

    expect(merged.breakup).toHaveLength(1);
    expect(merged.breakup[0].taxableValue).toBe(100000);
  });

  it("keeps different HSN codes apart even at the same rate", () => {
    const split = computeInvoiceTax(
      [
        { description: "Tuition", amount: 50000, taxPercent: 18, hsnCode: "996311" },
        { description: "Hostel", amount: 50000, taxPercent: 18, hsnCode: "99631101" },
      ],
      { interState: false }
    );

    expect(split.breakup).toHaveLength(2);
  });

  it("flips the whole breakup to IGST for an inter-state supply", () => {
    const result = computeInvoiceTax(lines, { interState: true });
    expect(result.interState).toBe(true);
    for (const group of result.breakup) {
      expect(group.igst).toBeGreaterThan(0);
      expect(group.cgst).toBe(0);
      expect(group.sgst).toBe(0);
    }
  });

  it("gives every slab a total equal to its taxable value plus its tax", () => {
    for (const group of computeInvoiceTax(lines, { interState: false }).breakup) {
      expect(group.total).toBe(group.taxableValue + group.igst + group.cgst + group.sgst);
    }
  });
});

describe("validating a line", () => {
  it("accepts HSN codes of any plausible length", () => {
    // Deliberately looser than the 2/4/6/8 hierarchy lengths: colleges carry
    // other lengths, and refusing one blocks a legitimate invoice for nothing.
    for (const code of ["99", "9963", "996311", "99631101"]) {
      expect(checkHsn(code).valid).toBe(true);
    }
  });

  it("refuses an HSN code with a letter in it", () => {
    // A trailing letter is the most common real typo, and it is caught here
    // rather than when a return is rejected.
    expect(checkHsn("9963X").valid).toBe(false);
    expect(checkHsn("99 6311").valid).toBe(false);
    expect(checkHsn("9").valid).toBe(false);
    expect(checkHsn("996311012").valid).toBe(false);
  });

  it("treats an absent HSN code as fine", () => {
    // A line with no tax needs no HSN code; the rule is enforced where tax is
    // present, not here.
    expect(checkHsn(null).valid).toBe(true);
    expect(checkHsn("").valid).toBe(true);
  });

  it("accepts only real GST rate slabs", () => {
    for (const rate of [0, 0.25, 3, 5, 12, 18, 28]) {
      expect(checkRate(rate).valid).toBe(true);
    }
    expect(checkRate(7).valid).toBe(false);
    expect(checkRate(100).valid).toBe(false);
  });
});

describe("the GST profile", () => {
  const valid = {
    legalName: "Demo College of Engineering",
    gstin: "29ABCDE1234F1Z5",
    placeOfSupply: "Karnataka",
    addressLine1: "1 College Road",
    pincode: "560001",
  };

  it("accepts a well-formed registration", () => {
    const result = taxProfileSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  /**
   * The state code is taken from the GSTIN rather than typed.
   *
   * Letting somebody also type it invites the two to disagree, and a profile
   * claiming state 07 with a GSTIN beginning 29 issues invoices stating the
   * wrong place of supply — wrong on the document, and invisible on it.
   */
  it("derives the state code from the GSTIN rather than trusting a typed one", () => {
    const result = taxProfileSchema.safeParse(valid);
    expect(result.data.stateCode).toBe("29");
  });

  it("refuses a malformed GSTIN", () => {
    const result = taxProfileSchema.safeParse({ ...valid, gstin: "NOTAGSTIN" });
    expect(result.success).toBe(false);
  });

  it("refuses a six-digit PIN code that is not six digits", () => {
    expect(taxProfileSchema.safeParse({ ...valid, pincode: "123" }).success).toBe(false);
  });

  it("refuses unknown keys, rather than ignoring them", () => {
    expect(taxProfileSchema.safeParse({ ...valid, gstIn: "typo" }).success).toBe(false);
  });
});
describe("tax on a real invoice", () => {
  const { resetDatabase, createUser, createStudent } = require("./helpers/factory");
  const { ROLES } = require("../src/config/constants");
  const financeService = require("../src/services/finance.service");
  const InstitutionTaxProfile = require("../src/models/InstitutionTaxProfile");
  const Student = require("../src/models/Student");

  let admin;

  beforeEach(async () => {
    await resetDatabase();
    // Accounts, not the super administrator: invoice management is not a
    // super-admin permission, and a test that reached for the broadest role
    // would not notice it being granted by accident.
    admin = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
  });

  const profile = (overrides = {}) => ({
    legalName: "Demo College of Engineering",
    gstin: "29ABCDE1234F1Z5",
    stateCode: "29",
    placeOfSupply: "Karnataka",
    addressLine1: "1 College Road",
    ...overrides,
  });

  it("issues a tax invoice that carries the GSTIN and the split", async () => {
    await InstitutionTaxProfile.create({ ...profile() });
    const { student } = await createStudent();

    const invoice = await financeService.createInvoice({
      user: admin,
      studentId: student._id,
      purpose: "Semester fee",
      items: [
        {
          description: "Tuition",
          quantity: 1,
          unitAmount: "100000.00",
          taxPercent: 18,
          hsnCode: "996311",
        },
      ],
    });

    // The snapshot, not a live read of the profile: a tax invoice must carry
    // the registration that was valid when it was issued.
    expect(invoice.taxProfile.gstin).toBe("29ABCDE1234F1Z5");
    expect(invoice.taxProfile.interState).toBe(false);
    expect(invoice.taxProfile.breakup).toHaveLength(1);

    const line = invoice.items[0];
    expect(line.taxComponents.cgst).toBe(900000);
    expect(line.taxComponents.sgst).toBe(900000);
    expect(line.taxComponents.igst).toBe(0);
  });

  it("charges IGST for a student in another state", async () => {
    await InstitutionTaxProfile.create({ ...profile() });
    const { student } = await createStudent();
    await Student.updateOne({ _id: student._id }, { $set: { stateCode: "07" } });

    const invoice = await financeService.createInvoice({
      user: admin,
      studentId: student._id,
      purpose: "Semester fee",
      items: [
        {
          description: "Tuition",
          quantity: 1,
          unitAmount: "100000.00",
          taxPercent: 18,
          hsnCode: "996311",
        },
      ],
    });

    expect(invoice.taxProfile.interState).toBe(true);
    expect(invoice.items[0].taxComponents.igst).toBe(1800000);
    expect(invoice.items[0].taxComponents.cgst).toBe(0);
    // The total is identical either way — which is exactly why a wrong split
    // is invisible on the face of the document.
    expect(invoice.total).toBe(11800000);
  });

  it("refuses a taxable line with no HSN code, once the college is registered", async () => {
    await InstitutionTaxProfile.create({ ...profile() });
    const { student } = await createStudent();

    await expect(
      financeService.createInvoice({
        user: admin,
        studentId: student._id,
        purpose: "Semester fee",
        items: [
          { description: "Tuition", quantity: 1, unitAmount: "1000.00", taxPercent: 18 },
        ],
      })
    ).rejects.toThrow(/HSN code/);
  });

  it("refuses a rate outside the GST slabs, once registered", async () => {
    await InstitutionTaxProfile.create({ ...profile() });
    const { student } = await createStudent();

    await expect(
      financeService.createInvoice({
        user: admin,
        studentId: student._id,
        purpose: "Semester fee",
        items: [
          {
            description: "Tuition",
            quantity: 1,
            unitAmount: "1000.00",
            taxPercent: 7,
            hsnCode: "996311",
          },
        ],
      })
    ).rejects.toThrow(/GST rate/);
  });

  /**
   * The compatibility decision.
   *
   * Refusing taxable invoices where the college has not registered would turn a
   * missing setup step into an outage, so the invoice is issued and marked
   * instead — but never silently.
   */
  it("still issues a taxable invoice when unregistered, with no GSTIN on it", async () => {
    const { student } = await createStudent();

    const invoice = await financeService.createInvoice({
      user: admin,
      studentId: student._id,
      purpose: "Semester fee",
      items: [
        { description: "Tuition", quantity: 1, unitAmount: "1000.00", taxPercent: 18 },
      ],
    });

    expect(invoice.total).toBe(118000);
    expect(invoice.taxProfile?.gstin ?? null).toBeNull();
  });

  it("leaves an untaxed invoice completely untouched", async () => {
    const { student } = await createStudent();

    const invoice = await financeService.createInvoice({
      user: admin,
      studentId: student._id,
      purpose: "Library deposit",
      items: [{ description: "Deposit", quantity: 1, unitAmount: "500.00" }],
    });

    expect(invoice.total).toBe(50000);
    expect(invoice.taxProfile?.gstin ?? null).toBeNull();
  });
});

describe("the tax-invoice flag reaches the client", () => {
  const { resetDatabase, createUser, createStudent } = require("./helpers/factory");
  const { ROLES } = require("../src/config/constants");
  const financeService = require("../src/services/finance.service");
  const InstitutionTaxProfile = require("../src/models/InstitutionTaxProfile");

  let accounts;

  beforeEach(async () => {
    await resetDatabase();
    accounts = await createUser({ role: ROLES.ACCOUNTS_ADMIN });
  });

  /**
   * This flag had already been lost once.
   *
   * It was assigned onto the document by the service, and `toJSON` builds its
   * output from schema paths only — so it was silently dropped on every route.
   * The invoice looked fine; the accounts department just could not tell a tax
   * invoice from an ordinary one.
   */
  it("survives serialisation, because the transform derives it", async () => {
    await InstitutionTaxProfile.create({
      legalName: "Demo College",
      gstin: "29ABCDE1234F1Z5",
      stateCode: "29",
      placeOfSupply: "Karnataka",
      addressLine1: "1 College Road",
    });
    const { student } = await createStudent();

    const invoice = await financeService.createInvoice({
      user: accounts,
      studentId: student._id,
      purpose: "Semester fee",
      items: [
        {
          description: "Tuition",
          quantity: 1,
          unitAmount: "100000.00",
          taxPercent: 18,
          hsnCode: "996311",
        },
      ],
    });

    const serialised = invoice.toJSON();
    expect(serialised.isTaxInvoice).toBe(true);
  });

  it("reports false for a taxable invoice with no registration", async () => {
    const { student } = await createStudent();

    const invoice = await financeService.createInvoice({
      user: accounts,
      studentId: student._id,
      purpose: "Semester fee",
      items: [
        { description: "Tuition", quantity: 1, unitAmount: "1000.00", taxPercent: 18 },
      ],
    });

    // Still a valid bill. Just not a tax invoice — and it has to say so.
    expect(invoice.toJSON().isTaxInvoice).toBe(false);
  });
});
