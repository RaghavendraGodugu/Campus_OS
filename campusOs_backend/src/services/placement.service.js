/**
 * Placements: companies, drives and applications.
 *
 * ## Students only see open drives
 *
 * A drive is `DRAFT` until the placement office opens it, and `CLOSED` once the
 * deadline passes. The list query filters by status for students, so a draft is
 * invisible rather than merely unlinked.
 *
 * ## Eligibility is checked, not merely displayed
 *
 * A student may apply only when the drive is open, the deadline has not passed,
 * and their programme and semester are in the drive's eligible lists (an empty
 * list means "everyone"). The client is not trusted to respect any of this.
 */
const Company = require("../models/Company");
const PlacementDrive = require("../models/PlacementDrive");
const PlacementApplication = require("../models/PlacementApplication");
const Student = require("../models/Student");
const {
  AUDIT_ACTION,
  PLACEMENT_DRIVE_STATUS,
  PLACEMENT_APPLICATION_STATUS,
} = require("../config/constants");
const { ApiError } = require("../utils/ApiError");
const { P, userHasPermission } = require("../utils/permissions");
const auditService = require("./audit.service");

function assertManage(user) {
  if (!userHasPermission(user, P.PLACEMENT_MANAGE)) {
    throw ApiError.forbidden("You do not have permission to manage placements");
  }
}

async function studentFor(user) {
  const student = await Student.findOne({ user: user._id }).select(
    "rollNumber program semester"
  );
  return student; // null if no student record linked
}

const DRIVE_TRANSITIONS = {
  DRAFT: [PLACEMENT_DRIVE_STATUS.OPEN, PLACEMENT_DRIVE_STATUS.CLOSED],
  OPEN: [PLACEMENT_DRIVE_STATUS.CLOSED],
  CLOSED: [],
};

async function listDrives({ user }) {
  const canSeeAll = userHasPermission(user, P.PLACEMENT_READ_INSTITUTION);
  const filter = canSeeAll ? {} : { status: PLACEMENT_DRIVE_STATUS.OPEN };

  const drives = await PlacementDrive.find(filter)
    .populate("company", "name sector")
    .populate("eligiblePrograms", "name code")
    .sort({ driveDate: 1 })
    .lean();

  const applications = await PlacementApplication.aggregate([
    { $group: { _id: "$drive", count: { $sum: 1 } } },
  ]);
  const counts = new Map(applications.map((row) => [String(row._id), row.count]));

  return drives.map((drive) => ({
    ...drive,
    id: String(drive._id),
    applications: counts.get(String(drive._id)) ?? 0,
    applicantsVisible: canSeeAll,
  }));
}

async function listCompanies() {
  return Company.find({ isActive: true }).sort({ name: 1 }).lean();
}

async function createCompany({ user, payload, req }) {
  assertManage(user);
  const existing = await Company.findOne({ name: payload.name });
  if (existing) throw ApiError.conflict("A company with that name already exists");

  const company = await Company.create(payload);
  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.CREATE,
    entity: "Company",
    entityId: company._id,
    entityRef: company.name,
    req,
  });
  return company.toJSON();
}

async function createDrive({ user, payload, req }) {
  assertManage(user);
  const company = await Company.findById(payload.company);
  if (!company) throw ApiError.notFound("Company not found");

  if (payload.driveDate < payload.applicationDeadline) {
    throw ApiError.badRequest("The drive cannot happen before the application deadline");
  }

  const drive = await PlacementDrive.create({ ...payload, createdBy: user._id });
  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.PLACEMENT_DRIVE_CREATED,
    entity: "PlacementDrive",
    entityId: drive._id,
    entityRef: `${company.name} · ${drive.title}`,
    metadata: { status: drive.status },
    req,
  });
  return drive.toJSON();
}

async function setDriveStatus({ user, id, payload, req }) {
  assertManage(user);
  const drive = await PlacementDrive.findById(id);
  if (!drive) throw ApiError.notFound("Drive not found");

  const allowed = DRIVE_TRANSITIONS[drive.status] ?? [];
  if (!allowed.includes(payload.status)) {
    throw ApiError.invalidTransition(
      `A ${drive.status.toLowerCase()} drive cannot become ${payload.status.toLowerCase()}`
    );
  }

  drive.status = payload.status;
  await drive.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.PLACEMENT_DRIVE_STATUS,
    entity: "PlacementDrive",
    entityId: drive._id,
    metadata: { status: drive.status },
    req,
  });
  return drive.toJSON();
}

