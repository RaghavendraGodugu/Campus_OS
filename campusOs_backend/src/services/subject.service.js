/**
 * Subjects — the teachable catalogue behind every timetable.
 *
 * ## Scope
 *
 * Reading is institution-wide and intentionally so: a subject list is
 * reference data, not personal data. Writing is either institution-wide
 * (EXAM_ADMIN, SUPER_ADMIN) or department-scoped (HOD), and the service
 * re-checks that boundary even though the route already gated the permission.
 * The route answers "may this role manage subjects?"; only the service can
 * answer "may this HOD manage *this* subject?".
 */

const Subject = require("../models/Subject");
const Program = require("../models/Program");
const Department = require("../models/Department");
const TimetableEntry = require("../models/TimetableEntry");
const { AUDIT_ACTION } = require("../config/constants");
const { ApiError } = require("../utils/ApiError");
const { P, userHasPermission } = require("../utils/permissions");
const {
  assertCanManageDepartment,
  escapeRegex,
  parseActiveFilter,
} = require("../utils/academicScope");
const auditService = require("./audit.service");

const MANAGE = {
  institution: P.SUBJECT_MANAGE,
  department: P.SUBJECT_MANAGE_DEPARTMENT,
  message: "You cannot manage subjects for that department",
};

async function list({ query = {} } = {}) {
  const filter = {};

  if (query.program) filter.program = query.program;
  if (query.department) filter.department = query.department;
  if (query.semester) filter.semester = query.semester;

  const active = parseActiveFilter(query.active, true);
  if (active !== undefined) filter.isActive = active;

  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ code: pattern }, { name: pattern }];
  }

  return Subject.find(filter)
    .sort({ semester: 1, code: 1 })
    .populate("program", "name code")
    .populate("department", "name code");
}

async function getById(id) {
  const subject = await Subject.findById(id)
    .populate("program", "name code")
    .populate("department", "name code");
  if (!subject) {
    throw ApiError.notFound("Subject not found");
  }
  return subject;
}

/**
 * A subject's department must be the programme's department.
 *
 * A subject owned by Computer Science but attached to the MBA programme is not
 * a data-entry slip with no consequences: it decides which HOD may schedule it
 * and which students see it. Rejecting the mismatch keeps the ownership chain
 * honest.
 */
async function assertProgramBelongsToDepartment(programId, departmentId) {
  const program = await Program.findById(programId).select("department name");
  if (!program) {
    throw ApiError.notFound("Programme not found");
  }

  if (String(program.department) !== String(departmentId)) {
    throw ApiError.badRequest(
      "The programme belongs to a different department than the subject"
    );
  }

  return program;
}

async function assertDepartmentExists(departmentId) {
  const department = await Department.findById(departmentId).select("name");
  if (!department) {
    throw ApiError.notFound("Department not found");
  }
  return department;
}

async function create({ user, payload, req }) {
  assertCanManageDepartment(user, payload.department, MANAGE);
  await assertDepartmentExists(payload.department);
  await assertProgramBelongsToDepartment(payload.program, payload.department);

  const existing = await Subject.findOne({
    program: payload.program,
    code: payload.code,
  }).select("_id");
  if (existing) {
    throw ApiError.conflict(
      `That programme already has a subject with the code ${payload.code}`
    );
  }

  const subject = await Subject.create({
    ...payload,
    createdBy: user._id,
  });

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.SUBJECT_CREATED,
    entity: "Subject",
    entityId: subject._id,
    entityRef: subject.code,
    metadata: {
      code: subject.code,
      program: String(subject.program),
      department: String(subject.department),
      semester: subject.semester,
      kind: subject.kind,
    },
    req,
  });

  return subject.toJSON();
}

async function update({ user, id, payload, req }) {
  const subject = await Subject.findById(id);
  if (!subject) {
    throw ApiError.notFound("Subject not found");
  }

  const currentDepartment = subject.department;
  const nextDepartment = payload.department ?? currentDepartment;

  assertCanManageDepartment(user, currentDepartment, MANAGE);
  // A HOD moving a subject into another department would otherwise escape the
  // scope check by changing the record they are allowed to change.
  assertCanManageDepartment(user, nextDepartment, MANAGE);

  const nextProgram = payload.program ?? subject.program;
  if (payload.program || payload.department) {
    await assertProgramBelongsToDepartment(nextProgram, nextDepartment);
  }

  if (payload.code && (payload.code !== subject.code || payload.program)) {
    const duplicate = await Subject.findOne({
      _id: { $ne: subject._id },
      program: nextProgram,
      code: payload.code,
    }).select("_id");
    if (duplicate) {
      throw ApiError.conflict(
        `That programme already has a subject with the code ${payload.code}`
      );
    }
  }

  Object.assign(subject, payload);
  await subject.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.SUBJECT_UPDATED,
    entity: "Subject",
    entityId: subject._id,
    entityRef: subject.code,
    metadata: {
      code: subject.code,
      changed: Object.keys(payload),
      semester: subject.semester,
      isActive: subject.isActive,
    },
    req,
  });

  return subject.toJSON();
}

/**
 * Retire, never delete.
 *
 * A timetable entry and (later) an attendance record both point at this
 * subject. Deleting it would orphan the history that explains why a student was
 * marked present in a class that no longer exists.
 */
async function retire({ user, id, req }) {
  const subject = await Subject.findById(id);
  if (!subject) {
    throw ApiError.notFound("Subject not found");
  }

  assertCanManageDepartment(user, subject.department, MANAGE);

  if (!subject.isActive) {
    return subject.toJSON();
  }

  const scheduled = await TimetableEntry.countDocuments({
    subject: subject._id,
    isActive: true,
  });

  subject.isActive = false;
  await subject.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.SUBJECT_RETIRED,
    entity: "Subject",
    entityId: subject._id,
    entityRef: subject.code,
    // Scheduled entries are not deleted: the caller is told they still run, so
    // retiring a subject is never mistaken for cancelling its classes.
    metadata: { code: subject.code, activeEntries: scheduled },
    req,
  });

  return { ...subject.toJSON(), activeEntries: scheduled };
}

/** True when this user may create subjects at all. Used by the UI bootstrap. */
function canManage(user) {
  return (
    userHasPermission(user, P.SUBJECT_MANAGE) ||
    userHasPermission(user, P.SUBJECT_MANAGE_DEPARTMENT)
  );
}

module.exports = {
  list,
  getById,
  create,
  update,
  retire,
  canManage,
};
