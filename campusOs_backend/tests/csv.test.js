/**
 * The CSV reader.
 *
 * Every case here is one that a naive `text.split(",")` gets wrong, and each has
 * come from a real spreadsheet export: a name with a comma in it, a description
 * with a line break, a file from Windows, one from Excel with a BOM on it.
 *
 * The malformed cases matter just as much. A bulk import that quietly drops the
 * last student in a class is worse than one that refuses to run and says which
 * line to look at.
 */

const { parseCsv, parseCsvObjects, CsvError } = require("../src/utils/csv");

describe("plain files", () => {
  it("reads a simple table", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("tolerates a trailing newline without inventing a row", () => {
    expect(parseCsv("a,b\n1,2\n")).toHaveLength(2);
  });

  it("reads Windows line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a BOM, which Excel writes and nobody means", () => {
    expect(parseCsv("﻿roll,name\n1,A")).toEqual([
      ["roll", "name"],
      ["1", "A"],
    ]);
  });

  it("keeps empty cells as empty strings", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("ignores a blank line in the middle", () => {
    expect(parseCsv("a,b\n1,2\n\n3,4")).toHaveLength(3);
  });
});

describe("quoted fields", () => {
  it("keeps a comma inside quotes", () => {
    expect(parseCsv('name,dept\n"Ananya, S.",CS')).toEqual([
      ["name", "dept"],
      ["Ananya, S.", "CS"],
    ]);
  });

  it('turns "" into a literal quote', () => {
    expect(parseCsv('a\n"She said ""go"""')).toEqual([["a"], ['She said "go"']]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('subject,body\n"two\nlines","line one\nline two"')).toEqual([
      ["subject", "body"],
      ["two\nlines", "line one\nline two"],
    ]);
  });

  it("counts lines correctly so an error points at the right one", () => {
    // `bad"quote"` begins on line 4: the newline inside the quoted field above
    // must have advanced the counter, or this would report line 3 and send
    // whoever is fixing the file to the wrong row.
    try {
      parseCsv('a\n"one\ntwo"\nbad"quote"');
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CsvError);
      expect(error.line).toBe(4);
    }
  });
});

describe("malformed input", () => {
  it("refuses an unclosed quote, with a line number", () => {
    expect(() => parseCsv('a\n"unterminated')).toThrow(/never closed/i);
  });

  it("refuses a quote in the middle of a bare field rather than guessing", () => {
    // Guessing here corrupts the value silently, which is the failure mode
    // this whole file exists to avoid.
    expect(() => parseCsv('a\nx"y')).toThrow(/unexpected quote/i);
  });

  it("says the file is empty rather than returning nothing", () => {
    expect(() => parseCsvObjects("")).toThrow(/empty/i);
  });
});

describe("objects", () => {
  const csv = [
    "rollNumber,fullName,email",
    "23CS001,Ananya Sharma,ananya@campusos.local",
    "23CS002,Raghav Kumar,raghav@campusos.local",
  ].join("\n");

  it("keys rows by the header", () => {
    const { rows } = parseCsvObjects(csv);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      rollNumber: "23CS001",
      fullName: "Ananya Sharma",
    });
  });

  /**
   * The line number has to count the header and be 1-based, because that is
   * what someone looking at the file in a spreadsheet will see.
   */
  it("reports the line a row is really on", () => {
    const { rows } = parseCsvObjects(csv);
    expect(rows[0].__line).toBe(2);
    expect(rows[1].__line).toBe(3);
  });

  it("names the missing column instead of leaving it undefined", () => {
    expect(() => parseCsvObjects(csv, { columns: ["rollNumber", "program"] })).toThrow(
      /missing the column: program/i
    );
  });

  it("accepts a file with extra columns, ignoring them", () => {
    // A real admissions export has columns nobody here needs. They must not be
    // an error, and must not shift the ones that matter.
    const wide =
      "rollNumber,fullName,email,dateOfBirth,previousInstitution\n" +
      "23CS003,X,x@x.test,2004-02-01,Somewhere School";

    const { rows } = parseCsvObjects(wide, {
      columns: ["rollNumber", "fullName", "email"],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rollNumber: "23CS003",
      email: "x@x.test",
      previousInstitution: "Somewhere School",
    });
  });

  /**
   * A ragged row is almost always an unquoted comma, and it would otherwise
   * shift every value after it by one column.
   */
  it("refuses a row with more values than the header has", () => {
    const ragged = "rollNumber,fullName\n23CS001,Ananya,extra";

    expect(() => parseCsvObjects(ragged)).toThrow(/3 values but the header has 2/i);
  });

  it("tolerates a short row, filling the missing cells as empty", () => {
    const { rows } = parseCsvObjects("rollNumber,fullName,email\n23CS001,Ananya");

    expect(rows[0].email).toBe("");
  });

  it("trims values, so a stray space does not become part of an email", () => {
    const { rows } = parseCsvObjects("email\n  ananya@campusos.local  ");

    expect(rows[0].email).toBe("ananya@campusos.local");
  });
});
