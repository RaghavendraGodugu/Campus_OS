/**
 * Events: the campus calendar and the seats held at it.
 *
 * The invariants that make the module real: a draft belongs to its organisers
 * and to nobody else, publishing is a decision with an audit line behind it,
 * one seat register per person is a database constraint (the loser of a race
 * gets a 409, not a 500), capacity compares against a live count, and an
 * event that is cancelled or already run accepts no further registers.
 */

const request = require("supertest");

const {
  getApp,
  resetDatabase,
  createDepartment,
  createProgram,
  createUser,
  createStudent,
  loginAs,
} = require("./helpers/factory");
const eventService = require("../src/services/event.service");
const { ROLES, AUDIT_ACTION } = require("../src/config/constants");
const AuditLog = require("../src/models/AuditLog");
const { P } = require("../src/utils/permissions");
const { permissionsFor } = require("../src/utils/permissions");

beforeEach(resetDatabase);

async function seed() {
  const department = await createDepartment();
  const program = await createProgram(department);
  const dean = await createUser({ role: ROLES.DEAN });
  const student = await createStudent({ department, program });
  const support = await createUser({ role: ROLES.SUPPORT_STAFF });
  const second = await createStudent({ department, program });
  return { department, program, dean, student, support, second };
}

/** A workshop three weeks out, so an RSVP is never refused on its dates. */
function sessionPayload(overrides = {}) {
  const starts = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
  return {
    title: "Intro to Git across the semester",
    description:
      "A hands-on workshop: branches, reviews, cleaning history before viva week.",
    kind: "WORKSHOP",
    venue: "CSE Lab 2",
    startsAt: starts.toISOString(),
    contact: "cse-office",
    ...overrides,
  };
}

async function published(world, overrides = {}) {
  const created = await eventService.createEvent({
    user: world.dean,
    payload: sessionPayload(overrides),
  });
  return eventService.updateEvent({
    user: world.dean,
    id: created.id,
    payload: { status: "PUBLISHED" },
  });
}

describe("the roles, at the permission layer", () => {
  it("lets every role read; DEAN and SUPER_ADMIN alone manage", () => {
    expect(permissionsFor(ROLES.STUDENT)).toContain(P.EVENT_READ);
    expect(permissionsFor(ROLES.SUPPORT_STAFF)).toContain(P.EVENT_READ);
    expect(permissionsFor(ROLES.DEAN)).toContain(P.EVENT_MANAGE);
    expect(permissionsFor(ROLES.SUPER_ADMIN)).toContain(P.EVENT_MANAGE);
    for (const role of [ROLES.STUDENT, ROLES.SUPPORT_STAFF, ROLES.HOD]) {
      expect(permissionsFor(role)).not.toContain(P.EVENT_MANAGE);
    }
  });
});

