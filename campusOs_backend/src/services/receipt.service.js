/**
 * Payment receipts.
 *
 * ## A receipt is issued once, when the money settles
 *
 * Issued from `creditInvoice()` — the single path that marks an invoice paid —
 * so a receipt exists for every captured payment and for no other reason. It is
 * never generated on request, because a receipt regenerated later would not be
 * the document that was given to the student at the time.
 *
 * ## Amounts come from stored integers
 *
 * The PDF renders `payment.capturedAmount`, not anything re-derived from the
 * invoice at render time, so a receipt always shows what was actually captured
 * even if the invoice has since been refunded or adjusted.
 *
 * ## Honest about the mode
 *
 * A receipt says whether it documents a live payment, a Razorpay test
 * transaction, or a local mock. A receipt that blurs those is how a test
 * payment ends up filed as a real one.
 */

const Payment = require("../models/Payment");
const Invoice = require("../models/Invoice");
const Student = require("../models/Student");
const Department = require("../models/Department");
const Program = require("../models/Program");
const money = require("../utils/money");
const { getStorage } = require("../config/storage");
const { renderToBuffer } = require("./pdf.service");
const { ApiError } = require("../utils/ApiError");
const { logger } = require("../config/logger");
const { nextReference } = require("./finance.service");

/**
 * Issue a receipt for a captured payment.
 *
 * Idempotent: a payment that already has a receipt returns it unchanged, so a
 * repeated capture webhook cannot produce a second document.
 *
 * @param {object} params
 * @param {string} params.paymentId
 * @returns {Promise<{receiptNumber: string, storageKey: string, alreadyIssued: boolean}|null>}
 */
async function issueReceipt({ paymentId }) {
  const payment = await Payment.findById(paymentId);

  if (!payment) {
    logger.error({ paymentId }, "Cannot issue a receipt: payment not found");
    return null;
  }

  // Idempotency: the unique receiptNumber is the guard.
  if (payment.receiptNumber) {
    return {
      receiptNumber: payment.receiptNumber,
      storageKey: payment.receipt.storageKey,
      alreadyIssued: true,
    };
  }

  if (payment.status !== "PAID") {
    // Only a settled payment warrants a receipt.
    return null;
  }

  const [invoice, student] = await Promise.all([
    Invoice.findById(payment.invoice).lean(),
    Student.findById(payment.student).populate("user", "fullName").lean(),
  ]);

  if (!invoice || !student) {
    logger.error({ paymentId }, "Cannot issue a receipt: invoice or student missing");
    return null;
  }

  const [department, program] = await Promise.all([
    student.department ? Department.findById(student.department).lean() : null,
    student.program ? Program.findById(student.program).lean() : null,
  ]);

  const receiptNumber = await nextReference("receipt", "RCP", new Date().getFullYear());

  const issuedAt = payment.verifiedAt ?? new Date();

  const buffer = await renderReceiptPdf({
    receiptNumber,
    payment: payment.toObject(),
    invoice,
    student,
    department,
    program,
    issuedAt,
  });

  const storage = getStorage();
  const stored = await storage.save(buffer, {
    folder: "receipts",
    filename: `${receiptNumber}.pdf`,
    mimeType: "application/pdf",
  });

  // Conditional on receiptNumber still being null, so two concurrent
  // invocations cannot both issue a receipt for the same payment.
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, receiptNumber: null },
    {
      $set: {
        receiptNumber,
        receipt: {
          storageKey: stored.key,
          originalName: `${receiptNumber}.pdf`,
          mimeType: "application/pdf",
          bytes: stored.bytes,
          adapter: stored.adapter,
          issuedAt,
        },
      },
    },
    { new: true }
  );

  if (!updated) {
    // Another invocation won. The existing receipt is authoritative.
    const current = await Payment.findById(payment._id).lean();
    logger.warn({ paymentId }, "Receipt already issued by a concurrent request");
    return {
      receiptNumber: current.receiptNumber,
      storageKey: current.receipt.storageKey,
      alreadyIssued: true,
    };
  }

  logger.info(
    { paymentId, receiptNumber, adapter: stored.adapter },
    "Payment receipt issued"
  );

  return { receiptNumber, storageKey: stored.key, alreadyIssued: false };
}

