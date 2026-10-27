/**
 * Rooms — the physical spaces a timetable can be scheduled into.
 *
 * ## Why rooms are institution-wide and not department-owned
 *
 * A lecture hall belongs to the campus, not to the department that happens to
 * use it at 10:00. Modelling ownership per department would mean the same room
 * exists twice, and the two copies could be double-booked. Rooms therefore have
 * a single institution-wide manager (`room:manage:institution`), held by
 * EXAM_ADMIN and SUPER_ADMIN, and the clash check is global.
 */

const Room = require("../models/Room");
const TimetableEntry = require("../models/TimetableEntry");
const { AUDIT_ACTION } = require("../config/constants");
const { ApiError } = require("../utils/ApiError");
const { P, userHasPermission } = require("../utils/permissions");
const { escapeRegex, parseActiveFilter } = require("../utils/academicScope");
const auditService = require("./audit.service");

function assertCanManage(user) {
  if (!userHasPermission(user, P.ROOM_MANAGE)) {
    throw ApiError.forbidden("You do not have permission to manage rooms");
  }
}

async function list({ query = {} } = {}) {
  const filter = {};

  const active = parseActiveFilter(query.active, true);
  if (active !== undefined) filter.isActive = active;
  if (query.kind) filter.kind = query.kind;

  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ name: pattern }, { block: pattern }];
  }

  return Room.find(filter).sort({ block: 1, name: 1 });
}

async function getById(id) {
  const room = await Room.findById(id);
  if (!room) {
    throw ApiError.notFound("Room not found");
  }
  return room;
}

async function create({ user, payload, req }) {
  assertCanManage(user);

  const block = payload.block ?? "";
  const duplicate = await Room.findOne({ block, name: payload.name }).select("_id");
  if (duplicate) {
    throw ApiError.conflict(
      `A room named ${payload.name} already exists${block ? ` in ${block}` : ""}`
    );
  }

  const room = await Room.create({ ...payload, block });
  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ROOM_CREATED,
    entity: "Room",
    entityId: room._id,
    entityRef: room.name,
    metadata: { block: room.block, kind: room.kind, capacity: room.capacity },
    req,
  });

  return room.toJSON();
}

async function update({ user, id, payload, req }) {
  assertCanManage(user);

  const room = await Room.findById(id);
  if (!room) {
    throw ApiError.notFound("Room not found");
  }

  const block = payload.block ?? room.block;
  const name = payload.name ?? room.name;

  if (payload.name !== undefined || payload.block !== undefined) {
    const duplicate = await Room.findOne({
      _id: { $ne: room._id },
      block,
      name,
    }).select("_id");
    if (duplicate) {
      throw ApiError.conflict(
        `A room named ${name} already exists in ${block || "that block"}`
      );
    }
  }

  Object.assign(room, payload);
  await room.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ROOM_UPDATED,
    entity: "Room",
    entityId: room._id,
    entityRef: room.name,
    metadata: {
      changed: Object.keys(payload),
      block: room.block,
      kind: room.kind,
      isActive: room.isActive,
    },
    req,
  });

  return room.toJSON();
}

/**
 * Retire a room, reporting how many classes still use it.
 *
 * The classes are not cancelled. A room taken out of service while a timetable
 * still points at it is a scheduling problem an administrator has to see and
 * fix, so the count is returned rather than the deletion being blocked. Blocking
 * would leave no way to take a condemned lab out of service at all.
 */
async function retire({ user, id, req }) {
  assertCanManage(user);

  const room = await Room.findById(id);
  if (!room) {
    throw ApiError.notFound("Room not found");
  }

  if (!room.isActive) {
    return room.toJSON();
  }

  const scheduled = await TimetableEntry.countDocuments({
    room: room._id,
    isActive: true,
  });

  room.isActive = false;
  await room.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ROOM_RETIRED,
    entity: "Room",
    entityId: room._id,
    entityRef: room.name,
    metadata: { block: room.block, activeEntries: scheduled },
    req,
  });

  return { ...room.toJSON(), activeEntries: scheduled };
}

module.exports = {
  list,
  getById,
  create,
  update,
  retire,
};
