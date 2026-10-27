/**
 * The HTTP client.
 *
 * ## Where the session lives
 *
 * In HttpOnly cookies the browser attaches automatically. JavaScript cannot read
 * them and no code in this bundle — or any script injected into the page — can
 * steal them. Nothing here touches `localStorage`, because anything written
 * there is readable by any XSS on the origin, and a stolen session token is a
 * stolen session.
 *
 * ## CSRF
 *
 * The one cookie the server deliberately makes *readable* is the CSRF token.
 * In development the API is same-origin through the Vite proxy, so the client
 * can echo it in a header. In the Vercel/Render split the cookie belongs to the
 * API host and page JavaScript cannot read it; the API accepts the browser's
 * unforgeable `Origin` header on that path instead.
 *
 * The token is still read fresh on every unsafe same-origin request rather
 * than cached at login, because the server rotates it and a cached copy
 * silently starts failing.
 *
 * ## Money is never parsed here
 *
 * Amounts arrive as integer paise and are formatted for display only. No
 * component parses a rupee string into a number, because that is how a float
 * reaches a total. `formatMoney` in `lib/format.js` is the only place a paise
 * value becomes text.
 */

import axios from "axios";

/**
 * The API base, including the version segment.
 *
 * `/v1` is part of the base rather than something prepended per call, so it is
 * asserted here instead of trusted. Getting it wrong is silent and total: every
 * request 404s, the session probe fails, and the application shows "we could
 * not confirm your session" while the API is perfectly healthy. Failing loudly
 * on the first request turns that into a one-line cause.
 */
const CONFIGURED_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

function resolveBaseUrl() {
  const base = CONFIGURED_BASE.replace(/\/+$/, "");

  if (!/(^|\/)v\d+$/.test(base)) {
    throw new Error(
      `VITE_API_URL is "${CONFIGURED_BASE}", which has no API version segment. ` +
        `Every request would 404 and the app would appear to have a server problem. ` +
        `Use "/api/v1" in development, or the full https URL including "/api/v1" in production.`,
    );
  }

  return base;
}

const BASE_URL = resolveBaseUrl();

/**
 * Build an absolute or same-origin URL for an authenticated media endpoint.
 *
 * `<img src>` cannot go through axios, so these URLs bypass `BASE_URL` unless
 * they are built here. A deployment whose API lives on another origin would
 * otherwise render every avatar and announcement image against the frontend
 * origin, where there is no such route.
 */