async function apply({ user, driveId, req }) {
  const student = await studentFor(user);
  const drive = await PlacementDrive.findById(driveId);
  if (!drive) throw ApiError.notFound("Drive not found");

  if (drive.status !== PLACEMENT_DRIVE_STATUS.OPEN) {
    throw ApiError.badRequest("That drive is not open for applications");
  }
  if (drive.applicationDeadline < new Date()) {
    throw ApiError.badRequest("The application deadline has passed");
  }

  if (
    drive.eligiblePrograms.length > 0 &&
    !drive.eligiblePrograms.some((program) => String(program) === String(student.program))
  ) {
    throw ApiError.forbidden("Your programme is not eligible for this drive");
  }

  if (
    drive.eligibleSemesters.length > 0 &&
    !drive.eligibleSemesters.includes(student.semester)
  ) {
    throw ApiError.forbidden("Your semester is not eligible for this drive");
  }

  const existing = await PlacementApplication.findOne({
    drive: drive._id,
    student: student._id,
  });
  if (existing) throw ApiError.conflict("You have already applied to this drive");

  const application = await PlacementApplication.create({
    drive: drive._id,
    student: student._id,
  });

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.PLACEMENT_APPLIED,
    entity: "PlacementApplication",
    entityId: application._id,
    entityRef: String(drive._id),
    metadata: { drive: String(drive._id) },
    req,
  });
  return application.toJSON();
}

async function withdraw({ user, driveId, req }) {
  const student = await studentFor(user);
  const application = await PlacementApplication.findOne({
    drive: driveId,
    student: student._id,
  });
  if (!application) throw ApiError.notFound("Application not found");

  if (
    ![
      PLACEMENT_APPLICATION_STATUS.APPLIED,
      PLACEMENT_APPLICATION_STATUS.SHORTLISTED,
    ].includes(application.status)
  ) {
    throw ApiError.badRequest("That application can no longer be withdrawn");
  }

  application.status = PLACEMENT_APPLICATION_STATUS.WITHDRAWN;
  application.updatedBy = user._id;
  application.updatedAt = new Date();
  await application.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.PLACEMENT_APPLICATION_STATUS,
    entity: "PlacementApplication",
    entityId: application._id,
    metadata: { status: application.status },
    req,
  });
  return application.toJSON();
}

async function mine({ user }) {
  const student = await studentFor(user);
  return PlacementApplication.find({
    student: student._id,
    status: { $ne: PLACEMENT_APPLICATION_STATUS.WITHDRAWN },
  })
    .populate({ path: "drive", populate: { path: "company", select: "name sector" } })
    .sort({ appliedAt: -1 })
    .lean();
}

async function listApplications({ driveId }) {
  return PlacementApplication.find({ drive: driveId })
    .populate({
      path: "student",
      select: "rollNumber semester",
      populate: { path: "user", select: "fullName" },
    })
    .sort({ appliedAt: 1 })
    .lean();
}

async function decideApplication({ user, id, payload, req }) {
  assertManage(user);
  const application = await PlacementApplication.findById(id);
  if (!application) throw ApiError.notFound("Application not found");
  if (application.status === PLACEMENT_APPLICATION_STATUS.WITHDRAWN) {
    throw ApiError.badRequest("The student withdrew this application");
  }

  application.status = payload.status;
  application.updatedBy = user._id;
  application.updatedAt = new Date();
  await application.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.PLACEMENT_APPLICATION_STATUS,
    entity: "PlacementApplication",
    entityId: application._id,
    metadata: { status: application.status },
    req,
  });
  return application.toJSON();
}

module.exports = {
  listCompanies,
  listDrives,
  createCompany,
  createDrive,
  setDriveStatus,
  apply,
  withdraw,
  mine,
  listApplications,
  decideApplication,
};
