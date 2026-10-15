/**
 * Profile pictures.
 *
 * An avatar is a face. The tests lean on the cases that would be a privacy
 * problem rather than a bug: the storage key must never reach a client, the
 * type must come from the bytes rather than the label, and replacing a picture
 * must not leave the record pointing at bytes that are gone.
 */

const {
  resetDatabase,
  createUser,
} = require("./helpers/factory");

const avatarService = require("../src/services/avatar.service");
const User = require("../src/models/User");
const AuditLog = require("../src/models/AuditLog");

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(256),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(256)]);

/** RIFF container carrying the WEBP tag — the signature, not a real image. */
function webpHeader() {
  return Buffer.concat([
    Buffer.from("RIFF", "latin1"),
    Buffer.from([0x1a, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP", "latin1"),
    Buffer.alloc(64),
  ]);
}

describe("avatar", () => {
  let user;

  beforeEach(async () => {
    await resetDatabase();
    user = await createUser({ role: "STUDENT" });
  });

  describe("type sniffing", () => {
    it("accepts PNG and JPEG", () => {
      expect(avatarService.sniffAvatarType(PNG)).toBe("image/png");
      expect(avatarService.sniffAvatarType(JPEG)).toBe("image/jpeg");
    });

    it("accepts WebP, which the shared document sniffer does not know", () => {
      // Widening the document allowlist to cover WebP would let a WebP into a
      // certificate upload, so avatars check it separately.
      expect(avatarService.sniffAvatarType(webpHeader())).toBe("image/webp");
    });

    it("rejects a PDF, even correctly labelled as a PNG", () => {
      // A renamed PDF is the classic upload bypass, and it works against
      // anything that trusts Content-Type.
      expect(avatarService.sniffAvatarType(PDF)).toBeNull();
    });
  });

  describe("storing", () => {
    it("stores a picture and records the sniffed type", async () => {
      const avatar = await avatarService.setAvatar({
        user,
        file: { buffer: PNG, mimetype: "image/jpeg", originalname: "me.png" },
      });

      expect(avatar.storageKey).toMatch(/^avatars\//);
      // The client's label said JPEG; the bytes said PNG. The bytes win.
      expect(avatar.mimeType).toBe("image/png");
    });

    it("routes the key to the image pipeline", async () => {
      const storage = require("../src/config/storage");
      const avatar = await avatarService.setAvatar({
        user,
        file: { buffer: PNG, mimetype: "image/png", originalname: "me.png" },
      });

      // Otherwise it is stored as an unoptimisable blob and a 2 MB phone photo
      // is downloaded in full for a 40px thumbnail.
      expect(storage.resourceTypeForStored(avatar.storageKey)).toBe("image");
    });

    it("keeps the filename out of the key", async () => {
      const avatar = await avatarService.setAvatar({
        user,
        file: { buffer: PNG, mimetype: "image/png", originalname: "../../etc/passwd.png" },
      });

      expect(avatar.storageKey).not.toContain("..");
      expect(avatar.storageKey).not.toContain("passwd");
    });

    it("refuses an empty upload", async () => {
      await expect(
        avatarService.setAvatar({ user, file: { buffer: Buffer.alloc(0), mimetype: "image/png" } }),
      ).rejects.toThrow(/empty/);
    });

    it("refuses anything over 2 MB, well below the document limit", async () => {
      const huge = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(3 * 1024 * 1024)]);
      await expect(
        avatarService.setAvatar({ user, file: { buffer: huge, mimetype: "image/png" } }),
      ).rejects.toThrow(/too large/i);
    });

    it("refuses a file whose contents are not an image", async () => {
      await expect(
        avatarService.setAvatar({
          user,
          file: { buffer: PDF, mimetype: "image/png", originalname: "x.png" },
        }),
      ).rejects.toThrow(/JPEG, PNG or WebP/);
    });
  });

  describe("replacing", () => {
    it("replaces the picture and leaves one key on the record", async () => {
      const first = await avatarService.setAvatar({
        user,
        file: { buffer: PNG, mimetype: "image/png", originalname: "one.png" },
      });
      const second = await avatarService.setAvatar({
        user,
        file: { buffer: JPEG, mimetype: "image/jpeg", originalname: "two.jpg" },
      });

      expect(second.storageKey).not.toBe(first.storageKey);

      const stored = await User.findById(user._id);
      // One key, the newer one. A record holding both would render whichever the
      // client happened to pick.
      expect(stored.avatar.storageKey).toBe(second.storageKey);
    });

    it("removes the picture and clears the record", async () => {
      await avatarService.setAvatar({
        user,
        file: { buffer: PNG, mimetype: "image/png", originalname: "me.png" },
      });

      const removed = await avatarService.clearAvatar({ user });
      expect(removed).toBe(true);

      const stored = await User.findById(user._id);
      expect(stored.avatar.storageKey).toBeNull();
    });

    it("succeeds when removing a picture that was never there", async () => {
      // Idempotent, so a retried delete does not report an error for a state the
      // user has already achieved.
      await expect(avatarService.clearAvatar({ user })).resolves.toBe(false);
    });
  });

  describe("reading", () => {
    it("reports a 404 when there is no picture", async () => {
      await expect(avatarService.readAvatar({ user })).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe("audit", () => {
    it("records the type and size, never the storage key", async () => {
      await avatarService.setAvatar({
        user,
        file: { buffer: PNG, mimetype: "image/png", originalname: "me.png" },
      });

      const entry = await AuditLog.findOne({ action: "AVATAR_UPDATED" }).lean();
      expect(entry).toBeTruthy();
      expect(entry.metadata.mimeType).toBe("image/png");

      // The key is an unguessable path. Putting it in the audit trail would
      // hand every audit reader a direct handle on the file.
      expect(JSON.stringify(entry.metadata)).not.toContain("avatars/");
    });
  });
});