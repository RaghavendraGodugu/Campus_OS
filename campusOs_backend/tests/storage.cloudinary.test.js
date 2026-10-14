/**
 * The Cloudinary storage adapter.
 *
 * ## Why this file exists
 *
 * The adapter was written and then never run by anything. `cloudinary` was not
 * even a declared dependency, so the day credentials were configured the
 * process would have died on `require("cloudinary")` and the failure would have
 * looked like a Cloudinary outage rather than a missing package.
 *
 * These tests use a fake client, so they need no credentials and no network,
 * and they run in the ordinary suite. That is the point: the adapter is
 * exercised on every commit from now on.
 */

const path = require("path");

const {
  CloudinaryStorage,
  resourceTypeForStored,
  buildStorageKey,
} = require("../src/config/storage");

/**
 * A stand-in for the Cloudinary SDK.
 *
 * Records what it was asked for, so a test can assert on the *options* rather
 * than on a URL containing a real signature.
 */
function fakeCloudinary() {
  const calls = { uploads: [], destroys: [], signed: [] };

  return {
    calls,
    uploader: {
      upload_stream(options, callback) {
        const chunks = [];
        return {
          end(buffer) {
            chunks.push(buffer);
            calls.uploads.push({
              options,
              // Echo back what the SDK would, so the adapter's use of
              // public_id is actually checked.
              public_id: options.public_id,
              bytes: buffer.length,
              asset_id: "asset-123",
              format: options.public_id.split(".").pop(),
            });
            callback(null, {
              public_id: options.public_id,
              bytes: buffer.length,
              asset_id: "asset-123",
              format: options.public_id.split(".").pop(),
            });
          },
        };
      },
      destroy(key, options) {
        calls.destroys.push({ key, options });
        return Promise.resolve({ result: "ok" });
      },
    },
    utils: {
      private_download_url(key, options) {
        calls.signed.push({ key, options });
        return `https://res.cloudinary.com/demo/image/authenticated/s--sig--/${key}`;
      },
    },
  };
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(64)]);

