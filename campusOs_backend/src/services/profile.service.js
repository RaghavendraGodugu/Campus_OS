/**
 * Profile — a person's own record.
 *
 * ## What a person may change about themselves is deliberately short
 *
 * A display name and a phone number. Everything else on a user or a student
 * record — role, department, programme, roll number, semester, batch — is
 * institutional data. Letting a user edit it would let a student change their own
 * programme or their own roll number, which is not a profile field, it is their
 * academic identity.
 *
 * So the endpoint takes two fields and rejects everything else, and the ones it
 * refuses are named in the error. A person who mistypes their name and is told
 * nothing useful has learned nothing from the failure.
 *
 * ## Changing an email address is not here on purpose
 *
 * An email is the login identifier and the recovery route. Letting it be self-
 * edited turns account takeover into a form submission. It changes through an
 * administrator, who verifies it out of band.
 */
const User = require("../models/User");
const preferenceService = require("./notificationPreference.service");
const { CATEGORIES } = preferenceService;
const Student = require("../models/Student");
const Department = require("../models/Department");
const Program = require("../models/Program");
const AuditLog = require("../models/AuditLog");

const { ApiError } = require("../utils/ApiError");
const { AUDIT_ACTION, ROLES } = require("../config/constants");
const { describePermissions } = require("../utils/permissions");
const auditService = require("./audit.service");

/**
 * The profile as this user should see it.
 *
 * Read-only fields are included even though they cannot be edited: a profile
 * that hides the roll number makes people ask, and asking lands in a support
 * queue.
 */
async function getProfile({ user }) {
  const fresh = await User.findById(user._id).select("-passwordHash").lean();

  if (!fresh) {
    throw ApiError.notFound("Profile not found");
  }

  const student = fresh.student
    ? await Student.findById(fresh.student)
        .populate("department", "name code")
        .populate("program", "name code level")
        .lean()
    : null;

  const [department, program] = await Promise.all([
    fresh.department
      ? Department.findById(fresh.department).select("name code").lean()
      : null,
    student?.program?._id
      ? Program.findById(student.program._id).select("name code level").lean()
      : null,
  ]);

  // A short history of this person's own activity, so the page is useful rather
  // than a name and an email.
  const [loginCount, lastLogin] = await Promise.all([
    AuditLog.countDocuments({ actor: fresh._id, action: AUDIT_ACTION.LOGIN }),
    AuditLog.findOne({ actor: fresh._id, action: AUDIT_ACTION.LOGIN })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean(),
  ]);

  const permissions = describePermissions(fresh.role);

  return {
    user: {
      id: fresh._id,
      fullName: fresh.fullName,
      email: fresh.email,
      phone: fresh.phone ?? null,
      role: fresh.role,
      isActive: fresh.isActive,
      createdAt: fresh.createdAt,
      lastLoginAt: fresh.lastLoginAt ?? null,
      designation: fresh.designation || undefined,
      expertise: Array.isArray(fresh.expertise) && fresh.expertise.length > 0 ? fresh.expertise : undefined,
    },

    /** Academic record. Read-only, and absent for staff. */
    student: student
      ? {
          id: student._id,
          rollNumber: student.rollNumber,
          semester: student.semester,
          year: student.year,
          section: student.section ?? null,
          batchYear: student.batchYear,
          feeStatus: student.feeStatus,
          program: program
            ? { id: program._id, name: program.name, code: program.code }
            : null,
          department: department
            ? { id: department._id, name: department.name, code: department.code }
            : null,
        }
      : null,

    /** Department for staff. */
    department: department
      ? { id: department._id, name: department.name, code: department.code }
      : null,

    account: {
      loginCount,
      lastLoginAt: lastLogin?.createdAt ?? null,
    },

    permissions: permissions.permissions,
    scopes: permissions.scopes,

    /**
     * What this person may change about themselves.
     *
     * Sent rather than assumed, so the interface can say what is editable
     * instead of guessing and offering a save that the server refuses.
     */
    editableFields: editableFields(fresh),
  };
}

