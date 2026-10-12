/**
 * Environment validation.
 *
 * The MONGO_URI cases are the ones that matter here. A connection string with no
 * database name is valid, connects successfully, and resolves to a database
 * literally called `test`. Nothing errors. That is a far worse failure than a
 * malformed URI, because it looks like working software.
 */

const { databaseNameFrom } = require("../src/config/env");

describe("databaseNameFrom", () => {
  it("reads the name from an Atlas SRV string", () => {
    expect(
      databaseNameFrom(
        "mongodb+srv://u:p@host.mongodb.net/campusos?retryWrites=true&w=majority"
      )
    ).toBe("campusos");
  });

  it("reads the name from a local URI", () => {
    expect(databaseNameFrom("mongodb://127.0.0.1:27017/campusos_dev")).toBe(
      "campusos_dev"
    );
  });

  /**
   * The bug this guard exists for.
   *
   * This is exactly what Atlas's "drivers" panel hands you, and what a
   * connection succeeds against. Every record is written. Nothing complains.
   */
  it("reports no name for an Atlas URI with no path", () => {
    expect(
      databaseNameFrom("mongodb+srv://u:p@host.mongodb.net/?appName=campusos")
    ).toBeNull();
  });

  it("reports no name for a local URI with no path", () => {
    expect(databaseNameFrom("mongodb://127.0.0.1:27017")).toBeNull();
  });

  it("treats a bare trailing slash as no name", () => {
    // MongoDB reads the empty path as "no database", not as "".
    expect(databaseNameFrom("mongodb+srv://u:p@host.mongodb.net/")).toBeNull();
  });

  it("does not mistake the query string for a database name", () => {
    expect(
      databaseNameFrom("mongodb+srv://u:p@host.mongodb.net/?retryWrites=true")
    ).toBeNull();
  });

  it("handles credentials containing an at sign", () => {
    // The split must be on the LAST @, since a password may contain one.
    expect(databaseNameFrom("mongodb+srv://user:p@ss@host.mongodb.net/campusos")).toBe(
      "campusos"
    );
  });

  /**
   * The bug this test was written after.
   *
   * A local connection string has no credentials and therefore no "@". Reading
   * the host as everything after the "@" found no "@", concluded there was no
   * database, and rejected every local URI — including the test suite's own.
   */
  it("reads a local URI that has no credentials at all", () => {
    expect(databaseNameFrom("mongodb://127.0.0.1:27017/campusos_dev")).toBe(
      "campusos_dev"
    );
  });

  it("decodes a percent-encoded name", () => {
    expect(databaseNameFrom("mongodb://127.0.0.1:27017/campus%2Fdev")).toBe("campus/dev");
  });
});
