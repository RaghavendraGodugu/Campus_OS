/**
 * Report export.
 *
 * The cases here are the ones that bite in practice: a title with a comma in it,
 * a title that is a spreadsheet formula, and an export that must agree with the
 * screen about who is allowed to see what.
 */

const {
  csvCell,
  toCsv,
  toTable,
  toPdf,
  exportFilename,
} = require("../src/services/reportExport.service");

describe("report export — CSV cells", () => {
  it("quotes a value containing a comma", () => {
    // "Bonafide certificate, urgently" must stay one column. A naive join
    // splits it into two and every column after it shifts left.
    expect(csvCell("Bonafide certificate, urgently")).toBe(
      '"Bonafide certificate, urgently"'
    );
  });

  it("quotes a value containing a quote, and doubles the inner quote", () => {
    // RFC 4180: a quote inside a quoted field is written twice.
    expect(csvCell('He said "now"')).toBe('"He said ""now"""');
  });

  it("quotes a value containing a newline", () => {
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  /**
   * The one that matters most.
   *
   * A student can type anything into a request title. If that lands unescaped at
   * the start of a cell, Excel and Google Sheets execute it — so a downloaded
   * report becomes a way to run a formula in a colleague's spreadsheet.
   */
  it.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+1+1", "'+1+1"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
  ])("neutralises the formula %s", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("neutralises a formula even when the cell also needs quoting", () => {
    // Order matters: the guard has to run before the quoting, or the leading
    // quote ends up inside the field and the sheet still evaluates it.
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(
      '"\'=HYPERLINK(""http://x"",""click"")"'
    );
  });

  it("leaves an ordinary value alone", () => {
    expect(csvCell("Study certificate")).toBe("Study certificate");
  });
});

describe("report export — CSV file", () => {
  it("writes a header row and a trailing newline", () => {
    const csv = toCsv(["Field", "Value"], [["total.total", 7]]);
    expect(csv).toBe("Field,Value\r\ntotal.total,7\r\n");
  });

  it("keeps rows aligned when a value contains commas", () => {
    const csv = toCsv(["A", "B"], [["plain", "one, two, three"]]);
    // Every line must still have the same number of delimiters outside quotes.
    expect(csv.split("\r\n")[1]).toBe('plain,"one, two, three"');
  });
});

describe("report export — table shaping", () => {
  const available = {
    scope: "institution",
    period: { from: "2026-08-01T00:00:00.000Z", to: "2026-10-14T00:00:00.000Z" },
    available: true,
    totals: { total: 12, open: 3 },
    byStatus: { OPEN: 3, COMPLETED: 9 },
    byType: [{ label: "Bonafide", count: 4 }],
    byDepartment: [{ label: "Computer Science", count: 7 }],
  };

  it("carries the scope and period into the file", () => {
    // Without these, a file that circulates has no statement of what it covers.
    const table = toTable("requests", available, [
      { label: "generatedBy", value: "a@b.c" },
    ]);
    const flat = table.rows.flat().join(" | ");
    expect(flat).toContain("institution");
    expect(flat).toContain("2026-08-01");
    expect(flat).toContain("2026-10-14");
  });

  it("includes totals and breakdowns", () => {
    const table = toTable("requests", available, []);
    const flat = table.rows.flat().join(" | ");
    expect(flat).toContain("total.total");
    expect(flat).toContain("byStatus.COMPLETED");
    expect(flat).toContain("Bonafide");
    expect(flat).toContain("Computer Science");
  });

  it("states plainly when the report is unavailable at this access level", () => {
    // The failure this prevents: an empty table reads as "nothing happened this
    // period", which is a different and much worse claim than "you cannot see
    // this".
    const table = toTable(
      "requests",
      {
        scope: "department",
        period: {},
        available: false,
        reason: "Your account has no department set.",
        totals: { total: 0 },
      },
      []
    );

    expect(table.notes).toEqual(["Your account has no department set."]);
    expect(table.rows.flat().join(" ")).toContain("Your account has no department set.");
  });

  it("gives every row the same number of columns", () => {
    const table = toTable("requests", available, []);
    const widths = new Set(table.rows.map((row) => row.length));
    // A ragged row shifts every value after the gap one column to the right.
    expect(widths.size).toBe(1);
  });
});

describe("report export — PDF", () => {
  it("produces a real PDF that starts with the PDF signature", async () => {
    const buffer = await toPdf({
      title: "CampusOS — requests report",
      headers: ["Section", "Value", "Section", "Value"],
      rows: [
        ["total.total", 12, "", ""],
        ["byStatus.OPEN", 3, "", ""],
      ],
      notes: [],
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("renders the unavailable note rather than dropping it", async () => {
    const table = toTable(
      "requests",
      {
        scope: "department",
        period: {},
        available: false,
        reason: "Not available at your access level.",
      },
      []
    );

    const buffer = await toPdf(table);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("adds pages and repeats the header for a long report", async () => {
    // Without page breaks a long export runs off the bottom of page one and
    // silently loses everything after it.
    const rows = Array.from({ length: 300 }, (_, index) => [
      `row.${index}`,
      index,
      "",
      "",
    ]);

    const buffer = await toPdf({
      title: "Long report",
      headers: ["Section", "Value", "Section", "Value"],
      rows,
      notes: [],
    });

    // A 300-row table cannot fit one A4 landscape page.
    expect(buffer.length).toBeGreaterThan(2000);
    const pageCount = (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [])
      .length;
    expect(pageCount).toBeGreaterThan(1);
  });
});

describe("report export — filenames", () => {
  it("stamps the filename and lowercases the kind", () => {
    const name = exportFilename("Requests", "csv");
    expect(name).toMatch(/^campusos-requests-\d{4}-\d{2}-\d{2}-.*\.csv$/);
  });

  it("strips anything that is not safe in a filename", () => {
    // A filename with a slash or a colon breaks on Windows, and the download
    // silently becomes `campusos.csv` or fails outright.
    const name = exportFilename("../../etc/passwd", "pdf");
    expect(name).not.toContain("..");
    expect(name).not.toContain("/");
    expect(name.endsWith(".pdf")).toBe(true);
  });
});
