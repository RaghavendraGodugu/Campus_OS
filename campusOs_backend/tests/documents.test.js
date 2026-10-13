/**
 * Document uploads.
 *
 * The threat model here is a student (or anyone) getting a file onto the server
 * that the system did not check. Every test below is an attempt, from a
 * different angle, to store something that should have been refused.
 *
 * The central claim: **the file type is determined by the bytes, never by what
 * the client says.** Multipart carries a caller-controlled MIME type, so trusting
 * it would mean accepting a shell script named "proof.pdf".
 */

const {
  getApp,
  resetDatabase,
  createUser,
  createStudent,
  createRequestType,
  createRequest,
  loginAs,
} = require("./helpers/factory");

const { ROLES, REQUEST_STATUS } = require("../src/config/constants");
const Document = require("../src/models/Document");
const documentService = require("../src/services/document.service");
const { MAX_FILE_BYTES } = require("../src/config/storage");

beforeEach(resetDatabase);

/** Realistic file headers — a 6-byte "JPEG" is not a JPEG. */
const PDF = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(200, 0x20)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 0x20),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(200, 0x20),
]);

/** Something that is emphatically not an accepted document. */
const ELF = Buffer.concat([
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
  Buffer.alloc(200, 0x00),
]);

/** DELETE with the CSRF header a browser would send. */
const deleteAs = (agent, csrf, url) => agent.delete(url).set("X-CSRF-Token", csrf);

/** Upload one file to a request as its owner. */
async function upload(owner, request, buffer, options = {}) {
  // Accepts either a createStudent() record or a bare user from createUser().
  const { agent, csrfToken } = await loginAs(owner.user ?? owner);
  return agent
    .post(`/api/v1/requests/${request.reference}/documents`)
    .set("X-CSRF-Token", csrfToken)
    .field("label", options.label ?? "ID proof")
    .attach("file", buffer, {
      filename: options.filename ?? "proof.pdf",
      contentType: options.contentType ?? "application/pdf",
    });
}

/** A student with a submitted request, ready to attach to. */
async function studentWithRequest() {
  const student = await createStudent();
  const type = await createRequestType({
    department: student.department,
    name: "With documents",
  });
  const request = await createRequest({ owner: student, requestType: type });
  return { student, request };
}

// ===========================================================================
// Content, not the client's claim
// ===========================================================================

