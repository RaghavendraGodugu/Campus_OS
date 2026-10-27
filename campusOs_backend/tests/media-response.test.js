/**
 * Private media responses.
 *
 * The image endpoint must revalidate without going back to Cloudinary. Getting
 * this wrong is either a stale attachment (too much caching) or a full object
 * download on every render (too little). The conditional request is the whole
 * mechanism, so it is tested directly.
 */

const { mediaEtag, sendPrivateMedia } = require("../src/utils/mediaResponse");

function fakeResponse() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: null,
    ended: false,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

describe("sendPrivateMedia", () => {
  it("answers a matching ETag with 304 without reading the file", async () => {
    const load = vi.fn(async () => Buffer.from("not read"));
    const res = fakeResponse();

    await sendPrivateMedia(
      { headers: { "if-none-match": mediaEtag("announcements/1-image.png") } },
      res,
      {
        storageKey: "announcements/1-image.png",
        mimeType: "image/png",
        load,
      }
    );

    expect(res.statusCode).toBe(304);
    expect(res.ended).toBe(true);
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(load).not.toHaveBeenCalled();
  });

  it("marks the response private and revalidated", async () => {
    const res = fakeResponse();
    const bytes = Buffer.from("image bytes");

    await sendPrivateMedia({ headers: {} }, res, {
      storageKey: "announcements/1-image.png",
      mimeType: "image/png",
      filename: "poster.png",
      load: async () => bytes,
    });

    expect(res.headers["cache-control"]).toBe("private, no-cache");
    expect(res.headers.etag).toBe(mediaEtag("announcements/1-image.png"));
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-length"]).toBe(bytes.length);
    expect(res.headers["content-disposition"]).toMatch(/poster\.png/);
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(res.body).toBe(bytes);
  });

  it("does not treat a different ETag as fresh", async () => {
    const load = vi.fn(async () => Buffer.from("image bytes"));
    const res = fakeResponse();

    await sendPrivateMedia(
      { headers: { "if-none-match": mediaEtag("announcements/old.png") } },
      res,
      {
        storageKey: "announcements/new.png",
        mimeType: "image/png",
        load,
      }
    );

    expect(res.statusCode).toBe(200);
    expect(load).toHaveBeenCalledOnce();
    expect(res.body).toEqual(Buffer.from("image bytes"));
  });
});
