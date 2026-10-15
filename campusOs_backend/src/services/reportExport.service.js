/**
 * Report export.
 *
 * ## Why the export is generated from the report, not from the database
 *
 * `GET /reports/requests` and `GET /reports/requests/export` must never
 * disagree. If the export queried Mongo directly, a scope bug in one and not the
 * other would leak one department's requests into another department's
 * spreadsheet — and a spreadsheet is the thing people actually circulate.
 *
 * So the export reuses the very same service functions and only differs in how
 * the result is serialised. The scope check, the "available: false" answer for a
 * department-scoped caller with no department, the period resolution — all of it
 * is the code the screen already runs.
 *
 * ## CSV is RFC 4180, and that is not a detail
 *
 * A request title routinely contains a comma, a quote or a newline: "Bonafide
 * certificate, urgently" must not become two columns. Fields are quoted when
 * they need it, quotes inside a field are doubled, and a cell starting with a
 * formula character is prefixed, because `=SUM(...)` in a downloaded file is
 * executed by Excel and by Google Sheets.
 *
 * ## The spreadsheet-injection guard
 *
 * A student can put anything in a request title. A file that renders that in
 * their colleague's spreadsheet must not be able to run a formula in it. So a
 * leading `=`, `+`, `-`, `@`, tab or carriage return is prefixed with a single
 * quote, which both spreadsheets treat as "this is text".
 */

const PDFDocument = require("pdfkit");

const money = require("../utils/money");

/** Characters a spreadsheet treats as the start of a formula. */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Make one cell safe and quote it if it needs it.
 *
 * @param {unknown} value
 * @returns {string}
 */