/** Mode shown on the receipt face. */
function modeLabel(mode) {
  switch (mode) {
    case "LIVE":
      return { text: "PAID", colour: "#166534", tint: "#dcfce7" };
    case "TEST":
      return { text: "TEST PAYMENT — NO REAL MONEY", colour: "#92400e", tint: "#fef3c7" };
    default:
      return {
        text: "MOCK PAYMENT — NOT A REAL TRANSACTION",
        colour: "#991b1b",
        tint: "#fee2e2",
      };
  }
}

/** Render the receipt PDF and resolve with its bytes. */
async function renderReceiptPdf({
  receiptNumber,
  payment,
  invoice,
  student,
  department,
  program,
  issuedAt,
}) {
  const pageWidth = 595.28; // A4 at 72dpi
  const pageHeight = 841.89;
  const mode = modeLabel(payment.mode ?? "MOCK");

  const amountInPaise = payment.capturedAmount ?? payment.amount;
  const formattedAmount = money.formatForDocument(amountInPaise);
  const formattedInvoiceTotal = money.formatForDocument(invoice.total);
  const formattedBalance = money.formatForDocument(invoice.balanceDue);

  const row = (label, value, opts = {}) =>
    `${label}: ${value}${opts.suffix ? "  " + opts.suffix : ""}`;

  return renderToBuffer((doc) => {
    // ===== Border =====
    doc.save();
    doc
      .lineWidth(2)
      .strokeColor("#1e3a5f")
      .rect(40, 40, pageWidth - 80, pageHeight - 80)
      .stroke();
    doc.restore();

    // ===== Mode banner =====
    // A receipt for anything other than a live payment says so, prominently,
    // at the top where it cannot be cropped or skimmed past.
    doc.save();
    doc.roundedRect(60, 60, pageWidth - 120, 34, 6).fill(mode.tint);
    doc
      .fillColor(mode.colour)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(mode.text, 60, 70, { width: pageWidth - 120, align: "center" });
    doc.restore();

    // ===== Heading =====
    doc.moveDown(2.2);
    doc
      .fillColor("#1e3a5f")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text("PAYMENT RECEIPT", 0, doc.y, { align: "center" });

    doc.moveDown(0.3);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#475569")
      .text(receiptNumber, 0, doc.y, { align: "center" });

    // ===== Amount panel =====
    doc.moveDown(1.8);
    const panelTop = doc.y;
    doc.save();
    doc.roundedRect(70, panelTop, pageWidth - 140, 74, 8).fill("#f8fafc");
    doc.restore();

    doc
      .fillColor("#64748b")
      .font("Helvetica")
      .fontSize(8)
      .text("AMOUNT RECEIVED", 70, panelTop + 12, {
        width: pageWidth - 140,
        align: "center",
        characterSpacing: 1,
      });

    doc
      .fillColor("#0f172a")
      .font("Helvetica-Bold")
      .fontSize(28)
      .text(formattedAmount, 70, panelTop + 28, {
        width: pageWidth - 140,
        align: "center",
      });

    doc.y = panelTop + 86;

    // ===== Details table =====
    const leftX = 90;
    const rightX = 320;
    const tableTop = doc.y + 6;

    const rows = [
      ["Received from", student.user?.fullName ?? "—"],
      ["Roll number", student.rollNumber ?? "—"],
      ["Programme", program?.name ?? "—"],
      ["Department", department?.name ?? "—"],
      ["Invoice", `${invoice.reference}  (total ${formattedInvoiceTotal})`],
      ["Balance after payment", formattedBalance],
      ["Payment reference", payment.razorpayPaymentId ?? "—"],
      ["Order reference", payment.razorpayOrderId],
      ["Method", (payment.method ?? "—").toUpperCase()],
      [
        "Date",
        new Date(issuedAt).toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      ],
    ];

    let cursorY = tableTop;
    rows.forEach(([label, value], index) => {
      const column = index % 2;
      const x = column === 0 ? leftX : rightX;
      if (column === 0 && index > 0) {
        cursorY += 30;
      }

      doc
        .fillColor("#64748b")
        .font("Helvetica")
        .fontSize(8)
        .text(label.toUpperCase(), x, cursorY, { width: 200, characterSpacing: 0.5 });
      doc
        .fillColor("#0f172a")
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .text(String(value), x, cursorY + 12, { width: 200 });
    });

    const footerY = pageHeight - 200;

    // ===== Total =====
    doc
      .fillColor("#0f172a")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("TOTAL RECEIVED", leftX, footerY, { width: 200, align: "center" });
    doc
      .fillColor("#166534")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text(formattedAmount, leftX, footerY + 16, { width: 200, align: "center" });

    doc
      .strokeColor("#cbd5e1")
      .moveTo(rightX, footerY + 44)
      .lineTo(rightX + 190, footerY + 44)
      .stroke();
    doc
      .fillColor("#64748b")
      .font("Helvetica")
      .fontSize(8)
      .text("Authorised by the institution", rightX, footerY + 52, {
        width: 190,
        align: "center",
      });

    // ===== Disclaimer =====
    doc.moveDown(0);
    doc
      .font("Helvetica-Oblique")
      .fontSize(7)
      .fillColor("#94a3b8")
      .text(
        payment.mode === "LIVE"
          ? "This receipt is generated by CampusOS on settlement of the payment described above. Retain it for your records."
          : "This document records a simulated payment and is not evidence of a real transaction. It must not be used for any financial, tax or reimbursement purpose.",
        70,
        pageHeight - 120,
        { width: pageWidth - 140, align: "center" }
      );

    doc.info.Subject = `Payment Receipt ${receiptNumber}`;
    doc.info.Keywords = `campusos;receipt;${receiptNumber};${invoice.reference};${payment.mode}`;

    void row;
  });
}

