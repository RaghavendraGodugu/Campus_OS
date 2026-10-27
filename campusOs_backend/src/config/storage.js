/**
 * Private file storage.
 *
 * ## A stored URL is not authorization
 *
 * The spec (§11) is explicit: "Do not treat a publicly accessible URL as proof
 * of authorization." So this module never returns a URL that grants access by
 * itself. It stores bytes under an opaque key and hands back a *signed* URL
 * that expires in minutes. Every download is preceded by an authorization check
 * in the certificate service; the signature only proves the URL was minted by
 * us recently, not that the holder may read the file.
 *
 * ## Two adapters, one interface
 *
 * `LocalStorage` (development and tests) writes outside the web root, so files
 * are not reachable by guessing a path. `CloudinaryStorage` is used when
 * credentials are configured, with the delivery type pinned to `authenticated`
 * — Cloudinary's private delivery mode — because a certificate is an official
 * document.
 *
 * Selecting an adapter is configuration, not code: adding credentials switches
 * behaviour without touching a call site.
 *
 * ## Upload validation
 *
 * `save()` validates the declared MIME type and size *before* writing, and the
 * caller is responsible for having sniffed the real type from content. A
 * client-supplied Content-Type is a claim, not evidence.
 */

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const { getEnv } = require("./env");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { logger } = require("./logger");

/** MIME types accepted for stored documents. An allowlist, never a blocklist. */
const ALLOWED_MIME_TYPES = Object.freeze(["application/pdf", "image/jpeg", "image/png"]);

/** Hard ceiling on a stored file. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** How long a signed download URL stays valid. */
const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Cloudinary resource type, by MIME type.
 *
 * Images go to `image`, not `raw`. This is the difference between storing a
 * picture and storing a file that happens to be a picture: Cloudinary's
 * `image` pipeline can transcode, resize and re-encode on delivery, and a
 * 4 MB phone photo never reaches a browser as 4 MB. Documents stay `raw`,
 * because a PDF must be delivered byte-for-byte — recompressing a signed
 * certificate would be indefensible.
 */
const CLOUDINARY_RESOURCE_TYPES = Object.freeze({
  "image/jpeg": "image",
  "image/png": "image",
  "application/pdf": "raw",
});

/**
 * The resource type for something already stored.
 *
 * The extension is authoritative here because `buildStorageKey` derives it from
 * the sniffed MIME type — we did not take it from the client. A stored file
 * whose extension we do not recognise is treated as a document, which is the
 * conservative choice: `raw` delivers bytes unaltered.
 */
function resourceTypeForStored(key, mimeType) {
  if (mimeType && CLOUDINARY_RESOURCE_TYPES[mimeType]) {
    return CLOUDINARY_RESOURCE_TYPES[mimeType];
  }
  const extension = String(key ?? "")
    .split(".")
    .pop()
    ?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg" || extension === "png") {
    return "image";
  }
  return "raw";
}

/** Extension used when serving a file back to the browser. */
const CONTENT_EXTENSIONS = Object.freeze({
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
});

/**
 * Validate a buffer before it is written.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType Declared (ideally sniffed) type.
 * @throws {ApiError} 415 or 413.
 */
function assertStorable(buffer, mimeType) {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new ApiError(
      ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
      `Files of type ${mimeType} are not accepted`
    );
  }

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw ApiError.badRequest("The file is empty");
  }

  if (buffer.length > MAX_FILE_BYTES) {
    throw new ApiError(ERROR_CODE.PAYLOAD_TOO_LARGE, "The file exceeds the 10 MB limit");
  }
}

/**
 * Sniff a file's real type from its magic bytes.
 *
 * This is the check that matters: an attacker controls the declared MIME type
 * and the file extension, and both are trivial to forge. Only the leading
 * bytes are trustworthy.
 *
 * @param {Buffer} buffer
 * @returns {string|null} A supported MIME type, or null when unrecognised.
 */
function sniffMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  // PDF: "%PDF-"
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  return null;
}

/** Reject anything whose content does not match its declared type. */
function assertContentMatches(buffer, declaredType) {
  const actual = sniffMimeType(buffer);
  if (!actual) {
    throw new ApiError(
      ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
      "The file's contents are not a supported document type"
    );
  }
  if (actual !== declaredType) {
    throw new ApiError(
      ERROR_CODE.VALIDATION_ERROR,
      "The file contents do not match the declared file type"
    );
  }
  return actual;
}