/**
 * Update a profile.
 *
 * @param {object} params
 * @param {object} params.user
 * @param {object} params.changes At most fullName and phone.
 * @param {object} [params.req]
 */
/**
 * Replace a person's notification preferences.
 *
 * Every category is written, not merged. A partial patch leaves it ambiguous
 * whether an absent key means "leave it alone" or "switch it off", and the
 * second reading is the one that would quietly mute somebody.
 *
 * Nothing is delivered or discarded here — preferences only affect what raises
 * a badge from this moment on. See notificationPreference.service for why
 * muting never stops delivery.
 */
async function updateNotificationPreferences({ user, changes }) {
  const update = {};
  for (const key of CATEGORIES) {
    update[`notificationPreferences.${key}`] = Boolean(changes[key]);
  }
  update["notificationPreferences.unreadBadge"] = Boolean(changes.unreadBadge);

  const updated = await User.findByIdAndUpdate(user._id, { $set: update }, { new: true });

  return preferenceService.present(updated);
}

/**
 * What this person may change on themselves.
 *
 * A staff member describes themselves publicly — title and declared expertise —
 * because that is how the directory finds them. A student holds no such
 * identity, so a student's editable set stays the original two fields, and a
 * student sending `description`-like fields is refused by name rather than
 * silently dropped.
 */
const SELF_FIELDS_INS = ["fullName", "phone"];
const SELF_FIELDS_STAFF = ["fullName", "phone", "designation", "expertise"];

function editableFields(user) {
  return user?.role === ROLES.STUDENT ? SELF_FIELDS_INS : SELF_FIELDS_STAFF;
}

async function updateProfile({ user, changes, req }) {
  const allowed = editableFields(user);
  const refused = Object.keys(changes).filter((key) => !allowed.includes(key));

  if (refused.length > 0) {
    throw ApiError.badRequest(
      `You cannot change ${refused.join(", ")} yourself. ` +
        `Only ${allowed.join(" and ")} are yours to edit; everything else is institutional data that an administrator maintains.`,
      { details: refused.map((field) => ({ field, message: "Not self-editable" })) }
    );
  }

  const update = {};
  if (changes.fullName !== undefined) update.fullName = changes.fullName;
  if (changes.phone !== undefined) update.phone = changes.phone || null;
  if (changes.designation !== undefined && allowed.includes("designation")) {
    update.designation = changes.designation || "";
  }
  if (changes.expertise !== undefined && allowed.includes("expertise")) {
    update.expertise = Array.isArray(changes.expertise) ? changes.expertise : [];
  }

  if (Object.keys(update).length === 0) {
    throw ApiError.badRequest("Nothing to update.");
  }

  const updated = await User.findByIdAndUpdate(
    user._id,
    { $set: update },
    { new: true, runValidators: true }
  ).select("-passwordHash");

  if (!updated) {
    throw ApiError.notFound("Profile not found");
  }

  await auditService.record({
    action: AUDIT_ACTION.UPDATE,
    entity: "User",
    entityId: updated._id,
    entityRef: updated.email,
    // Only the field names, never the values: a phone number is personal data
    // and the audit trail is read by people who do not need it.
    metadata: { fields: Object.keys(update), self: true },
    actor: user,
    req,
  });

  return getProfile({ user: updated });
}

/**
 * Revoke every other session for this person.
 *
 * Useful when a phone is lost: the stolen device loses its refresh token, and
 * its access token expires on its own shortly afterwards.
 */
async function signOutEverywhere({ user, req }) {
  const { revokeAllSessions } = require("./auth.service");
  await revokeAllSessions(user._id, "Signed out everywhere from the profile page", req);

  return { message: "Signed out on every other device." };
}
module.exports = {
  editableFields,
  getProfile,
  updateProfile,
  updateNotificationPreferences,
  signOutEverywhere,
};
