/**
 * Hostel: blocks, rooms, allocations and leave.
 *
 * The invariants are small but load-bearing: one active allocation per student,
 * a room never over capacity, and leave only against an active allocation. The
 * partial unique index enforces the first; the other two are checked here,
 * where the room can be read inside the same request.
 */
const Hostel = require("../models/Hostel");
const HostelRoom = require("../models/HostelRoom");
const HostelAllocation = require("../models/HostelAllocation");
const HostelLeave = require("../models/HostelLeave");
const Student = require("../models/Student");
const {
  AUDIT_ACTION,
  HOSTEL_ALLOCATION_STATUS,
  HOSTEL_LEAVE_STATUS,
} = require("../config/constants");
const { ApiError } = require("../utils/ApiError");
const { P, userHasPermission } = require("../utils/permissions");
const auditService = require("./audit.service");

function assertManage(user) {
  if (!userHasPermission(user, P.HOSTEL_MANAGE)) {
    throw ApiError.forbidden("You do not have permission to manage the hostel");
  }
}

function assertApprove(user) {
  if (!userHasPermission(user, P.HOSTEL_APPROVE)) {
    throw ApiError.forbidden("You do not have permission to decide hostel leave");
  }
}

async function studentFor(user) {
  const { resolveStudentProfile } = require("../middleware/auth");
  return resolveStudentProfile(user);
}

const ROOM_POPULATE = [{ path: "hostel", select: "name code kind" }];

async function listHostels() {
  const hostels = await Hostel.find().sort({ name: 1 }).lean();
  const ids = hostels.map((h) => h._id);
  const rooms = await HostelRoom.find({ hostel: { $in: ids }, isActive: true }).lean();
  const occupancy = await HostelAllocation.aggregate([
    { $match: { status: HOSTEL_ALLOCATION_STATUS.ACTIVE } },
    { $group: { _id: "$hostel", occupied: { $sum: 1 } } },
  ]);
  const byHostel = new Map(occupancy.map((row) => [String(row._id), row.occupied]));

  return hostels.map((hostel) => {
    const own = rooms.filter((room) => String(room.hostel) === String(hostel._id));
    return {
      ...hostel,
      id: String(hostel._id),
      roomCount: own.length,
      capacity: own.reduce((sum, room) => sum + room.capacity, 0),
      occupied: byHostel.get(String(hostel._id)) ?? 0,
    };
  });
}

async function createHostel({ user, payload, req }) {
  assertManage(user);
  const existing = await Hostel.findOne({
    $or: [{ name: payload.name }, { code: payload.code }],
  });
  if (existing) throw ApiError.conflict("A hostel with that name or code already exists");

  const hostel = await Hostel.create(payload);
  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.CREATE,
    entity: "Hostel",
    entityId: hostel._id,
    entityRef: hostel.code,
    metadata: { kind: hostel.kind },
    req,
  });
  return hostel.toJSON();
}

async function listRooms(hostelId) {
  return HostelRoom.find({ hostel: hostelId, isActive: true })
    .populate(...ROOM_POPULATE)
    .sort({ number: 1 })
    .lean();
}

async function createRoom({ user, hostelId, payload, req }) {
  assertManage(user);
  const hostel = await Hostel.findById(hostelId);
  if (!hostel) throw ApiError.notFound("Hostel not found");

  const existing = await HostelRoom.findOne({
    hostel: hostel._id,
    number: payload.number,
  });
  if (existing) throw ApiError.conflict("That room already exists in this hostel");

  const room = await HostelRoom.create({ ...payload, hostel: hostel._id });
  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.CREATE,
    entity: "HostelRoom",
    entityId: room._id,
    entityRef: `${hostel.code}-${room.number}`,
    metadata: { capacity: room.capacity },
    req,
  });
  return room.toJSON();
}

async function allocate({ user, payload, req }) {
  assertManage(user);
  const student = await Student.findById(payload.student);
  if (!student) throw ApiError.notFound("Student not found");

  const room = await HostelRoom.findById(payload.room).populate(...ROOM_POPULATE);
  if (!room || !room.isActive) throw ApiError.notFound("Room not found");

  const active = await HostelAllocation.findOne({
    student: student._id,
    status: HOSTEL_ALLOCATION_STATUS.ACTIVE,
  });
  if (active) throw ApiError.conflict("That student already has an active allocation");

  const occupied = await HostelAllocation.countDocuments({
    room: room._id,
    status: HOSTEL_ALLOCATION_STATUS.ACTIVE,
  });
  if (occupied >= room.capacity) throw ApiError.conflict("That room is full");

  const allocation = await HostelAllocation.create({
    student: student._id,
    hostel: room.hostel._id,
    room: room._id,
    academicYear: payload.academicYear,
    allocatedBy: user._id,
  });

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.HOSTEL_ALLOCATED,
    entity: "HostelAllocation",
    entityId: allocation._id,
    entityRef: student.rollNumber,
    metadata: { room: String(room._id), hostel: String(room.hostel._id) },
    req,
  });
  return allocation.toJSON();
}