/**
 * Generate a storage key.
 *
 * Opaque and unguessable: it embeds a random component so a leaked key reveals
 * nothing about ordering or ownership, and contains no user-supplied path
 * segment (which is how path traversal gets in).
 */
function buildStorageKey({ folder, filename, mimeType }) {
  const extension = CONTENT_EXTENSIONS[mimeType] ?? "bin";
  const random = crypto.randomBytes(16).toString("hex");
  const safeStem =
    path
      .basename(filename ?? "file")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 60) || "file";

  return `${folder}/${Date.now()}-${random}-${safeStem}.${extension}`;
}

/** Sign a download URL so it cannot be forged or replayed indefinitely. */
function signDownloadToken(key, expiresAt) {
  const env = getEnv();
  const payload = `${key}:${expiresAt}`;
  const signature = crypto
    .createHmac("sha256", env.CSRF_SECRET)
    .update(payload)
    .digest("hex");
  return `${expiresAt}.${signature}`;
}

/** Verify a download token. Constant-time comparison. */
function verifyDownloadToken(key, token) {
  if (typeof token !== "string" || !token.includes(".")) return false;

  const separator = token.indexOf(".");
  const expiresAt = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  if (!expiresAt || !signature) return false;
  if (!/^\d+$/.test(expiresAt)) return false;

  // Compare against the full expected token, so signature and expiry are
  // covered by a single HMAC and cannot be mixed.
  const expected = signDownloadToken(key, expiresAt);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected.slice(separator + 1));

  if (a.length !== b.length || a.length === 0) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;

  return Number(expiresAt) > Math.floor(Date.now() / 1000);
}

/**
 * Local filesystem adapter.
 *
 * Files are written OUTSIDE any statically served directory. There is no route
 * that serves this folder, so the only way to read a file is through the
 * authorized download endpoint.
 */
class LocalStorage {
  constructor(root) {
    this.name = "local";
    this.root = root;
  }

  async save(buffer, { folder, filename, mimeType }) {
    assertStorable(buffer, mimeType);
    const key = buildStorageKey({ folder, filename, mimeType });
    const absolute = path.join(this.root, key);

    // Defence in depth: the key is generated, but verify it still resolves
    // inside the root so no future refactor can introduce traversal.
    if (!absolute.startsWith(path.resolve(this.root))) {
      throw new ApiError(ERROR_CODE.VALIDATION_ERROR, "Invalid storage key");
    }

    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, buffer, { mode: 0o600 });

