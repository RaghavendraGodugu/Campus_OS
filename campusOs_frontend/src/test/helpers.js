/**
 * A test network.
 *
 * Replaces the axios *transport* rather than axios itself, so the interceptors
 * in `api/client.js` still run — which is the point, because the CSRF header and
 * the error shaping live there and neither should be untested.
 *
 * Routes are matched by path suffix, longest first, so `/payments/1/receipt`
 * can be stubbed without `/payments/1` shadowing it.
 */

import { http } from "../api/client";

const installed = [];

function buildResponse(config, { status, data }) {
  return {
    data,
    status,
    statusText: String(status),
    headers: { "content-type": "application/json" },
    config,
    request: {},
  };
}

/**
 * Install a stubbed network that records what was sent.
 *
 * Asserting only on the response proves the page rendered something; it does not
 * prove the page sent the right thing. A form that submits every field as the
 * wrong name still returns a perfectly good response. `stubApiRecording` keeps
 * the same interceptor boundary as `stubApi` and hands back the requests.
 *
 * @returns {{requests: object[], restore: () => void}}
 */
export function stubApiRecording(routes) {
  const requests = [];
  const compiled = routes.map(([match, value]) => [match, value]);

  const adapter = async (config) => {
    const path = String(config.url ?? "").split("?")[0];
    requests.push({
      method: (config.method ?? "get").toLowerCase(),
      path,
      body: parseBody(config.data),
    });

    const hit = compiled
      .filter(([match]) =>
        typeof match === "string" ? path.endsWith(match) : match.test(path),
      )
      .sort((a, b) => String(b[0]).length - String(a[0]).length)[0];

    if (!hit) {
      return buildError(config, {
        status: 404,
        data: {
          success: false,
          message: `No stub for ${config.method} ${path}`,
        },
      });
    }

    const value = hit[1];

    if (typeof value === "number") {
      return buildError(config, {
        status: value,
        data: { success: false, message: `Stubbed ${value}` },
      });
    }

    if (value?.__status && value.__status >= 400) {
      return buildError(config, { status: value.__status, data: value.body });
    }

    const status = value?.__status ?? 200;
    return buildResponse(config, {
      status,
      data: value?.__status ? value.body : value,
    });
  };

  const previous = http.defaults.adapter;
  http.defaults.adapter = adapter;

  const restore = () => {
    http.defaults.adapter = previous;
  };
  installed.push(restore);

  return { requests, restore };
}

/** A JSON string, a FormData, or nothing. */
function parseBody(data) {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  if (typeof FormData !== "undefined" && data instanceof FormData) {
    return Object.fromEntries(data.entries());
  }
  return data ?? null;
}

/**
 * The accessible name testing-library computes for an element.
 *
 * `toHaveAccessibleName` does this too, but comparing nine names at once reads
 * better as a list than as nine assertions.
 */
export function accessibleName(element) {
  const labelledBy = element.getAttribute("aria-labelledby");

  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }

  return (
    element.getAttribute("aria-label") ??
    element.textContent ??
    ""
  ).trim();
}

/** Turn a status into an axios rejection, as the real transport would. */
function buildError(config, { status, data }) {
  const error = new Error(`Request failed with status code ${status}`);
  error.config = config;
  error.response = buildResponse(config, { status, data });
  error.isAxiosError = true;
  return Promise.reject(error);
}

/**
 * Install a stubbed network.
 *
 * @param {Array<[RegExp|string, object|number]>} routes Path (string suffix or
 *   RegExp) mapped to a response body, or to a status code for a bare failure.
 * @returns {() => void} restore
 */
export function stubApi(routes) {
  const compiled = routes.map(([match, value]) => [
    typeof match === "string" ? match : match,
    value,
  ]);

  const adapter = async (config) => {
    const path = String(config.url ?? "").split("?")[0];

    // Longest literal match first, so specific routes beat general ones.
    const hit = compiled
      .filter(([match]) =>
        typeof match === "string" ? path.endsWith(match) : match.test(path),
      )
      .sort((a, b) => String(b[0]).length - String(a[0]).length)[0];

    if (!hit) {
      const body = {
        success: false,
        message: `No stub for ${config.method} ${path}`,
      };
      return buildError(config, { status: 404, data: body });
    }

    const value = hit[1];

    if (typeof value === "number") {
      return buildError(config, {
        status: value,
        data: { success: false, message: `Stubbed ${value}` },
      });
    }

    // A non-2xx status must *reject*, exactly as the real transport does.
    // Resolving with a 401 would hand the caller a body that looks like a
    // success and hide the error path entirely.
    if (value?.__status && value.__status >= 400) {
      return buildError(config, { status: value.__status, data: value.body });
    }

    const status = value?.__status ?? 200;
    const data = value?.__status ? value.body : value;

    return buildResponse(config, { status, data });
  };

  const previous = http.defaults.adapter;
  http.defaults.adapter = adapter;

  const restore = () => {
    http.defaults.adapter = previous;
  };
  installed.push(restore);

  return restore;
}

/** Restore every network stub installed during a test. */
export function restoreApi() {
  while (installed.length) installed.pop()();
}

/** A signed-in session payload. */
export function session(overrides = {}) {
  return {
    success: true,
    data: {
      user: {
        id: "u1",
        fullName: "DEMO HOD",
        email: "demo.hod@campusos.local",
        role: "HOD",
      },
      student: null,
      permissions: [],
      scopes: ["own", "department"],
      ...overrides,
    },
  };
}