function csvCell(value) {
  if (value === null || value === undefined) return "";

  let text = value instanceof Date ? value.toISOString() : String(value);

  // Neutralise a formula before quoting: the leading quote has to be the very
  // first character, or the sheet still evaluates it.
  if (FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    text = `'${text}`;
  }

  // Quote when the value contains a delimiter, a quote or a line break. The
  // inner quotes are doubled, which is what RFC 4180 requires.
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/**
 * Build a CSV from a header row and a body.
 *
 * @param {string[]} headers
 * @param {Array<Array<unknown>>} rows
 * @returns {string}
 */
function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  // Trailing newline: some tools silently drop the last row without one.
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Shape a report into a table.
 *
 * Every report shares the same envelope — scope, period, availability, then
 * whatever figures it has — so the export can be uniform rather than each
 * report carrying its own idea of columns.
 *
 * @param {string} kind
 * @param {object} report
 * @param {Array<{label: string, value: string|number}>} meta
 * @returns {{title: string, headers: string[], rows: Array<Array<string|number>>, notes: string[]}}
 */
function toTable(kind, report, meta) {
  const period = report.period ?? {};
  const notes = [];

  const dateOf = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

  /**
   * Metadata as ordinary rows rather than one wide header line.
   *
   * A single eight-cell row would have to be truncated to fit the table width,
   * and the period is exactly the part that must never be dropped: a file that
   * circulates with no statement of what it covers is a file someone will
   * misattribute to the wrong term.
   */
  const metaRows = [
    ["report", kind],
    ["scope", report.scope ?? "institution"],
    ["from", dateOf(period.from)],
    ["to", dateOf(period.to)],
  ];

  if (report.available === false) {
    // The honest export of "you cannot see this" is a file that says so, not an
    // empty table that reads as "nothing happened".
    const reason = report.reason ?? "This report is not available at your access level.";
    notes.push(reason);

    // The reason goes in the rows, not only in the PDF notes: a CSV has nowhere
    // to put a footnote, and a file that says nothing but "scope: department"
    // reads as "nothing happened this period" — which is a different and much
    // worse claim than "you cannot see this".
    return {
      title: `CampusOS — ${kind} report`,
      headers: ["Field", "Value"],
      rows: [...metaRows, ["NOT AVAILABLE", reason]],
      notes,
    };
  }

  const rows = [...metaRows];

  for (const entry of meta) {
    rows.push([entry.label, entry.value]);
  }

  const t = report.totals ?? {};
  if (Object.keys(t).length) {
    for (const [key, value] of Object.entries(t)) {
      rows.push([`total.${key}`, value]);
    }
  }

  for (const [key, value] of Object.entries(report.byStatus ?? {})) {
    rows.push([`byStatus.${key}`, value]);
  }

  for (const item of report.byType ?? []) {
    rows.push([
      "byType.label",
      item.label ?? item.name ?? "",
      "byType.count",
      item.count ?? 0,
    ]);
  }

  for (const item of report.byDepartment ?? []) {
    rows.push([
      "byDepartment.label",
      item.label ?? item.name ?? "",
      "byDepartment.count",
      item.count ?? 0,
    ]);
  }

  for (const item of report.byProgramme ?? []) {
    rows.push([
      "byProgramme.label",
      item.label ?? item.name ?? "",
      "byProgramme.count",
      item.count ?? 0,
    ]);
  }

  if (report.finance) {
    for (const [key, value] of Object.entries(report.finance)) {
      if (typeof value === "number" && key.toLowerCase().includes("amount")) {
        rows.push([`finance.${key}`, money.format(value)]);
      } else if (typeof value !== "object") {
        rows.push([`finance.${key}`, value]);
      }
    }
  }

  if (Array.isArray(report.rows)) {
    for (const entry of report.rows) {
      rows.push(
        Object.values(entry).map((value) =>
          typeof value === "object" ? JSON.stringify(value) : value
        )
      );
    }
  }

  const headers = ["Section", "Value", "Section", "Value"];

  // Every row padded to the header width. A ragged row shifts every value after
  // the gap one column to the right, which is the classic "the numbers are in
  // the wrong place" spreadsheet bug.
  const normalised = rows.map((row) => {
    const cells = row.slice(0, headers.length);
    while (cells.length < headers.length) cells.push("");
    return cells;
  });

  return {
    title: `CampusOS — ${kind} report`,
    headers,
    rows: normalised,
    notes,
  };
}

/**
 * Render a table as a PDF.
 *
 * @param {{title: string, headers: string[], rows: Array<Array<unknown>>, notes: string[]}} table
 * @param {{landscape?: boolean}} [options]
 * @returns {Promise<Buffer>}
 */
function toPdf(table, { landscape = true } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: landscape ? "landscape" : "portrait",
      margin: 36,
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const columns = table.headers.length;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const columnWidth = pageWidth / columns;

    doc.font("Helvetica-Bold").fontSize(15).text(table.title);
    doc.moveDown(0.3);
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor("#555555")
      .text(`Generated ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`)
      .fillColor("#000000");
    doc.moveDown(0.8);

    for (const note of table.notes) {
      doc.font("Helvetica-Oblique").fontSize(9).fillColor("#8a3b12").text(note);
      doc.moveDown(0.3);
    }
    if (table.notes.length) doc.moveDown(0.5);

    // A row that would cross the page boundary starts a new page. Without this
    // a long export silently loses its header on every page after the first.
    const needsNewPage = (rowHeight) =>
      doc.y + rowHeight > doc.page.height - doc.page.margins.bottom;

    const drawHeader = () => {
      if (needsNewPage(26)) doc.addPage();
      const y = doc.y;
      doc.rect(doc.page.margins.left, y - 2, pageWidth, 16).fill("#eef4f0");
      doc.fillColor("#000000").font("Helvetica-Bold").fontSize(8.5);
      table.headers.forEach((header, index) => {
        doc.text(header, doc.page.margins.left + index * columnWidth + 4, y + 1, {
          width: columnWidth - 8,
          ellipsis: true,
        });
      });
      doc.y = y + 18;
    };

    drawHeader();

    doc.font("Helvetica").fontSize(8.5);
    for (const row of table.rows) {
      const cells = row.map((value) =>
        value === null || value === undefined ? "" : String(value)
      );
      // Pad so every row has the same number of columns; a ragged row shifts
      // every value after it one column to the right.
      while (cells.length < columns) cells.push("");

      const rowHeight = 16;
      if (needsNewPage(rowHeight)) {
        doc.addPage();
        drawHeader();
      }

      const y = doc.y;
      cells.forEach((cell, index) => {
        doc.text(cell, doc.page.margins.left + index * columnWidth + 4, y + 2, {
          width: columnWidth - 8,
          ellipsis: true,
        });
      });
      doc.y = y + rowHeight;

      doc
        .moveTo(doc.page.margins.left, doc.y - 3)
        .lineTo(doc.page.margins.left + pageWidth, doc.y - 3)
        .lineWidth(0.4)
        .strokeColor("#dddddd")
        .stroke();
    }

    doc.end();
  });
}

/**
 * A filename that will not break when someone downloads it on Windows.
 *
 * @param {string} kind
 * @param {string} extension
 * @returns {string}
 */
function exportFilename(kind, extension) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const safeKind =
    String(kind)
      .replace(/[^a-z0-9_-]/gi, "")
      .toLowerCase() || "report";
  return `campusos-${safeKind}-${stamp}.${extension}`;
}

module.exports = {
  csvCell,
  toCsv,
  toTable,
  toPdf,
  exportFilename,
  FORMULA_PREFIXES,
};