describe("uploaded content is verified, not declared", () => {
  it("accepts a real PDF", async () => {
    const { student, request } = await studentWithRequest();
    const res = await upload(student, request, PDF);

    expect(res.status).toBe(201);
    expect(res.body.data.document.mimeType).toBe("application/pdf");
  });

  it("accepts a real PNG and a real JPEG", async () => {
    const { student, request } = await studentWithRequest();

    expect(
      (
        await upload(student, request, PNG, {
          filename: "id.png",
          contentType: "image/png",
        })
      ).status
    ).toBe(201);
    expect(
      (
        await upload(student, request, JPEG, {
          filename: "id.jpg",
          contentType: "image/jpeg",
        })
      ).status
    ).toBe(201);
  });

  /**
   * The central attack: a valid-looking MIME type over hostile content.
   *
   * Declaring `application/pdf` is free. If the type were taken from the
   * request, this binary would be stored and later served as a PDF.
   */
  it("refuses a binary disguised with a PDF content type", async () => {
    const { student, request } = await studentWithRequest();
    const res = await upload(student, request, ELF, {
      filename: "proof.pdf",
      contentType: "application/pdf",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not accepted/i);
    expect(await Document.countDocuments({})).toBe(0);
  });

  it("refuses HTML and SVG, which would script the origin if served", async () => {
    const { student, request } = await studentWithRequest();

    const html = Buffer.from("<!DOCTYPE html><script>alert(1)</script>");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

    expect(
      (await upload(student, request, html, { contentType: "text/html" })).status
    ).toBe(400);
    expect(
      (await upload(student, request, svg, { contentType: "image/svg+xml" })).status
    ).toBe(400);
    expect(await Document.countDocuments({})).toBe(0);
  });

  it("records the sniffed type, not the declared one", async () => {
    const { student, request } = await studentWithRequest();

    // Declared as a JPEG; the bytes are a PDF. The record must say PDF.
    const res = await upload(student, request, PDF, { contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(res.body.data.document.mimeType).toBe("application/pdf");
  });

  it("sniffs the three accepted formats and nothing else", () => {
    expect(documentService.sniffMimeType(PDF)).toBe("application/pdf");
    expect(documentService.sniffMimeType(PNG)).toBe("image/png");
    expect(documentService.sniffMimeType(JPEG)).toBe("image/jpeg");

    expect(documentService.sniffMimeType(ELF)).toBeNull();
    expect(documentService.sniffMimeType(Buffer.from("GIF89a"))).toBeNull();
    expect(documentService.sniffMimeType(Buffer.alloc(0))).toBeNull();
    expect(documentService.sniffMimeType(null)).toBeNull();
  });
});

// ===========================================================================
// Size and count
// ===========================================================================

describe("upload limits", () => {
  it("refuses a file over the cap", async () => {
    const { student, request } = await studentWithRequest();

    // PDF header, then past the limit.
    const huge = Buffer.concat([
      Buffer.from("%PDF-1.7"),
      Buffer.alloc(MAX_FILE_BYTES + 1024),
    ]);

    const res = await upload(student, request, huge, { filename: "big.pdf" });

    expect([400, 413]).toContain(res.status);
    expect(await Document.countDocuments({})).toBe(0);
  });

  it("refuses a request carrying no file", async () => {
    const { student, request } = await studentWithRequest();
    const { agent, csrfToken } = await loginAs(student.user);

    const res = await agent
      .post(`/api/v1/requests/${request.reference}/documents`)
      .set("X-CSRF-Token", csrfToken)
      .field("label", "ID proof");

    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// Who may upload
// ===========================================================================

describe("upload authorisation", () => {
  it("refuses a student attaching to someone else's request", async () => {
    const owner = await studentWithRequest();
    const intruder = await createStudent();

    const res = await upload(intruder, owner.request, PDF);

    expect(res.status).toBe(403);
    expect(await Document.countDocuments({})).toBe(0);
  });

  it("refuses a clerk attaching to a student's request", async () => {
    // Read is permitted; writing to a student's record is not.
    const owner = await studentWithRequest();
    const clerk = await createUser({ role: ROLES.SUPPORT_STAFF });

    const res = await upload(clerk, owner.request, PDF);

    expect(res.status).toBe(403);
  });

  it("requires a session", async () => {
    const request = require("supertest");
    const { student, request: req } = await studentWithRequest();

    const res = await request(getApp())
      .post(`/api/v1/requests/${req.reference}/documents`)
      .attach("file", PDF, { filename: "proof.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(401);
    expect(await Document.countDocuments({ student: student.student._id })).toBe(0);
  });

  it("requires CSRF, and never buffers the file when it refuses", async () => {
    const { student, request } = await studentWithRequest();
    const { agent } = await loginAs(student.user);

    // No X-CSRF-Token. The check runs before the multipart parser, so the
    // bytes are never read at all.
    const res = await agent
      .post(`/api/v1/requests/${request.reference}/documents`)
      .attach("file", PDF, { filename: "proof.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(403);
    expect(await Document.countDocuments({})).toBe(0);
  });
});

// ===========================================================================
// Who may read
// ===========================================================================

describe("download authorisation", () => {
  /** Attach one document and return it. */
  async function attachOne() {
    const { student, request } = await studentWithRequest();
    await upload(student, request, PDF);
    const document = await Document.findOne({});
    return { student, request, document };
  }

  it("lets the owner download their own", async () => {
    const { student, document } = await attachOne();
    const { agent } = await loginAs(student.user);

    const res = await agent.get(`/api/v1/documents/${document._id}/download`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  /**
   * The download must never be able to execute in this origin.
   *
   * A PDF is an active format. Served inline from the app's own origin, a
   * document containing script could reach the app's session and storage.
   */
  it("is served so that it cannot script the origin", async () => {
    const { student, document } = await attachOne();
    const { agent } = await loginAs(student.user);

    const res = await agent.get(`/api/v1/documents/${document._id}/download`);

    expect(res.headers["content-disposition"]).toMatch(/^attachment/);
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["content-security-policy"]).toContain("sandbox");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("404s another student's document rather than 403", async () => {
    const { document } = await attachOne();
    const intruder = await createStudent();
    const { agent } = await loginAs(intruder.user);

    const res = await agent.get(`/api/v1/documents/${document._id}/download`);

    // Not 403: confirming the id exists is itself a disclosure.
    expect(res.status).toBe(404);
  });

  it("refuses a document whose parent has gone", async () => {
    const { student, document } = await attachOne();

    await Document.updateOne(
      { _id: document._id },
      { $set: { request: new (require("mongoose").Types.ObjectId)() } }
    );

    const { agent } = await loginAs(student.user);
    const res = await agent.get(`/api/v1/documents/${document._id}/download`);

    // No parent to authorise against, so nobody may fetch it.
    expect(res.status).toBe(404);
  });

  it("rejects a malformed document id", async () => {
    const student = await createStudent();
    const { agent } = await loginAs(student.user);

    expect((await agent.get("/api/v1/documents/not-an-id/download")).status).toBe(400);
  });
});

// ===========================================================================
// Listing, required documents, removal
// ===========================================================================

describe("listing and required documents", () => {
  it("reports which required documents are still missing", async () => {
    const student = await createStudent();
    const type = await createRequestType({
      department: student.department,
      name: "Needs proof",
      requiredDocuments: [
        { name: "ID proof", description: "Identity card", required: true },
        { name: " Photograph", description: "Recent photo", required: false },
      ],
    });
    const request = await createRequest({ owner: student, requestType: type });

    const { agent } = await loginAs(student.user);

    const before = await agent.get(`/api/v1/requests/${request.reference}/documents`);
    expect(before.status).toBe(200);
    expect(before.body.meta.missing.map((m) => m.name)).toEqual(["ID proof"]);

    await upload(student, request, PDF, { label: "ID proof" });

    const after = await agent.get(`/api/v1/requests/${request.reference}/documents`);
    expect(after.body.data).toHaveLength(1);
    expect(after.body.meta.missing).toEqual([]);
  });

  it("does not let a student list another student's documents", async () => {
    const { student, request } = await studentWithRequest();
    await upload(student, request, PDF);

    const intruder = await createStudent();
    const { agent } = await loginAs(intruder.user);

    const res = await agent.get(`/api/v1/requests/${request.reference}/documents`);
    expect(res.status).toBe(404);
  });

  it("lets the uploader remove a document while the request is untouched", async () => {
    const { student, request } = await studentWithRequest();
    await upload(student, request, PDF);

    const document = await Document.findOne({});
    const { agent, csrfToken } = await loginAs(student.user);

    const res = await deleteAs(agent, csrfToken, `/api/v1/documents/${document._id}`);

    expect(res.status).toBe(200);
    expect(await Document.countDocuments({})).toBe(0);
  });

  it("refuses removal once processing has begun", async () => {
    const { student, request } = await studentWithRequest();
    await upload(student, request, PDF);

    const document = await Document.findOne({});
    const { agent, csrfToken } = await loginAs(student.user);

    // Someone else starts work on the request; the document is now evidence.
    await require("../src/models/Request").updateOne(
      { _id: request._id },
      { $set: { status: REQUEST_STATUS.UNDER_REVIEW } }
    );

    const res = await deleteAs(agent, csrfToken, `/api/v1/documents/${document._id}`);

    expect(res.status).toBe(409);
    expect(await Document.countDocuments({})).toBe(1);
  });

  it("refuses removal by anyone but the uploader", async () => {
    const { student, request } = await studentWithRequest();
    await upload(student, request, PDF);
    const document = await Document.findOne({});

    const other = await createStudent();
    const { agent, csrfToken } = await loginAs(other.user);

    const res = await deleteAs(agent, csrfToken, `/api/v1/documents/${document._id}`);

    expect(res.status).toBe(403);
    expect(await Document.countDocuments({})).toBe(1);
  });
});

// ===========================================================================
// Filenames
// ===========================================================================

describe("filenames are display-only", () => {
  it("strips path traversal from a recorded name", () => {
    expect(documentService.safeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(documentService.safeDisplayName("....//x.png")).toBe("x.png");
    expect(documentService.safeDisplayName("a\u0000b.png")).toBe("ab.png");
  });

  it("keeps an ordinary name readable", () => {
    expect(documentService.safeDisplayName("Bonafide ID proof.pdf")).toBe(
      "Bonafide ID proof.pdf"
    );
  });

  it("does not let a traversal name influence the stored key", async () => {
    const { student, request } = await studentWithRequest();
    await upload(student, request, PDF, { filename: "../../../etc/passwd" });

    const document = await Document.findOne({});
    // The key is generated by the storage adapter, under our own folder.
    expect(document.storageKey.startsWith("documents/")).toBe(true);
    expect(document.storageKey).not.toContain("..");
  });
});