async function vacate({ user, id, req }) {
  assertManage(user);
  const allocation = await HostelAllocation.findById(id);
  if (!allocation) throw ApiError.notFound("Allocation not found");
  if (allocation.status === HOSTEL_ALLOCATION_STATUS.VACATED) return allocation.toJSON();

  allocation.status = HOSTEL_ALLOCATION_STATUS.VACATED;
  allocation.vacatedAt = new Date();
  allocation.vacatedBy = user._id;
  await allocation.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.HOSTEL_VACATED,
    entity: "HostelAllocation",
    entityId: allocation._id,
    metadata: { room: String(allocation.room) },
    req,
  });
  return allocation.toJSON();
}

async function listAllocations({ status } = {}) {
  const filter = {};
  if (status) filter.status = status;
  return HostelAllocation.find(filter)
    .populate({
      path: "student",
      select: "rollNumber semester",
      populate: { path: "user", select: "fullName" },
    })
    .populate("hostel", "name code")
    .populate("room", "number capacity")
    .sort({ allocatedAt: -1 })
    .lean();
}

async function mine({ user }) {
  const student = await studentFor(user);
  if (!student) {
    return { allocation: null, leaves: [] };
  }
  const allocation = await HostelAllocation.findOne({
    student: student._id,
    status: HOSTEL_ALLOCATION_STATUS.ACTIVE,
  })
    .populate("hostel", "name code kind")
    .populate("room", "number capacity")
    .lean();

  const leaves = await HostelLeave.find({ student: student._id })
    .sort({ fromDate: -1 })
    .lean();
  return { allocation, leaves };
}

async function requestLeave({ user, payload, req }) {
  const student = await studentFor(user);
  if (!student) {
    throw ApiError.badRequest("You need an active hostel allocation to request leave");
  }
  const allocation = await HostelAllocation.findOne({
    student: student._id,
    status: HOSTEL_ALLOCATION_STATUS.ACTIVE,
  });
  if (!allocation)
    throw ApiError.badRequest("You need an active hostel allocation to request leave");

  if (payload.toDate < payload.fromDate) {
    throw ApiError.badRequest("Leave cannot end before it begins");
  }

  const leave = await HostelLeave.create({
    student: student._id,
    allocation: allocation._id,
    fromDate: payload.fromDate,
    toDate: payload.toDate,
    reason: payload.reason,
  });

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.HOSTEL_LEAVE_REQUESTED,
    entity: "HostelLeave",
    entityId: leave._id,
    metadata: { from: leave.fromDate, to: leave.toDate },
    req,
  });
  return leave.toJSON();
}

async function listLeaves({ status } = {}) {
  const filter = {};
  if (status) filter.status = status;
  return HostelLeave.find(filter)
    .populate({
      path: "student",
      select: "rollNumber",
      populate: { path: "user", select: "fullName" },
    })
    .sort({ fromDate: -1 })
    .lean();
}

async function decideLeave({ user, id, payload, req }) {
  assertApprove(user);
  const leave = await HostelLeave.findById(id);
  if (!leave) throw ApiError.notFound("Leave request not found");
  if (leave.status !== HOSTEL_LEAVE_STATUS.PENDING) {
    throw ApiError.conflict("That leave request has already been decided");
  }

  leave.status = payload.decision;
  leave.decidedBy = user._id;
  leave.decidedAt = new Date();
  leave.decisionNote = payload.note ?? "";
  await leave.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.HOSTEL_LEAVE_DECIDED,
    entity: "HostelLeave",
    entityId: leave._id,
    metadata: { decision: leave.status },
    req,
  });
  return leave.toJSON();
}

module.exports = {
  listHostels,
  createHostel,
  listRooms,
  createRoom,
  allocate,
  vacate,
  listAllocations,
  mine,
  requestLeave,
  listLeaves,
  decideLeave,
};