    return { key, bytes: buffer.length, adapter: this.name };
  }

  /** Read bytes for a previously saved key. */
  async read(key) {
    const absolute = path.join(this.root, key);
    if (!absolute.startsWith(path.resolve(this.root))) {
      throw ApiError.notFound("File not found");
    }
    try {
      return await fsp.readFile(absolute);
    } catch {
      throw ApiError.notFound("File not found");
    }
  }

  async exists(key) {
    try {
      await fsp.access(path.join(this.root, key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key) {
    try {
      await fsp.unlink(path.join(this.root, key));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Cloudinary adapter.
 *
 * Delivery is forced to `authenticated`, so a stored asset is not fetchable
 * from a CDN URL without a signature. Using `image`/`raw` delivery here would
 * publish every certificate on the open internet.
 */
class CloudinaryStorage {
  constructor(client, cloudName) {
    this.name = "cloudinary";
    this.cloudinary = client;
    this.cloudName = cloudName;
  }

  async save(buffer, { folder, filename, mimeType, transformation }) {
    assertStorable(buffer, mimeType);
    const key = buildStorageKey({ folder, filename, mimeType });
    const resourceType = resourceTypeForStored(key, mimeType);

    const options = {
      // `key` already contains the folder. Passing `folder` as well makes
      // Cloudinary prepend it a second time.
      public_id: key,
      resource_type: resourceType,
      type: "authenticated", // private delivery
      overwrite: false,
    };

    // An incoming transformation stores the optimised image once, so every
    // later read is smaller without a per-request resize. Documents are never
    // transformed: a signed certificate must stay byte-for-byte intact.
    if (transformation && resourceType === "image") {
      options.transformation = transformation;
    }

    const result = await new Promise((resolve, reject) => {
      const stream = this.cloudinary.uploader.upload_stream(options, (error, uploaded) =>
        error ? reject(error) : resolve(uploaded)
      );
      stream.end(buffer);
    });

    return {
      key: result.public_id || key,
      bytes: result.bytes ?? buffer.length,
      adapter: this.name,
      assetId: result.asset_id,
      format: result.format,
      resourceType,
      mimeType,
    };
  }

  /**
   * Fetch bytes from Cloudinary server-side and return them as a Buffer.
   *
   * We intentionally avoid redirecting the browser to a Cloudinary URL because:
   *  1. Cloudinary's `private_download_url` points at `api.cloudinary.com/…/image/download`,
   *     which is an admin API endpoint that requires API-key auth — not suitable for
   *     browser `<img>` tags.
   *  2. Even a CDN-delivery signed URL would require `img-src https://res.cloudinary.com`
   *     in the Content Security Policy, weakening it.
   *
   * Fetching server-side keeps the CSP tight (`img-src 'self'`) and means the
   * session cookie the browser already holds is the only credential required.
   *
   * @param {string} key  The Cloudinary public_id (storage key).
   * @param {{mimeType?: string}} [options]
   * @returns {Promise<Buffer>}
   */
  async read(key, { mimeType } = {}) {
    const resourceType = resourceTypeForStored(key, mimeType);

    // Build a short-lived signed download URL using the Cloudinary SDK.
    // The URL is only fetched once, server-side, so the API credentials never
    // leave the server and the browser never sees this URL.
    const signedUrl = this.cloudinary.utils.private_download_url(key, null, {
      resource_type: resourceType,
      type: "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS,
      attachment: false,
    });

    let response;
    try {
      response = await fetch(signedUrl, {
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      logger.warn({ err, key }, "Cloudinary server-side fetch failed (network error)");
      throw new ApiError(
        ERROR_CODE.INTEGRATION_ERROR,
        "Could not retrieve file from storage"
      );
    }

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 500);
      logger.warn(
        { status: response.status, body, key },
        "Cloudinary server-side fetch returned non-2xx"
      );
      throw new ApiError(
        ERROR_CODE.INTEGRATION_ERROR,
        "Could not retrieve file from storage"
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async exists() {
    return true;
  }

  async delete(key, { mimeType } = {}) {
    try {
      await this.cloudinary.uploader.destroy(key, {
        resource_type: resourceTypeForStored(key, mimeType),
        type: "authenticated",
      });
      return true;
    } catch (error) {
      logger.warn({ err: error, key }, "Cloudinary delete failed");
      return false;
    }
  }
}

/**
 * Resolve the configured adapter.
 *
 * Cloudinary is used only when its credentials are present AND production is
 * not running, so a misconfigured production deploy fails loudly at boot
 * (config/env.js requires Razorpay secrets in production for the same reason)
 * rather than quietly writing files to local disk.
 *
 * @returns {LocalStorage|CloudinaryStorage}
 */
function getStorage() {
  const env = getEnv();

  if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
    // Required lazily: cloudinary is a devDependency-free optional integration
    // and must not break a development install that has no credentials.
    const { v2 } = require("cloudinary");
    v2.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    return new CloudinaryStorage(v2, env.CLOUDINARY_CLOUD_NAME);
  }

  if (env.NODE_ENV === "production") {
    throw new ApiError(
      ERROR_CODE.INTEGRATION_ERROR,
      "Production requires Cloudinary credentials for document storage"
    );
  }

  const root = process.env.LOCAL_STORAGE_PATH
    ? path.resolve(process.env.LOCAL_STORAGE_PATH)
    : path.resolve(__dirname, "..", "..", "storage");

  fs.mkdirSync(root, { recursive: true });
  return new LocalStorage(root);
}

module.exports = {
  getStorage,
  LocalStorage,
  CloudinaryStorage,
  buildStorageKey,
  signDownloadToken,
  verifyDownloadToken,
  sniffMimeType,
  assertStorable,
  assertContentMatches,
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  SIGNED_URL_TTL_SECONDS,
  CONTENT_EXTENSIONS,
  CLOUDINARY_RESOURCE_TYPES,
  resourceTypeForStored,
};