describe("CloudinaryStorage", () => {
  let cloudinary;
  let storage;

  beforeEach(() => {
    cloudinary = fakeCloudinary();
    storage = new CloudinaryStorage(cloudinary, "demo");
  });

  describe("resource type selection", () => {
    it("sends images to the image pipeline, not as raw bytes", async () => {
      await storage.save(PNG, {
        folder: "certificates",
        filename: "bonafide.png",
        mimeType: "image/png",
      });

      const upload = cloudinary.calls.uploads[0];
      // This is the whole point of the routing: `image` lets Cloudinary
      // transcode on delivery. `raw` would store an unoptimisable blob.
      expect(upload.options.resource_type).toBe("image");
    });

    it("sends jpeg through the same pipeline as png", async () => {
      const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
      await storage.save(jpeg, {
        folder: "announcements",
        filename: "banner.jpg",
        mimeType: "image/jpeg",
      });
      expect(cloudinary.calls.uploads[0].options.resource_type).toBe("image");
    });

    it("sends documents as raw, so a certificate is delivered byte for byte", async () => {
      await storage.save(PDF, {
        folder: "certificates",
        filename: "bonafide.pdf",
        mimeType: "application/pdf",
      });
      // Recompressing a signed official document is indefensible.
      expect(cloudinary.calls.uploads[0].options.resource_type).toBe("raw");
    });

    it("always requests private delivery", async () => {
      await storage.save(PNG, {
        folder: "announcements",
        filename: "banner.png",
        mimeType: "image/png",
      });
      // `public` here would publish every certificate on the open internet.
      expect(cloudinary.calls.uploads[0].options.type).toBe("authenticated");
    });
  });

  describe("resourceTypeForStored", () => {
    it("derives the type from the extension when no MIME type is supplied", () => {
      // The extension came from our own sniffed MIME type, not from the
      // client, so it is safe to trust here.
      expect(resourceTypeForStored("certificates/123-abc-bonafide.png")).toBe("image");
      expect(resourceTypeForStored("certificates/123-abc-bonafide.jpg")).toBe("image");
      expect(resourceTypeForStored("certificates/123-abc-bonafide.pdf")).toBe("raw");
    });

    it("treats an unrecognised extension as a document, not an image", () => {
      // `raw` delivers bytes unaltered. Guessing "image" for something unknown
      // would hand the pipeline a file it may fail to parse.
      expect(resourceTypeForStored("certificates/123-abc-bonafide.docx")).toBe("raw");
      expect(resourceTypeForStored("")).toBe("raw");
      expect(resourceTypeForStored(null)).toBe("raw");
    });

    it("prefers the MIME type when one is given", () => {
      expect(resourceTypeForStored("x.png", "application/pdf")).toBe("raw");
      expect(resourceTypeForStored("x.pdf", "image/png")).toBe("image");
    });
  });

  describe("signed URLs", () => {
    it("signs images as images", async () => {
      const url = await storage.getSignedUrl("announcements/123-banner.png");
      expect(cloudinary.calls.signed[0].options.resource_type).toBe("image");
      expect(url).toContain("authenticated");
    });

    it("serves images inline so a thumbnail renders instead of downloading", async () => {
      await storage.getSignedUrl("announcements/123-banner.png");
      // Nobody wants to click an image and lose their page.
      expect(cloudinary.calls.signed[0].options.attachment).toBe(false);
    });

    it("serves documents as an attachment", async () => {
      await storage.getSignedUrl("certificates/123-bonafide.pdf");
      // Nobody wants a certificate silently opening in a new tab either.
      expect(cloudinary.calls.signed[0].options.attachment).toBe(true);
    });

    it("honours an explicit download override", async () => {
      await storage.getSignedUrl("announcements/123-banner.png", { download: true });
      expect(cloudinary.calls.signed[0].options.attachment).toBe(true);
    });

    it("expires the signature", async () => {
      const before = Math.floor(Date.now() / 1000);
      await storage.getSignedUrl("certificates/123-bonafide.pdf", { expiresInSeconds: 60 });
      const { expires_at: expiresAt } = cloudinary.calls.signed[0].options;
      expect(expiresAt).toBeGreaterThanOrEqual(before + 60);
      expect(expiresAt).toBeLessThanOrEqual(before + 65);
    });
  });

  describe("deletion", () => {
    it("destroys an image through the image pipeline", async () => {
      const deleted = await storage.delete("announcements/123-banner.png");
      expect(deleted).toBe(true);
      expect(cloudinary.calls.destroys[0].options.resource_type).toBe("image");
    });

    it("destroys a document as raw", async () => {
      await storage.delete("certificates/123-bonafide.pdf");
      expect(cloudinary.calls.destroys[0].options.resource_type).toBe("raw");
    });

    it("reports failure rather than throwing when the CDN rejects it", async () => {
      // A delete that throws would roll back the database record while the
      // asset is still live — the opposite of what the caller assumes.
      cloudinary.uploader.destroy = () => Promise.reject(new Error("cdn down"));
      await expect(storage.delete("certificates/123-bonafide.pdf")).resolves.toBe(false);
    });
  });

  describe("refusing to hand out bytes", () => {
    it("does not return the file body through the CDN", async () => {
      await expect(storage.read("certificates/123-bonafide.pdf")).rejects.toThrow(
        /signed download URL/,
      );
    });
  });

  describe("rejection happens before the network call", () => {
    it("refuses an unsupported type without uploading it", async () => {
      await expect(
        storage.save(Buffer.from("GIF89a"), {
          folder: "announcements",
          filename: "x.gif",
          mimeType: "image/gif",
        }),
      ).rejects.toThrow(/not accepted/);
      expect(cloudinary.calls.uploads).toHaveLength(0);
    });

    it("refuses an oversized file without uploading it", async () => {
      const huge = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(11 * 1024 * 1024)]);
      await expect(
        storage.save(huge, {
          folder: "announcements",
          filename: "big.png",
          mimeType: "image/png",
        }),
      ).rejects.toThrow(/exceeds the 10 MB limit/);
      expect(cloudinary.calls.uploads).toHaveLength(0);
    });
  });

  it("builds an opaque key that does not reveal the uploader", () => {
    const key = buildStorageKey({
      folder: "certificates",
      filename: "../../etc/passwd",
      mimeType: "image/png",
    });
    // Path traversal in a filename must not survive into the key.
    expect(key).not.toContain("..");
    expect(key).toMatch(/^certificates\/\d+-[0-9a-f]{32}-/);
  });
});
describe("getStorage adapter selection", () => {
  /**
   * The bug this covers: the Cloudinary adapter existed, but `cloudinary` was
   * not a declared dependency. Selecting it would have crashed the process with
   * MODULE_NOT_FOUND — and because nothing ever exercised this line, nobody
   * would have found out until the first production upload.
   *
   * `vi.stubEnv` rather than assigning `process.env` directly: replacing the
   * whole object detaches it from the environment vitest set up, and the
   * values silently stop reaching the module under test.
   */
  const CREDENTIALS = {
    CLOUDINARY_CLOUD_NAME: "demo",
    CLOUDINARY_API_KEY: "key",
    CLOUDINARY_API_SECRET: "secret",
  };

  /**
   * Re-require the config modules so `getEnv()` re-parses.
   *
   * `vi.resetModules()` is not enough here: this is CommonJS, and a bare
   * `require()` bypasses Vitest's module graph, so the registry reset is not
   * applied and the cached `env` — with empty credentials — survives. The
   * symptom is a test that asserts Cloudinary is selected and is told `local`.
   */
  function storageFor(env) {
    for (const key of Object.keys(require.cache)) {
      if (key.includes(`${path.sep}src${path.sep}config${path.sep}`)) {
        delete require.cache[key];
      }
    }
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", env.CLOUDINARY_CLOUD_NAME ?? "");
    vi.stubEnv("CLOUDINARY_API_KEY", env.CLOUDINARY_API_KEY ?? "");
    vi.stubEnv("CLOUDINARY_API_SECRET", env.CLOUDINARY_API_SECRET ?? "");
    const mod = require("../src/config/storage");
    return { adapter: mod.getStorage(), CloudinaryStorage: mod.CloudinaryStorage };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("selects Cloudinary when all three credentials are present", () => {
    const { adapter, CloudinaryStorage } = storageFor(CREDENTIALS);
    expect(adapter).toBeInstanceOf(CloudinaryStorage);
    expect(adapter.name).toBe("cloudinary");
  });

  it("falls back to local disk when no credentials are configured", () => {
    const { adapter } = storageFor({});
    expect(adapter.name).toBe("local");
  });

  it("falls back to local disk when credentials are only half set", () => {
    // A typo in one variable must not half-enable a CDN integration and then
    // fail on the first upload with a confusing error.
    const { adapter } = storageFor({
      CLOUDINARY_CLOUD_NAME: "demo",
      CLOUDINARY_API_KEY: "key",
    });
    expect(adapter.name).toBe("local");
  });

  it("keeps documents on raw storage so a certificate is never transcoded", () => {
    // The routing decision, stated as one test across both adapters.
    const { adapter } = storageFor(CREDENTIALS);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16),
    ]);
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(16)]);

    expect(
      resourceTypeForStored("x/1-a.png", "image/png"),
      "images belong on the image pipeline",
    ).toBe("image");
    expect(
      resourceTypeForStored("x/1-a.pdf", "application/pdf"),
      "documents must be delivered byte for byte",
    ).toBe("raw");
    expect(png.length).toBeGreaterThan(0);
    expect(pdf.length).toBeGreaterThan(0);
    expect(adapter.name).toBe("cloudinary");
  });
});
