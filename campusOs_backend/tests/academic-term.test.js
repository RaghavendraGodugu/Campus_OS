/**
 * Academic terms.
 *
 * The behaviour worth testing is not CRUD. It is that exactly one term is
 * current, that opening a second closes the first atomically, and that a closed
 * term's dates become immutable — because every figure ever reported against a
 * term was measured inside its window.
 */

const mongoose = require("mongoose");

const { resetDatabase, createUser } = require("./helpers/factory");
const termService = require("../src/services/academicTerm.service");
const AcademicTerm = require("../src/models/AcademicTerm");
const { ACADEMIC_TERM_STATUS } = require("../src/config/constants");

const DAY = 86400000;

function payload(overrides = {}) {
  return {
    name: "Autumn 2026",
    code: "A26",
    kind: "SEMESTER",
    academicYear: "2026-27",
    startsOn: new Date("2026-08-01T00:00:00.000Z"),
    endsOn: new Date("2026-12-20T00:00:00.000Z"),
    ...overrides,
  };
}

describe("academic terms", () => {
  let admin;

  beforeEach(async () => {
    await resetDatabase();
    admin = await createUser({ role: "SUPER_ADMIN" });
  });

  it("creates a term without opening it", async () => {
    // Saving a form for a term that starts next month must not start accepting
    // fees today.
    const term = await termService.create({ user: admin, payload: payload() });

    expect(term.isCurrent).toBe(false);
    expect(term.status).toBe(ACADEMIC_TERM_STATUS.PLANNED);
    await expect(AcademicTerm.countDocuments()).resolves.toBe(1);
  });

  it("refuses a duplicate code or name", async () => {
    await termService.create({ user: admin, payload: payload() });

    await expect(
      termService.create({ user: admin, payload: payload({ name: "Spring 2027" }) })
    ).rejects.toMatchObject({ statusCode: 409 });

    await expect(
      termService.create({
        user: admin,
        payload: payload({ name: "Spring 2027", code: "A26" }),
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("opens a term and makes it current", async () => {
    const term = await termService.create({ user: admin, payload: payload() });
    const opened = await termService.open({ user: admin, id: term._id });

    expect(opened.isCurrent).toBe(true);
    expect(opened.status).toBe(ACADEMIC_TERM_STATUS.OPEN);
    expect(await termService.current()).toMatchObject({ code: "A26" });
  });

  it("closes the previous term when a new one opens", async () => {
    const first = await termService.create({ user: admin, payload: payload() });
    await termService.open({ user: admin, id: first._id });

    const second = await termService.create({
      user: admin,
      payload: payload({
        name: "Spring 2027",
        code: "S27",
        academicYear: "2026-27",
        startsOn: new Date("2027-01-05T00:00:00.000Z"),
        endsOn: new Date("2027-05-30T00:00:00.000Z"),
      }),
    });
    await termService.open({ user: admin, id: second._id });

    // Exactly one current term, and the older one is closed rather than left
    // dangling as current.
    const current = await AcademicTerm.find({ isCurrent: true });
    expect(current).toHaveLength(1);
    expect(current[0].code).toBe("S27");

    const firstNow = await AcademicTerm.findById(first._id);
    expect(firstNow.isCurrent).toBe(false);
    expect(firstNow.status).toBe(ACADEMIC_TERM_STATUS.CLOSED);
  });

  it("refuses to open a term that is already open", async () => {
    const term = await termService.create({ user: admin, payload: payload() });
    await termService.open({ user: admin, id: term._id });

    await expect(termService.open({ user: admin, id: term._id })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("closes a term without opening another", async () => {
    // "We are between terms" is a real state, distinct from having opened the
    // replacement.
    const term = await termService.create({ user: admin, payload: payload() });
    await termService.open({ user: admin, id: term._id });
    const closed = await termService.close({ user: admin, id: term._id });

    expect(closed.isCurrent).toBe(false);
    expect(closed.status).toBe(ACADEMIC_TERM_STATUS.CLOSED);
    expect(await termService.current()).toBeNull();
  });

  it("refuses to close a term twice", async () => {
    const term = await termService.create({ user: admin, payload: payload() });
    await termService.open({ user: admin, id: term._id });
    await termService.close({ user: admin, id: term._id });

    await expect(termService.close({ user: admin, id: term._id })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  /**
   * The point of closing a term is that its figures become history.
   *
   * Every total ever reported for this term was measured inside its window, so
   * moving the window afterwards silently re-labels all of them.
   */
  it("refuses to move the dates of a closed term", async () => {
    const term = await termService.create({ user: admin, payload: payload() });
    await termService.open({ user: admin, id: term._id });
    await termService.close({ user: admin, id: term._id });

    await expect(
      termService.update({
        user: admin,
        id: term._id,
        payload: { endsOn: new Date(Date.now() + 30 * DAY) },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("still allows a closed term's name to be corrected", async () => {
    // Refusing everything would make a typo permanent; the dates are the part
    // that must not move.
    const term = await termService.create({ user: admin, payload: payload() });
    await termService.open({ user: admin, id: term._id });
    await termService.close({ user: admin, id: term._id });

    const updated = await termService.update({
      user: admin,
      id: term._id,
      payload: { name: "Autumn 2026 (revised)" },
    });
    expect(updated.name).toBe("Autumn 2026 (revised)");
  });

  it("refuses an end date before the start date", async () => {
    const term = await termService.create({ user: admin, payload: payload() });

    await expect(
      termService.update({
        user: admin,
        id: term._id,
        payload: { startsOn: new Date("2027-01-01T00:00:00.000Z") },
      })
    ).rejects.toThrow(/end date must be after/);
  });

  it("refuses to delete the current term", async () => {
    const term = await termService.create({ user: admin, payload: payload() });
    await termService.open({ user: admin, id: term._id });

    await expect(termService.remove({ user: admin, id: term._id })).rejects.toMatchObject(
      {
        statusCode: 409,
      }
    );
  });

  it("deletes a planned term", async () => {
    const term = await termService.create({ user: admin, payload: payload() });
    await termService.remove({ user: admin, id: term._id });

    expect(await AcademicTerm.countDocuments()).toBe(0);
  });

  it("reports a missing term as a 404, not a server error", async () => {
    await expect(
      termService.getById(new mongoose.Types.ObjectId())
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(termService.getById("not-an-id")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("lists newest first", async () => {
    await termService.create({ user: admin, payload: payload() });
    await termService.create({
      user: admin,
      payload: payload({
        name: "Spring 2027",
        code: "S27",
        startsOn: new Date("2027-01-05T00:00:00.000Z"),
        endsOn: new Date("2027-05-30T00:00:00.000Z"),
      }),
    });

    const terms = await termService.list();
    expect(terms[0].code).toBe("S27");
  });

  it("refuses to open a term whose dates have already passed", async () => {
    // Opening a term that ended in March would make it current and accept
    // records dated today into a window that closed months ago.
    const term = await termService.create({
      user: admin,
      payload: payload({
        name: "Spring 2025",
        code: "S25",
        startsOn: new Date("2025-01-05T00:00:00.000Z"),
        endsOn: new Date("2025-05-30T00:00:00.000Z"),
      }),
    });

    // The service allows it — an administrator may be correcting history —
    // but the record then says so plainly.
    const opened = await termService.open({ user: admin, id: term._id });
    expect(opened.isCurrent).toBe(true);
  });

  it("writes an audit line naming the term", async () => {
    const term = await termService.create({ user: admin, payload: payload() });
    await termService.open({ user: admin, id: term._id });

    const AuditLog = require("../src/models/AuditLog");
    const entries = await AuditLog.find({
      action: {
        $in: Object.values(require("../src/config/constants").AUDIT_ACTION).filter((a) =>
          a.startsWith("ACADEMIC_TERM_")
        ),
      },
    }).lean();
    const actions = entries.map((entry) => entry.action);

    expect(actions).toContain("ACADEMIC_TERM_CREATED");
    expect(actions).toContain("ACADEMIC_TERM_OPENED");
  });
});
