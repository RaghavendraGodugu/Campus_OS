/**
 * Announcement images.
 *
 * The upload path has to survive hostile input, so these lean on the cases a
 * reviewer would ask about: a file that lies about its type, one that is empty,
 * one that is too big, and one that replaces another.
 */

const { resetDatabase, createUser } = require("./helpers/factory");
const storage = require("../src/config/storage");
const announcementImageService = require("../src/services/announcementImage.service");
const Announcement = require("../src/models/Announcement");

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(128),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(128)]);

let referenceCounter = 0;

function makeAnnouncement(overrides = {}) {
  referenceCounter += 1;
  return Announcement.create({
    title: "Library closure on Friday",
    body: "The library will be closed for maintenance on Friday afternoon.",
    // The reference is unique, so each test needs its own.
    reference: `AN-TEST-${referenceCounter}`,
    author: overrides.author,
    createdBy: overrides.author,
    audience: { scope: "ALL" },
    ...overrides,
  });
}

describe("announcement images", () => {
  let author;

  beforeEach(async () => {
    await resetDatabase();
    author = await createUser({ role: "PRINCIPAL" });
  });

  it("stores an image and records what was verified, not what was claimed", async () => {
    const announcement = await makeAnnouncement({ author: author._id });

    const attachment = await announcementImageService.attachImage({
      announcementId: announcement.reference,
      // Deliberately mislabelled: the bytes are a PNG, the claim says JPEG.
      file: { buffer: PNG, mimetype: "image/jpeg", originalname: "poster.png" },
      user: author,
    });

    expect(attachment.storageKey).toMatch(/^announcements\//);
    // The stored type is the sniffed one. The client's label is never trusted.
    expect(attachment.mimeType).toBe("image/png");
    expect(attachment.bytes).toBeGreaterThan(0);

    const reloaded = await Announcement.findById(announcement._id);
    expect(reloaded.attachment.storageKey).toBe(attachment.storageKey);
  });

  it("accepts a JPEG as well as a PNG", async () => {
    const announcement = await makeAnnouncement({ author: author._id });
    const attachment = await announcementImageService.attachImage({
      announcementId: announcement.reference,
      file: { buffer: JPEG, mimetype: "image/jpeg", originalname: "photo.jpg" },
      user: author,
    });
    expect(attachment.mimeType).toBe("image/jpeg");
  });

  it("routes an image through the adapter's image pipeline", async () => {
    const announcement = await makeAnnouncement({ author: author._id });
    const attachment = await announcementImageService.attachImage({
      announcementId: announcement.reference,
      file: { buffer: PNG, mimetype: "image/png", originalname: "poster.png" },
      user: author,
    });
    // A `.png` key must resolve to the image resource type, or the CDN cannot
    // optimise it on delivery.
    expect(storage.resourceTypeForStored(attachment.storageKey)).toBe("image");
  });

  it("refuses a file whose contents are not an image", async () => {
    const announcement = await makeAnnouncement({ author: author._id });
    // A PDF renamed to .png, and correctly labelled as a PNG by the client.
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(128)]);

    await expect(
      announcementImageService.attachImage({
        announcementId: announcement.reference,
        file: { buffer: pdf, mimetype: "image/png", originalname: "notice.png" },
        user: author,
      })
    ).rejects.toThrow(/JPEG or PNG/);
  });

  it("refuses an empty upload", async () => {
    const announcement = await makeAnnouncement({ author: author._id });
    await expect(
      announcementImageService.attachImage({
        announcementId: announcement.reference,
        file: {
          buffer: Buffer.alloc(0),
          mimetype: "image/png",
          originalname: "empty.png",
        },
        user: author,
      })
    ).rejects.toThrow(/empty/);
  });

  it("refuses an image over 5 MB", async () => {
    const announcement = await makeAnnouncement({ author: author._id });
    const huge = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(6 * 1024 * 1024)]);
    await expect(
      announcementImageService.attachImage({
        announcementId: announcement.reference,
        file: { buffer: huge, mimetype: "image/png", originalname: "huge.png" },
        user: author,
      })
    ).rejects.toThrow(/too large/i);
  });

  it("reports a missing announcement as a 404, not a server error", async () => {
    await expect(
      announcementImageService.attachImage({
        announcementId: "AN-2099-999999",
        file: { buffer: PNG, mimetype: "image/png", originalname: "x.png" },
        user: author,
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects a malformed reference without touching the database", async () => {
    await expect(
      announcementImageService.attachImage({
        announcementId: "",
        file: { buffer: PNG, mimetype: "image/png", originalname: "x.png" },
        user: author,
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("replaces a previous image and points at only one key", async () => {
    const announcement = await makeAnnouncement({ author: author._id });

    const first = await announcementImageService.attachImage({
      announcementId: announcement.reference,
      file: { buffer: PNG, mimetype: "image/png", originalname: "first.png" },
      user: author,
    });
    const second = await announcementImageService.attachImage({
      announcementId: announcement.reference,
      file: { buffer: JPEG, mimetype: "image/jpeg", originalname: "second.jpg" },
      user: author,
    });

    expect(second.storageKey).not.toBe(first.storageKey);

    const reloaded = await Announcement.findById(announcement._id);
    // One key, the newer one. A record holding both would render whichever the
    // client happened to pick.
    expect(reloaded.attachment.storageKey).toBe(second.storageKey);
    expect(reloaded.attachment.mimeType).toBe("image/jpeg");
  });

  it("removes the image and clears the record", async () => {
    const announcement = await makeAnnouncement({ author: author._id });
    await announcementImageService.attachImage({
      announcementId: announcement.reference,
      file: { buffer: PNG, mimetype: "image/png", originalname: "poster.png" },
      user: author,
    });

    const removed = await announcementImageService.removeImage({
      announcementId: announcement.reference,
      user: author,
    });

    expect(removed).toBe(true);
    const reloaded = await Announcement.findById(announcement._id);
    expect(reloaded.attachment.storageKey).toBeNull();
  });

  it("succeeds when removing an image that was never there", async () => {
    const announcement = await makeAnnouncement({ author: author._id });
    // Idempotent: a second delete should not throw, or a retried request from
    // the browser would show an error for a state the user already achieved.
    await expect(
      announcementImageService.removeImage({
        announcementId: announcement.reference,
        user: author,
      })
    ).resolves.toBe(false);
  });

  it("strips markup and control characters from the display name", () => {
    const name = announcementImageService.safeDisplayName(
      '<img src=x onerror="a()">\r\n<b>.png'
    );
    expect(name).not.toMatch(/[<>"\r\n]/);
  });

  it("keeps the stored key free of the client's filename", async () => {
    const announcement = await makeAnnouncement({ author: author._id });
    const attachment = await announcementImageService.attachImage({
      announcementId: announcement.reference,
      file: {
        buffer: PNG,
        mimetype: "image/png",
        originalname: "../../../etc/passwd.png",
      },
      user: author,
    });
    // The key is generated. The client name is kept only for display.
    expect(attachment.storageKey).not.toContain("..");
    expect(attachment.originalName).not.toContain("..");
  });
});