/**
 * Resolve a receipt for download.
 *
 * Mirrors the certificate rule: authorization is decided here, from the stored
 * record, before any bytes or URL exist.
 *
 * @returns {Promise<{storageKey: string, filename: string}>}
 */
async function resolveReceipt({ paymentId, user, reference }) {
  const condition = reference
    ? { receiptNumber: String(reference).toUpperCase() }
    : { _id: paymentId };

  const payment = await Payment.findOne(condition).select(
    "student status receipt receiptNumber invoice amount capturedAmount"
  );

  if (!payment || !payment.receipt?.storageKey) {
    throw ApiError.notFound("Receipt not found");
  }

  if (!canReadReceipt(payment, user)) {
    // 404, not 403: the existence of a receipt is not disclosed.
    throw ApiError.notFound("Receipt not found");
  }

  return {
    storageKey: payment.receipt.storageKey,
    filename: payment.receipt.originalName ?? `${payment.receiptNumber}.pdf`,
    receiptNumber: payment.receiptNumber,
    adapter: payment.receipt.adapter,
  };
}

function canReadReceipt(payment, user) {
  if (user.role === "STUDENT") {
    return payment.student?.toString() === user.student?.toString();
  }
  // Accounts staff see all financial records; other staff roles do not.
  const perm = require("../utils/permissions");
  return perm.userHasPermission(user, perm.P.PAYMENT_READ_INSTITUTION);
}

/** Receipt bytes, fetched server-side from whatever storage adapter is configured. */
async function readReceiptBytes({ storageKey, mimeType } = {}) {
  const storage = getStorage();
  return { buffer: await storage.read(storageKey, { mimeType }) };
}

module.exports = {
  issueReceipt,
  renderReceiptPdf,
  resolveReceipt,
  readReceiptBytes,
  canReadReceipt,
  modeLabel,
};
