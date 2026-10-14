/**
 * A CSV reader.
 *
 * Written rather than installed, because the only correct way to parse this
 * format is a small state machine, and a dependency would be several thousand
 * lines of code to avoid forty of them — plus a version to keep current.
 *
 * It follows RFC 4180, which is what spreadsheet software actually emits:
 *
 *  - fields may be wrapped in `"`, and `""` inside one is a literal quote
 *  - a quoted field may contain commas *and* newlines
 *  - rows end with CRLF or LF, and the file may or may not end with one
 *  - a UTF-8 BOM is stripped, because Excel writes one and nobody means it
 *
 * All three of the quoted cases have bitten this codebase's inputs before: a
 * name like `Ananya, S.` inside quotes, a description containing a line break,
 * and a file exported from Windows.
 *
 * Malformed input — an unterminated quote, a ragged row — is an error with a
 * line number, never a silently truncated record. A bulk import that quietly
 * drops the last student in a class is worse than one that refuses to run.
 */

const BOM = "﻿";

class CsvError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = "CsvError";
    this.line = line;
  }
}

/**
 * Parse CSV text into an array of arrays of strings.
 *
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  if (typeof text !== "string") {
    throw new CsvError("Expected CSV text");
  }

  const input = text.startsWith(BOM) ? text.slice(1) : text;
  const rows = [];

  let row = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let sawAnyChar = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        // `""` is a literal quote. A quote followed by anything else closes it.
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length > 0) {
        // A quote in the middle of a bare field is a malformed file, and
        // guessing at it would corrupt the value silently.
        throw new CsvError(
          'Unexpected quote in the middle of a field — quote fields must start with "',
          rowStartLine
        );
      }
      inQuotes = true;
      sawAnyChar = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      sawAnyChar = true;
      continue;
    }

    if (char === "\r") {
      // Swallow; the \n that follows ends the row. A lone \r is also accepted.
      if (input[i + 1] !== "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        line += 1;
        rowStartLine = line;
        sawAnyChar = false;
      }
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      line += 1;
      rowStartLine = line;
      sawAnyChar = false;
      continue;
    }

    field += char;
    sawAnyChar = true;
  }

  if (inQuotes) {
    throw new CsvError("A quoted field was never closed", rowStartLine);
  }

  // Whatever is left is a final row without a trailing newline. Pushed only if
  // it has content, so a file ending in a newline does not gain a blank row.
  if (sawAnyChar || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => !(entry.length === 1 && entry[0].trim() === ""));
}

/**
 * Parse CSV into objects keyed by the header row.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {string[]} [options.columns] Expected headers; a missing one is an error
 *   rather than an undefined value three layers down.
 * @param {boolean} [options.trim] Trim every value (default true).
 * @returns {{ headers: string[], rows: object[] }}
 */
function parseCsvObjects(text, { columns, trim = true } = {}) {
  const table = parseCsv(text);

  if (table.length === 0) {
    throw new CsvError("The file is empty");
  }

  const [headerRow, ...body] = table;
  const headers = headerRow.map((cell) => (trim ? cell.trim() : cell));

  if (columns) {
    const missing = columns.filter((column) => !headers.includes(column));
    if (missing.length > 0) {
      throw new CsvError(
        `The file is missing the column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. ` +
          `Download the template and start from that.`
      );
    }
  }

  const rows = body.map((cells, index) => {
    const line = index + 2; // +1 for the header, +1 because lines are 1-based.

    if (cells.length > headers.length) {
      throw new CsvError(
        `This row has ${cells.length} values but the header has ${headers.length}. ` +
          `A comma inside a value must be wrapped in quotes.`,
        line
      );
    }

    const record = {};
    headers.forEach((header, position) => {
      let value = cells[position] ?? "";
      if (trim) value = value.trim();
      record[header] = value;
    });
    record.__line = line;
    return record;
  });

  return { headers, rows };
}

module.exports = { parseCsv, parseCsvObjects, CsvError };
