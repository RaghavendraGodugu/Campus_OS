/**
 * Content Security Policy, per mode.
 *
 * ## Why this is a plugin and not a `<meta>` tag in index.html
 *
 * A static policy cannot be right in both modes, and getting it wrong in
 * development is invisible until someone tries to log in.
 *
 * Vite's React plugin injects an **inline module script** into every dev page —
 * the Fast Refresh preamble that wires up hot reloading. A `<meta>` CSP with
 * `script-src 'self'` and no `'unsafe-inline'` blocks it, the refresh runtime
 * never installs, and the application fails to boot with nothing in the network
 * tab to suggest why. That is a confusing failure to debug and an easy one to
 * cause.
 *
 * ## The API origin is a deployment setting
 *
 * With the frontend on Vercel and the API on Render, `connect-src 'self'` would
 * block every request to the API, and `img-src 'self'` would block avatars and
 * announcement images. The origin is derived from `VITE_API_URL` at build time
 * rather than hard-coded, so the policy follows the deployment instead of
 * quietly disabling the application.
 *
 * ## The theme script is inline on purpose
 *
 * `index.html` runs a tiny script before React exists so the page paints in the
 * right theme without a flash. That script is hashed here and named in
 * `script-src`; it is not an exemption for arbitrary inline code. Development
 * keeps `'unsafe-inline'`, because Vite's preamble changes on every reload.
 */

import { createHash } from "node:crypto";

const BASE = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // HTTPS images are allowed because the branding logo is an administrator-
  // supplied URL; restricting it to Cloudinary would make a college's own logo
  // silently disappear. Scripts are still locked to 'self' and Razorpay.
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  // Razorpay's checkout is third-party code running with this origin's
  // privileges. There is no way to take a payment without it, so it is named
  // explicitly rather than bought with 'unsafe-inline' or 'unsafe-eval', which
  // would have weakened everything else for the same result.
  "script-src 'self' https://checkout.razorpay.com",
  "connect-src 'self' https://api.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

/** The origin of an absolute API URL, or null for a same-origin path. */
function apiOrigin(value) {
  if (!value || value.startsWith("/")) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Append an origin to a directive without duplicating it. */
function withOrigin(directive, origin) {
  if (!origin) return directive;
  const [name, ...values] = directive.split(/\s+/);
  return values.includes(origin)
    ? directive
    : [name, ...values, origin].join(" ");
}

/**
 * The production policy, baked into the built HTML.
 *
 * No `'unsafe-inline'` in script-src: the only inline script is the theme
 * bootstrap, and its exact contents are hashed. A hash is narrower than
 * `'unsafe-inline'` and survives the build without a nonce server.
 */
export function buildProdCsp({
  apiUrl = process.env.VITE_API_URL,
  html = "",
} = {}) {
  const origin = apiOrigin(apiUrl);

  const inlineHashes = [
    ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
  ]
    .map((match) => match[1])
    .map(
      (source) =>
        `'sha256-${createHash("sha256").update(source).digest("base64")}'`,
    );

  const directives = BASE.map((directive) => {
    if (directive.startsWith("connect-src")) {
      return withOrigin(directive, origin);
    }
    if (directive.startsWith("img-src")) {
      return withOrigin(directive, origin);
    }
    if (directive.startsWith("script-src")) {
      return [...directive.split(/\s+/), ...inlineHashes].join(" ");
    }
    return directive;
  });

  return directives.join("; ");
}

/**
 * The development policy, served as a response header.
 *
 * Kept rather than dropped: the dev server still benefits from `default-src
 * 'self'` and `object-src 'none'`, so a stray remote script is still refused.
 * What is relaxed is only the inline-script rule Vite's preamble requires and no
 * real deployment needs — the dev server is localhost.
 */
export const DEV_CSP = BASE.map((directive) =>
  directive.startsWith("script-src")
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com"
    : directive,
).join("; ");

/** Injects the production policy into the built page. */
export function cspPlugin() {
  return {
    name: "campusos-csp",
    // Build only. The dev server sets its own header via server.headers.
    apply: "build",
    transformIndexHtml(html) {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: buildProdCsp({ html }),
          },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}
