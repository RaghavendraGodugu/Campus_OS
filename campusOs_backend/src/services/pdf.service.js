/**
 * Certificate PDF rendering.
 *
 * The document is produced **server-side** from the database record. It is
 * never assembled from anything a client supplied as the certificate body: the
 * name, roll number, programme and enrolment date are read from the Student
 * document, so a student cannot get a PDF that asserts facts about themselves
 * which the institution does not hold.
 *
 * Rendering is deliberately synchronous and buffered. A stream piped straight to
 * a response would work but leaves a half-written file if the request aborts;
 * generating the full buffer first means storage only ever receives a complete
 * document.
 */

const PDFDocument = require("pdfkit");

/** Render a PDF and resolve with its bytes. */
function renderToBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: "CampusOS Certificate",
        Author: "CampusOS",
        Creator: "CampusOS Certificate Service",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      build(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/** Human-readable label for a certificate type. */
const TYPE_LABELS = {
  BONAFIDE: "Bonafide Certificate",
  STUDY: "Certificate of Study",
  TRANSFER: "Transfer Certificate",
  MIGRATION: "Migration Certificate",
  CHARACTER: "Character Certificate",
  COURSE_COMPLETION: "Course Completion Certificate",
  NO_DUES: "No Dues Certificate",
  INTERNSHIP: "Internship Certificate",
  TRANSCRIPT: "Academic Transcript",
};

/**
 * Render the certificate.
 *
 * @param {object} params
 * @param {object} params.certificate Certificate document.
 * @param {object} params.student     Student document (source of truth for identity).
 * @param {object} params.department  Department document.
 * @param {object} params.program     Programme document.
 * @param {object} [params.issuer]    Issuing officer, for the signature block.
 * @param {object} [params.institution]
 * @returns {Promise<Buffer>}
 */
async function renderCertificate({
  certificate,
  student,
  department,
  program,
  issuer,
  institution = {},
}) {
  const { CERTIFICATE_TYPES } = require("../models/Certificate");

  const studentName = student?.user?.fullName ?? institution.studentName ?? "Student";
  const rollNumber = student?.rollNumber ?? "—";
  const programme = program?.name ?? "—";
  const level = program?.level ?? "—";
  const departmentName = department?.name ?? "—";
  const enrolment = student?.enrolmentDate
    ? new Date(student.enrolmentDate).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  const label = TYPE_LABELS[certificate.type] ?? "Certificate";
  const institutionName = institution.name ?? "CampusOS Institution";

  return renderToBuffer((doc) => {
    // ===== Border =====
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    doc.save();
    doc
      .lineWidth(2)
      .strokeColor("#1e3a5f")
      .rect(40, 40, pageWidth - 80, pageHeight - 80)
      .stroke();
    doc
      .lineWidth(0.5)
      .strokeColor("#94a3b8")
      .rect(48, 48, pageWidth - 96, pageHeight - 96)
      .stroke();
    doc.restore();

    // ===== Heading =====
    doc
      .fillColor("#1e3a5f")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(institutionName.toUpperCase(), 0, 70, {
        align: "center",
        characterSpacing: 2,
      });

    doc.moveDown(0.6);
    doc.fontSize(26).font("Helvetica-Bold").text(label, 0, doc.y, { align: "center" });

    doc.moveDown(0.4);
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#64748b")
      .text(`Reference ${certificate.reference}`, 0, doc.y, { align: "center" });

    doc.moveDown(2);

    // ===== Body =====
    doc
      .fillColor("#0f172a")
      .fontSize(11)
      .font("Helvetica")
      .text("This is to certify that", 0, doc.y, { align: "center" });

    doc.moveDown(0.6);
    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .fillColor("#1e3a5f")
      .text(studentName, 0, doc.y, { align: "center" });

    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#475569")
      .text(`Roll Number ${rollNumber}`, 0, doc.y, { align: "center" });

    doc.moveDown(1.4);
    doc
      .fontSize(11)
      .font("Helvetica")
      .fillColor("#0f172a")
      .text("of", 0, doc.y, { align: "center" });

    doc.moveDown(0.5);
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .fillColor("#1e3a5f")
      .text(programme, 0, doc.y, { align: "center" });

    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#475569")
      .text(`${departmentName} · ${level}`, 0, doc.y, { align: "center" });

    doc.moveDown(1.2);
    doc
      .fontSize(11)
      .font("Helvetica")
      .fillColor("#0f172a")
      .text(
        `has been enrolled since ${enrolment} and is a bon fide student of the institution.`,
        70,
        doc.y,
        { align: "center", width: pageWidth - 140 }
      );

    if (certificate.purpose) {
      doc.moveDown(0.8);
      doc
        .fontSize(10)
        .font("Helvetica-Oblique")
        .fillColor("#475569")
        .text(
          `Issued at the request of the student for: ${certificate.purpose}`,
          70,
          doc.y,
          {
            align: "center",
            width: pageWidth - 140,
          }
        );
    }

    // ===== Footer =====
    // Anchored to the bottom of the page rather than to the flowing cursor, so
    // a long purpose string cannot push the signature block off the page.
    const footerTop = pageHeight - 180;
    const signatureX = 70;
    const signatureWidth = 200;
    const verifyX = 330;
    const verifyWidth = pageWidth - verifyX - 70;

    doc
      .strokeColor("#cbd5e1")
      .moveTo(signatureX, footerTop)
      .lineTo(signatureX + signatureWidth, footerTop)
      .stroke();

    doc
      .font("Helvetica-Bold")
      .fillColor("#1e3a5f")
      .fontSize(10)
      .text(issuer?.fullName ?? "Authorised Officer", signatureX, footerTop - 24, {
        width: signatureWidth,
        align: "center",
      });

    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#64748b")
      .text("Authorised Signatory", signatureX, footerTop + 8, {
        width: signatureWidth,
        align: "center",
      });

    // Verification block, constrained to its own column so it cannot overflow
    // the right margin when the code is long.
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#64748b")
      .text("VERIFICATION CODE", verifyX, footerTop - 24, {
        width: verifyWidth,
        align: "center",
        characterSpacing: 1,
      });

    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor("#1e3a5f")
      .text(certificate.verificationCode ?? "—", verifyX, footerTop - 6, {
        width: verifyWidth,
        align: "center",
      });

    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#94a3b8")
      .text(
        `Issued ${new Date(certificate.issuedAt ?? Date.now()).toISOString().slice(0, 10)}`,
        verifyX,
        footerTop + 14,
        { width: verifyWidth, align: "center" }
      );

    // Disclaimer: a PDF is not self-authenticating.
    doc
      .font("Helvetica-Oblique")
      .fontSize(7)
      .fillColor("#94a3b8")
      .text(
        "This certificate is valid only when its verification code is confirmed against the issuing institution's records. Possession of this document is not proof of authenticity.",
        70,
        pageHeight - 88,
        { width: pageWidth - 140, align: "center" }
      );

    // ===== Page metadata =====
    // Recorded so a printed copy can be traced to the record that produced it.
    doc.info.Subject = `${label} ${certificate.reference}`;
    doc.info.Keywords = `campusos;certificate;${certificate.reference};${certificate.verificationCode ?? ""}`;

    void CERTIFICATE_TYPES;
  });
}

module.exports = { renderCertificate, renderToBuffer, TYPE_LABELS };
