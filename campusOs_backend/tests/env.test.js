/**
 * Environment validation.
 *
 * The MONGO_URI cases are the ones that matter here. A connection string with no
 * database name is valid, connects successfully, and resolves to a database
 * literally called `test`. Nothing errors. That is a far worse failure than a
 * malformed URI, because it looks like working software.
 */

const { databaseNameFrom, parseEnv } = require("../src/config/env");

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

/**
 * The `EBADRESP` this project actually hit.
 *
 * A `mongodb+srv://` URI is resolved through c-ares. The Node build on this
 * machine shipped without it, so every SRV lookup failed — while `dig` answered
 * correctly and Atlas was, and still is, perfectly reachable. The connection
 * refused, the error named a hostname nobody could act on, and it read like a
 * MongoDB outage.
 */
describe("explaining a DNS failure", () => {
  const { explainDnsFailure } = require("../src/config/db");
  const SRV_URI = "mongodb+srv://user:pass@campusos.xwdvotu.mongodb.net";

  it("names the local cause when this Node cannot resolve SRV", () => {
    const message = explainDnsFailure(
      { code: "EBADRESP", message: "querySrv EBADRESP host" },
      SRV_URI
    );

    expect(message).toBeTruthy();
    // It must be actionable, not merely different.
    expect(message).toMatch(/nvm use/i);
    expect(message).toMatch(/local/i);
  });

  it("still recognises the failure when the code is missing but the message says querySrv", () => {
    expect(
      explainDnsFailure({ message: "querySrv EBADRESP somewhere" }, SRV_URI)
    ).toBeTruthy();
  });

  it("says nothing about SRV when the URI is not an SRV one", () => {
    // A plain seed list never does an SRV lookup, so this is a different problem.
    expect(explainDnsFailure({ code: "EBADRESP" }, "mongodb://a,b,c/db")).toBeNull();
  });

  it("says nothing about an authentication failure", () => {
    expect(explainDnsFailure({ code: "AUTHENTICATION_FAILED" }, SRV_URI)).toBeNull();
  });
});

describe("production integration validation", () => {
  const production = {
    NODE_ENV: "production",
    PORT: "5050",
    MONGO_URI:
      "mongodb+srv://user:pass@cluster.mongodb.net/campusos?retryWrites=true&w=majority",
    CLIENT_URL: "https://campusos.vercel.app",
    WEB_URL: "https://campusos.vercel.app",
    JWT_SECRET: "a".repeat(48),
    REFRESH_TOKEN_SECRET: "b".repeat(48),
    CSRF_SECRET: "c".repeat(48),
    COOKIE_SECURE: "true",
    CLOUDINARY_CLOUD_NAME: "campusos",
    CLOUDINARY_API_KEY: "cloudinary-key",
    CLOUDINARY_API_SECRET: "cloudinary-secret",
    RAZORPAY_KEY_ID: "rzp_live_example",
    RAZORPAY_KEY_SECRET: "razorpay-secret",
    RAZORPAY_WEBHOOK_SECRET: "webhook-secret",
    SMTP_HOST: "smtp.example.com",
  };

  it("accepts a production environment with every integration configured", () => {
    const parsed = parseEnv(production);

    expect(parsed.NODE_ENV).toBe("production");
    expect(parsed.CLIENT_URL).toEqual(["https://campusos.vercel.app"]);
  });

  it("rejects a missing Cloudinary secret", () => {
    expect(() => parseEnv({ ...production, CLOUDINARY_API_SECRET: "" })).toThrow(
      /CLOUDINARY_API_SECRET/
    );
  });

  it("rejects a missing SMTP host", () => {
    expect(() => parseEnv({ ...production, SMTP_HOST: "" })).toThrow(/SMTP_HOST/);
  });

  it("rejects a missing public frontend URL", () => {
    expect(() => parseEnv({ ...production, WEB_URL: "" })).toThrow(/WEB_URL/);
  });
});
