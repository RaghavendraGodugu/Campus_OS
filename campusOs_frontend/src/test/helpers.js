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
