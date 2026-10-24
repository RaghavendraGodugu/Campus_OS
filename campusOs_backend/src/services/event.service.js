const { ApiError } = require("../utils/ApiError");
const auditService = require("./audit.service");
const Event = require("../models/Event");
const EventRsvp = require("../models/EventRsvp");
const { AUDIT_ACTION } = require("../config/constants");
const { userHasPermission } = require("../utils/permissions");

/**
 * Events.
 *
 * The publish shape follows placements because that is the shape the campus
 * understands: a draft belongs to its organisers and a published event belongs
 * to everybody who signs in. An RSVP is a ledger row, not a counter field —
 * capacity compares against a count that is always current, and one record per
 * person is a database constraint rather than a hope. Release of a form field
 * into a published document is not possible here; editing after publish is
 * allowed, and every edit is audited.
 */
async function assertManage(user) {
  if (!userHasPermission(user, "event:manage:institution")) {
    throw ApiError.forbidden("You cannot manage events");
  }
}

/**
 * Calendar sense: an event must end no earlier than it starts.
 *
 * Ending exactly at the start is fine — a seminar of unknown duration is
 * planned that way all the time.
 */
function assertSaneDates(startsAt, endsAt) {
  if (endsAt && startsAt && endsAt < startsAt) {
    throw ApiError.badRequest("An event cannot end before it starts");
  }
}

/**
 * Status moves are one-way and finish-state aware: draft → published →
 * cancelled, and a draft may be cancelled too. A cancelled event does not go
 * back to a draft and a published one cannot un-publish — students who acted
 * on the published notice would find either reversal dishonest.
 */
function assertStatusTransition(from, to) {
  if (from === to) return;
  const allowed =
    (from === "DRAFT" && to === "PUBLISHED") ||
    (from === "DRAFT" && to === "CANCELLED") ||
    (from === "PUBLISHED" && to === "CANCELLED");
  if (!allowed) {
    throw ApiError.invalidTransition(`An event cannot move from ${from} to ${to}`);
  }
}

async function listEvents({ user }) {
  const canManage = userHasPermission(user, "event:manage:institution");

  const filter = canManage ? {} : { status: "PUBLISHED" };
  const events = await Event.find(filter)
    .sort({ startsAt: -1 })
    .limit(200)
    .lean();

  const counts = await EventRsvp.aggregate([
    { $group: { _id: "$event", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((row) => [String(row._id), row.count]));

  const mineRows = await EventRsvp.find({ user: user.id })
    .select({ event: 1, _id: 0 })
    .lean();
  const mineSet = new Set(mineRows.map((row) => String(row.event)));

  return events.map((event) => ({
    ...event,
    id: String(event._id),
    rsvpCount: countMap.get(String(event._id)) ?? 0,
    rsvped: mineSet.has(String(event._id)),
  }));
}

async function getEventOr404(id) {
  const event = await Event.findById(id);
  if (!event) throw ApiError.notFound("No such event");
  return event;
}

async function createEvent({ user, payload, req }) {
  await assertManage(user);
  assertSaneDates(payload.startsAt, payload.endsAt);

  const created = await Event.create({
    ...payload,
    status: "DRAFT",
    postedBy: user.id,
  });
  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.CREATE,
    entity: "Event",
    entityId: created._id,
    entityRef: created.title,
    req,
  });
  return created.toJSON();
}

async function updateEvent({ user, id, payload, req }) {
  await assertManage(user);
  const existing = await getEventOr404(id);

  assertSaneDates(payload.startsAt ?? existing.startsAt, payload.endsAt ?? existing.endsAt);
  if (payload.status && payload.status !== existing.status) {
    assertStatusTransition(existing.status, payload.status);
  }

  Object.assign(existing, payload);
  await existing.save();

  await auditService.record({
    actor: user,
    action: payload.status ? AUDIT_ACTION.STATUS_TRANSITION : AUDIT_ACTION.UPDATE,
    entity: "Event",
    entityId: existing._id,
    entityRef: existing.title,
    metadata: payload.status ? { from: existing.status, to: payload.status } : undefined,
    req,
  });

  // Re-read so the response shows the saved truth and the transitions stamp.
  return (await Event.findById(existing._id)).toJSON();
}

/**
 * Hold a seat.
 *
 * The unique compound index is the race handler: when two humans click at
 * once, one write belongs to the database and the other is told so. Capacity
 * keeps seats for whoever counted in first.
 */
async function rsvp({ user, id, req }) {
  const event = await getEventOr404(id);
  if (event.status === "DRAFT") {
    throw ApiError.notFound("No such event");
  }
  if (event.status === "CANCELLED") {
    throw ApiError.conflict("That event has been cancelled");
  }
  // Registers close when the event begins. A headcount is promised to the
  // organisers before the session runs, not negotiated at the door.
  if (event.startsAt && event.startsAt <= new Date()) {
    throw ApiError.conflict("That event has already started");
  }

  try {
    if (event.capacity !== undefined && event.capacity !== null) {
      const held = await EventRsvp.countDocuments({ event: event._id });
      if (held >= event.capacity) {
        throw ApiError.conflict("That event is full");
      }
    }
    await EventRsvp.create({ event: event._id, user: user.id });
  } catch (error) {
    // Two people clicking at once: one write wins the unique index, the other
    // lands on the loser's answer instead of a 500.
    if (error.code === 11000) {
      throw ApiError.conflict("You are already registered for that event");
    }
    throw error;
  }
  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.CREATE,
    entity: "EventRsvp",
    entityId: event._id,
    entityRef: `${event.title} — seat held`,
    req,
  });

  return { rsvped: true };
}

/** Give the seat back. */
async function withdraw({ user, id, req }) {
  const event = await getEventOr404(id);
  const removed = await EventRsvp.deleteOne({
    event: event._id,
    user: user.id,
  });
  if (removed.deletedCount === 0) {
    throw ApiError.notFound("You are not registered for that event");
  }
  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.DELETE,
    entity: "EventRsvp",
    entityId: event._id,
    entityRef: `${event.title} — seat released`,
    req,
  });

  return { rsvped: false };
}

module.exports = {
  listEvents,
  createEvent,
  updateEvent,
  rsvp,
  withdraw,
};
