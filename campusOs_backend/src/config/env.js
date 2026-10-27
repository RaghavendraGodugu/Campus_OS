/**
 * Environment configuration.
 *
 * Parsed and validated exactly once, at require time, before any other module
 * loads. A misconfigured deployment must fail loudly here rather than surface
 * as a confusing runtime error later (e.g. a JWT signed with `undefined`).
 *
 * Rules:
 *  - Every secret is required in production; optional locally.
 *  - Secrets carry a minimum entropy length so a placeholder cannot ship.
 *  - Nothing in this file is ever logged in full.
 */

const path = require("path");
const z = require("zod");

// Load .env before validating. Path is explicit so tests can point elsewhere.
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", "..", ".env"), quiet: true });

/**
 * The database name in a MongoDB connection string, or null when it has none.
 *
 * Reads the path between the host and the query string, which is where MongoDB
 * looks. Returns null rather than "test" so a caller can tell an absent name
 * from a deliberate one.
 */
function databaseNameFrom(uri) {
  const withoutScheme = String(uri).replace(/^mongodb(\+srv)?:\/\//, "");

  // Credentials are optional, so the host begins after the LAST "@" — and a
  // local URI has none at all, which is the common case:
  // `mongodb://127.0.0.1:27017/campusos_dev`. Treating a missing "@" as "no
  // database" would reject every local connection, which is the opposite of
  // what this guard is for.
  const afterCredentials = withoutScheme.includes("@")
    ? withoutScheme.slice(withoutScheme.lastIndexOf("@") + 1)
    : withoutScheme;

  if (!afterCredentials.includes("/")) return null;

  const name = afterCredentials
    .slice(afterCredentials.indexOf("/") + 1)
    .split("?")[0]
    .trim();
  return name.length > 0 ? decodeURIComponent(name) : null;
}

/** Transform "true"/"false"/"1"/"0" into a real boolean. */
const booleanish = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "on"].includes(String(value).trim().toLowerCase());
});

/**
 * Secrets must be at least 32 characters. A generated hex secret of 48 bytes
 * is 96 characters, so this leaves generous headroom while still rejecting
 * short or placeholder values such as "secret".
 */
const secret = (label) =>
  z
    .string()
    .min(
      32,
      `${label} must be at least 32 characters (generate one with crypto.randomBytes)`
    );

/**
 * Comma-separated origin list -> validated origin array.
 * Rejects wildcards and paths, because a trusted-origin list containing "*"
 * silently disables credentialed CORS.
 */
const originList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  )
  .refine((origins) => !origins.includes("*"), {
    // Checked before the URL schema so the message names the real problem.
    message:
      'CLIENT_URL must not contain "*" — a wildcard origin silently disables credentialed CORS and cookie delivery',
  })
  .pipe(z.array(z.url()).min(1, "CLIENT_URL must list at least one trusted origin"))
  .refine((origins) => origins.every((origin) => !origin.endsWith("/")), {
    message: "CLIENT_URL entries must not have a trailing slash",
  });

const schema = z
  .object({
    // Hosting dashboards commonly preserve accidental casing or surrounding
    // whitespace (for example, `Production`). Normalise that harmless input
    // before enforcing the only three supported runtime modes.
    NODE_ENV: z
      .preprocess(
        (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
        z.enum(["development", "test", "production"])
      )
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),

    /**
     * The database URI.
     *
     * A database name is REQUIRED, and not merely recommended.
     *
     * A connection string with no path — `mongodb+srv://user:pass@host/?…` —
     * is valid, and MongoDB resolves it to a database literally named `test`.
     * That URI is easy to copy from an Atlas dashboard, where the path segment
     * is optional and invisible in the "drivers" panel, and it produces a
     * working connection to the wrong place: every document is written, nothing
     * errors, and the data lands somewhere nobody is looking.
     *
     * So it is refused here rather than defaulted. A typo in a database name is
     * cheap to fix; an entire term's records in a database called `test` is not.
     */
    MONGO_URI: z
      .string()
      .min(1, "MONGO_URI is required (Atlas SRV string or a local mongodb:// URI)")
      .refine((value) => databaseNameFrom(value) !== null, {
        message:
          "MONGO_URI must include a database name, e.g. mongodb+srv://user:pass@host/campusos?retryWrites=true&w=majority. " +
          "A URI with no path connects to a database literally named 'test', which looks like it works and quietly sends every record there.",
      }),

    CLIENT_URL: originList,

    JWT_SECRET: secret("JWT_SECRET"),
    JWT_EXPIRES_IN: z.string().default("15m"),
    REFRESH_TOKEN_SECRET: secret("REFRESH_TOKEN_SECRET"),
    REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),
    CSRF_SECRET: secret("CSRF_SECRET"),

    COOKIE_SECURE: booleanish.default(false),
    LOG_PRETTY: booleanish.default(true),

    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),

    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),

    /**
     * The origin the links in outgoing email point at.
     *
     * Separate from any CORS or callback setting on purpose: this is a full URL
     * handed to a person in an inbox, so it has to be exactly where the frontend
     * is reachable from.
     */
    WEB_URL: z.string().url().optional(),
  })
  // Refine on the whole object so cross-field rules can be expressed.
  .superRefine((value, ctx) => {
    const problems = [];

    if (value.JWT_SECRET === value.REFRESH_TOKEN_SECRET) {
      problems.push("JWT_SECRET and REFRESH_TOKEN_SECRET must differ");
    }
    if (value.JWT_SECRET === value.CSRF_SECRET) {
      problems.push("JWT_SECRET and CSRF_SECRET must differ");
    }
    if (value.REFRESH_TOKEN_SECRET === value.CSRF_SECRET) {
      problems.push("REFRESH_TOKEN_SECRET and CSRF_SECRET must differ");
    }

    if (value.NODE_ENV === "production") {
      if (!value.COOKIE_SECURE) {
        problems.push("COOKIE_SECURE must be true in production — cookies require HTTPS");
      }
      const missing = [
        "RAZORPAY_KEY_ID",
        "RAZORPAY_KEY_SECRET",
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET",
        "SMTP_HOST",
        "WEB_URL",
      ]
        .filter((key) => !value[key])
        .map((key) => key);
      if (missing.length) {
        problems.push(`missing production integration settings: ${missing.join(", ")}`);
      }
    }

    problems.forEach((message) => {
      ctx.addIssue({ code: "custom", message, path: ["_crossField"] });
    });
  });

/**
 * Parse the raw environment. Exported separately from the parsed result so
 * tests can assert failure behaviour without mutating process.env.
 */
function parseEnv(source = process.env) {
  const result = schema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues.map((issue) => {
      const path = issue.path.filter((segment) => segment !== "_crossField");
      const field = path.length ? path.join(".") : "configuration";
      return `  - ${field}: ${issue.message}`;
    });

    const error = new Error(
      `Invalid environment configuration:\n${details.join("\n")}\n\n` +
        `Copy campusOs_backend/.env.example to campusOs_backend/.env and fill it in.`
    );
    error.name = "EnvironmentConfigError";
    error.issues = result.error.issues;
    throw error;
  }

  return result.data;
}

let env;

/**
 * Lazily parse on first access.
 *
 * Lazy rather than eager-at-import so that tooling which only needs a subset
 * (for example `node scripts/create-admin.js`) is not forced through the full
 * production validation path, and so tests can point at a different process.env.
 */
function getEnv() {
  if (!env) {
    env = parseEnv();
  }
  return env;
}

module.exports = { getEnv, parseEnv, databaseNameFrom };