describe("publishing and visibility", () => {
  it("keeps a draft from the students it is not yet about", async () => {
    const world = await seed();
    await eventService.createEvent({
      user: world.dean,
      payload: sessionPayload(),
    });

    const visible = await eventService.listEvents({ user: world.student.user });
    expect(visible).toHaveLength(0);

    const organiser = await eventService.listEvents({ user: world.dean });
    expect(organiser).toHaveLength(1);
    expect(organiser[0].status).toBe("DRAFT");
  });

  it("shows the event on the student calendar once published", async () => {
    const world = await seed();
    await published(world);

    const after = await eventService.listEvents({ user: world.student.user });
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("PUBLISHED");
  });

  it("refuses to un-publish a published event", async () => {
    const world = await seed();
    const event = await published(world);

    await expect(
      eventService.updateEvent({
        user: world.dean,
        id: event.id,
        payload: { status: "DRAFT" },
      })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("stops a cancelled event from returning to the calendar", async () => {
    const world = await seed();
    const event = await published(world);
    await eventService.updateEvent({
      user: world.dean,
      id: event.id,
      payload: { status: "CANCELLED" },
    });

    await expect(
      eventService.updateEvent({
        user: world.dean,
        id: event.id,
        payload: { status: "PUBLISHED" },
      })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    const visible = await eventService.listEvents({ user: world.student.user });
    expect(visible).toHaveLength(0);
  });

  it("writes the publish decision to the audit trail", async () => {
    const world = await seed();
    const event = await published(world);

    const line = await AuditLog.findOne({
      action: AUDIT_ACTION.STATUS_TRANSITION,
      entity: "EVENT",
    }).sort({ createdAt: -1 });
    expect(line).toBeTruthy();
    expect(line.metadata.to).toBe("PUBLISHED");
    expect(String(line.entityId)).toBe(String(event.id));
  });

  it("refuses an event that ends before it starts", async () => {
    const world = await seed();
    await expect(
      eventService.createEvent({
        user: world.dean,
        payload: sessionPayload({
          endsAt: new Date(Date.now() + 1000).toISOString(),
        }),
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a shift of a published event into an end before its start", async () => {
    const world = await seed();
    const event = await published(world);
    const before = new Date(event.createdAt).getTime();

    await expect(
      eventService.updateEvent({
        user: world.dean,
        id: event.id,
        payload: {
          startsAt: new Date(before + 10_000).toISOString(),
          endsAt: new Date(before).toISOString(),
        },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("seats", () => {
  it("registers once and only once", async () => {
    const world = await seed();
    const event = await published(world);

    await expect(
      eventService.rsvp({ user: world.student.user, id: event.id })
    ).resolves.toMatchObject({ rsvped: true });
    await expect(
      eventService.rsvp({ user: world.student.user, id: event.id })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("gives the seat back on withdrawal, so someone else can take it", async () => {
    const world = await seed();
    const event = await published(world, { capacity: 1 });

    await eventService.rsvp({ user: world.student.user, id: event.id });
    await expect(
      eventService.withdraw({ user: world.student.user, id: event.id })
    ).resolves.toMatchObject({ rsvped: false });
    await expect(
      eventService.rsvp({ user: world.second.user, id: event.id })
    ).resolves.toMatchObject({ rsvped: true });
  });

  it("closes the room at capacity and says what happened", async () => {
    const world = await seed();
    const event = await published(world, { capacity: 1 });

    await eventService.rsvp({ user: world.student.user, id: event.id });
    await expect(
      eventService.rsvp({ user: world.second.user, id: event.id })
    ).rejects.toMatchObject({ statusCode: 409, message: /full/ });
  });

  it("refuses to withdraw a seat that was never held", async () => {
    const world = await seed();
    const event = await published(world);
    await expect(
      eventService.withdraw({ user: world.student.user, id: event.id })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("refuses a register on a draft, which does not exist for the student", async () => {
    const world = await seed();
    const created = await eventService.createEvent({
      user: world.dean,
      payload: sessionPayload(),
    });
    await expect(
      eventService.rsvp({ user: world.student.user, id: created.id })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("refuses a register on a cancelled event", async () => {
    const world = await seed();
    const event = await published(world);
    await eventService.updateEvent({
      user: world.dean,
      id: event.id,
      payload: { status: "CANCELLED" },
    });

    await expect(
      eventService.rsvp({ user: world.student.user, id: event.id })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses a register after the event has started", async () => {
    const world = await seed();
    const event = await published(world, {
      startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    await expect(
      eventService.rsvp({ user: world.student.user, id: event.id })
    ).rejects.toMatchObject({ statusCode: 409, message: /started/ });
  });
});

describe("over HTTP", () => {
  it("refuses a support staff member managing the calendar", async () => {
    const world = await seed();
    const { agent, csrfToken } = await loginAs(world.support);

    const res = await agent
      .post("/api/v1/events")
      .set("X-CSRF-Token", csrfToken)
      .send(sessionPayload());

    expect(res.status).toBe(403);
  });

  it("reads the calendar because that is a base grant", async () => {
    const world = await seed();
    await published(world);

    const { agent } = await loginAs(world.student.user);
    const res = await agent.get("/api/v1/events");
    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(1);
  });

  it("answers 401 without a session", async () => {
    await seed();
    const res = await request(await getApp()).get("/api/v1/events");
    expect(res.status).toBe(401);
  });

  it("manages a creation, publish and shift for the office that does it", async () => {
    const world = await seed();
    const { agent, csrfToken } = await loginAs(world.dean);

    const create = await agent
      .post("/api/v1/events")
      .set("X-CSRF-Token", csrfToken)
      .send(sessionPayload());
    expect(create.status).toBe(201);
    const created = create.body.data.event;

    const publish = await agent
      .patch(`/api/v1/events/${created.id}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ status: "PUBLISHED" });
    expect(publish.status).toBe(200);

    const shift = await agent
      .patch(`/api/v1/events/${created.id}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ venue: "Seminar Hall B" });
    expect(shift.status).toBe(200);
    expect(shift.body.data.event.venue).toBe("Seminar Hall B");

    // A genuine validation failure at the edge, so the shape of a 400 is
    // pinned too.
    const bad = await agent
      .post("/api/v1/events")
      .set("X-CSRF-Token", csrfToken)
      .send({ title: "x" });
    expect(bad.status).toBe(400);
  });

  it("holds and releases a seat through the register and withdraw endpoints", async () => {
    const world = await seed();
    const event = await published(world, { capacity: 1 });

    const registrar = await loginAs(world.student.user);
    const hold = await registrar.agent
      .post(`/api/v1/events/${event.id}/rsvp`)
      .set("X-CSRF-Token", registrar.csrfToken);
    expect(hold.status).toBe(201);

    const straightAfter = await registrar.agent.get("/api/v1/events");
    expect(straightAfter.body.data.events[0].rsvped).toBe(true);
    expect(straightAfter.body.data.events[0].rsvpCount).toBe(1);

    const seatFills = await loginAs(world.second.user);
    const tooLate = await seatFills.agent
      .post(`/api/v1/events/${event.id}/rsvp`)
      .set("X-CSRF-Token", seatFills.csrfToken);
    expect(tooLate.status).toBe(409);

    const release = await registrar.agent
      .delete(`/api/v1/events/${event.id}/rsvp`)
      .set("X-CSRF-Token", registrar.csrfToken);
    expect(release.status).toBe(200);
    expect(release.body.data.rsvped).toBe(false);

    await expect(
      eventService.rsvp({ user: world.second.user, id: event.id })
    ).resolves.toMatchObject({ rsvped: true });
  });
});