export function apiAssetUrl(path) {
  const suffix = String(path ?? "");
  return `${BASE_URL}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

/** Name of the readable CSRF cookie, set by the server. */
const CSRF_COOKIE = "cos_ct";

/** Methods the server rejects without a CSRF header. */
const UNSAFE_METHODS = new Set(["post", "put", "patch", "delete"]);

/** Read one cookie. Returns null rather than "" so callers can distinguish. */
function readCookie(name) {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const entry = part.trim();
    if (entry.startsWith(prefix)) {
      return decodeURIComponent(entry.slice(prefix.length));
    }
  }
  return null;
}

/** The current CSRF token, or null when the user has no session yet. */
export function readCsrfToken() {
  return readCookie(CSRF_COOKIE);
}

export const http = axios.create({
  baseURL: BASE_URL,
  // Harmless and required once the app is served from a different origin than
  // the API in production. Under the dev proxy it is a no-op.
  withCredentials: true,
  // The server answers with JSON, and a 204 must not throw.
  headers: { Accept: "application/json" },
});

http.interceptors.request.use((config) => {
  const method = (config.method ?? "get").toLowerCase();

  if (UNSAFE_METHODS.has(method)) {
    const token = readCsrfToken();
    if (token) {
      config.headers["X-CSRF-Token"] = token;
    }
  }

  return config;
});

/** An error shaped for display, with the server's own code preserved. */
export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the session is gone or was never valid. */
  get isUnauthenticated() {
    return this.status === 401;
  }

  /** True when the user is signed in but not permitted. */
  get isForbidden() {
    return this.status === 403;
  }

  /**
   * Field-level messages from the server, keyed by field name.
   *
   * The server validates every payload and names the offending field. Surfacing
   * that next to the input is the difference between "something is wrong" and
   * "the deadline must be in the future".
   */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return this.details.reduce((acc, item) => {
      if (item?.field) acc[item.field] = item.message;
      return acc;
    }, {});
  }
}

/**
 * Pull a usable message out of a failure.
 *
 * Anything not shaped by the server — a network drop, a proxy error, a bug in a
 * response interceptor — becomes one honest sentence rather than a stack trace
 * or "undefined".
 */
function toApiError(error) {
  if (error instanceof ApiError) return error;

  const response = error?.response;

  if (!response) {
    return new ApiError(
      navigator.onLine
        ? "Could not reach the server. Please try again."
        : "You appear to be offline. Reconnect and try again.",
      { status: 0, code: "NETWORK_ERROR" },
    );
  }

  const body = response.data ?? {};

  return new ApiError(
    body.message ?? "Something went wrong. Please try again.",
    {
      status: response.status,
      code: body.code,
      details: body.details ?? body.error?.details,
    },
  );
}

http.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(toApiError(error)),
);

/** GET with unwrapped data. */
export async function apiGet(path, config) {
  const response = await http.get(path, config);
  return response.data;
}

/** POST with unwrapped data and a CSRF header attached. */
export async function apiPost(path, body, config) {
  const response = await http.post(path, body, config);
  return response.data;
}

/** PUT with unwrapped data. */
export async function apiPut(path, body, config) {
  const response = await http.put(path, body, config);
  return response.data;
}

/** PATCH with unwrapped data. */
export async function apiPatch(path, body, config) {
  const response = await http.patch(path, body, config);
  return response.data;
}

/** DELETE with unwrapped data. */
export async function apiDelete(path, config) {
  const response = await http.delete(path, config);
  return response.data;
}

/**
 * Download a generated report as a file.
 *
 * Fetched as a blob rather than navigated to, for two reasons. A navigation
 * gives no signal at all: a 403 or a validation failure opens a blank tab and
 * the user concludes the button is broken. And the export carries the same
 * scope rules as the screen, so the failure that matters — "you cannot see this
 * report" — has to arrive as a message the page can show.
 *
 * The caller must revoke the returned URL.
 *
 * @param {string} kind
 * @param {{format?: "csv"|"pdf", days?: number, department?: string}} options
 * @returns {Promise<{url: string, filename: string}>}
 */
export async function downloadReport(
  kind,
  { format = "csv", days, department } = {},
) {
  const params = new URLSearchParams({ format });
  if (days) params.set("days", String(days));
  if (department) params.set("department", department);

  try {
    const response = await http.get(`/reports/${kind}/export?${params}`, {
      responseType: "blob",
    });

    const disposition = response.headers?.["content-disposition"] ?? "";
    const match = /filename="?([^"]+)"?/.exec(disposition);

    return {
      url: URL.createObjectURL(response.data),
      filename: match?.[1] ?? `campusos-${kind}.${format}`,
    };
  } catch (error) {
    // The body is a blob on failure too, so the useful message has to be read
    // back out of it before it is discarded.
    if (error?.response?.data instanceof Blob) {
      try {
        const text = await error.response.data.text();
        const parsed = JSON.parse(text);
        throw new ApiError(
          parsed.message ?? "The export could not be produced",
          {
            code: parsed.code,
            status: error.response.status,
          },
        );
      } catch (inner) {
        if (inner instanceof ApiError) throw inner;
        // A blob that is not JSON means the failure was not ours to describe.
      }
    }
    throw error;
  }
}

/**
 * POST a multipart body with one file.
 *
 * Axios sets the boundary itself when the body is FormData, so the caller must
 * NOT set Content-Type by hand — doing so drops the boundary and the server
 * sees an empty body, which surfaces as "no file was uploaded" rather than as
 * anything resembling the real problem.
 *
 * @param {string} path
 * @param {{field?: string, file: File}} args
 * @param {object} [config]
 */
export async function apiUpload(path, { field = "file", file }, config) {
  const body = new FormData();
  body.append(field, file);

  const response = await http.post(path, body, {
    ...config,
    headers: { ...(config?.headers ?? {}), "Content-Type": undefined },
  });
  return response.data;
}

/**
 * Fetch a private document and hand back a blob URL.
 *
 * Certificates and receipts are stored privately and served only after the
 * server has decided this user may see them. Navigating straight to the API URL
 * would work, but a blob keeps the download inside the app and lets a failure
 * surface as a message instead of a blank tab.
 *
 * The caller must revoke the URL.
 */
export async function fetchDocument(path) {
  const response = await http.get(path, { responseType: "blob" });
  return URL.createObjectURL(response.data);
}
