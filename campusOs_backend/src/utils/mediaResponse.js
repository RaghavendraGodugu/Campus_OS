/**
 * Private media responses.
 *
 * Images are served through authenticated endpoints, so a shared proxy must
 * never store them. A browser may keep a copy, but it has to revalidate: the
 * URL stays the same when an announcement image or avatar is replaced, and a
 * fresh ETag is the only way to notice. Revalidation costs one conditional
 * request and avoids fetching the bytes from storage again.
 */

const crypto = require("crypto");

/** A strong ETag for an immutable storage key. */
function mediaEtag(storageKey) {
  const digest = crypto
    .createHash("sha256")
    .update(String(storageKey))
    .digest("base64url");
  return `"${digest}"`;
}

/** Does the request already hold this exact representation? */
function isFresh(req, etag) {
  const header = req.headers["if-none-match"];
  if (!header) return false;

  return header
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === etag || candidate === "*");
}

/**
 * Send bytes for an authenticated image.
 *
 * `load` is only called after the conditional check, so a 304 never reaches
 * Cloudinary or the local disk.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {object} options
 * @param {string} options.storageKey Immutable storage key.
 * @param {string|null} options.mimeType
 * @param {string} [options.filename]
 * @param {() => Promise<Buffer>} options.load
 */
async function sendPrivateMedia(req, res, { storageKey, mimeType, filename, load }) {
  const etag = mediaEtag(storageKey);

  res.setHeader("ETag", etag);
  // `private` keeps shared caches out; `no-cache` still allows the browser to
  // keep the bytes, provided it revalidates before reuse.
  res.setHeader("Cache-Control", "private, no-cache");
  // The SPA is served from Vercel and the API from Render, so these images
  // cross a site boundary. Helmet's default `same-site` CORP would make the
  // browser refuse to render them; CORS still protects API reads, and these
  // media routes authenticate the session before returning bytes. Set this
  // before the 304 branch so a revalidated image keeps the same policy.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  if (isFresh(req, etag)) {
    return res.status(304).end();
  }

  let buffer;
  try {
    buffer = await load();
  } catch (error) {
    // The error handler will replace this with JSON. Do not let a media ETag
    // label that error as if it were the image.
    res.removeHeader("ETag");
    res.removeHeader("Cache-Control");
    throw error;
  }

  res.setHeader("Content-Type", mimeType ?? "application/octet-stream");
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (filename) {
    const quoted = String(filename).replace(/["\\\r\n]/g, "_");
    res.setHeader("Content-Disposition", `inline; filename="${quoted}"`);
  }

  return res.send(buffer);
}

module.exports = { mediaEtag, isFresh, sendPrivateMedia };
