/**
 * Administration: people, departments and programmes.
 *
 * ## Every change here is a change to what somebody is allowed to do
 *
 * These are the routes with the widest blast radius in the system: who can sign
 * in, what they can see, and which office owns which work. So the rules below
 * are mostly about refusing things that would look reasonable.
 *
 * ## The rules that matter
 *
 * - **Nobody can demote or disable themselves.** An administrator who locks
 *   themselves out — by accident or by someone using their session — leaves an
 *   institution that only an operator with database access can repair. The
 *   refusal names the reason.
 * - **Nobody can remove the last active super admin.** Same reasoning, applied
 *   to the whole institution rather than one account.
 * - **A last-super-admin check runs on deactivation, role change and password
 *   reset** — the three operations that can each leave an account unable to act.
 * - **Accounts are deactivated, never deleted.** Invoices, certificates and
 *   audit entries reference the person who handled them. Deleting the person
 *   would either break those records or cascade through history that is meant
 *   to be append-only.
 * - **Deactivating revokes every session immediately**, because "switched off"
 *   that leaves live refresh tokens is switched off in name only.
 */

const crypto = require("crypto");

const User = require("../models/User");
const Student = require("../models/Student");
const Department = require("../models/Department");
const Program = require("../models/Program");
const RequestType = require("../models/RequestType");

const { ApiError } = require("../utils/ApiError");
const { ROLES, AUDIT_ACTION } = require("../config/constants");
const { describePermissions } = require("../utils/permissions");
const auditService = require("./audit.service");

/** Roles that may hold no department. Others need one to scope their work. */
const DEPARTMENT_REQUIRED_ROLES = Object.freeze([ROLES.FACULTY, ROLES.HOD]);

/**
 * A temporary password that satisfies our own policy.
 *
 * Generated, never chosen by the administrator and never emailed: it is
 * returned once in the create/reset response for handover out of band, stored
 * only as a bcrypt hash, and the account is useless until its owner replaces it.
 */
function generateTemporaryPassword() {
  // Rejection-free by construction: one of each required class, then random
  // characters from the full set. No loop, so no chance of spinning.
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = lower + upper + digits;

  const pick = (set) => set[crypto.randomInt(set.length)];

  const chars = [pick(lower), pick(upper), pick(digits), pick(digits)];
  while (chars.length < 16) chars.push(pick(all));

  // Fisher-Yates with a CSPRNG, so the fixed characters are not always first.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}

// ===== Helpers =====

async function loadUserOr404(userId) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

/**
 * Refuse an action that would leave nobody able to administer.
 *
 * `excludeId` is the account being changed — when an admin changes their own
 * role they are still one active super admin right up until the write lands, so
 * counting them would answer the wrong question.
 */
async function assertNotLastSuperAdmin({ excludeId, action }) {
  const filter = {
    role: ROLES.SUPER_ADMIN,
    isActive: true,
  };
  if (excludeId) filter._id = { $ne: excludeId };

  const remaining = await User.countDocuments(filter);

  if (remaining === 0) {
    throw ApiError.badRequest(
      "This is the last active super administrator. Appoint another one first — " +
        "otherwise nobody could undo this action.",
      {
        details: [
          { field: "role", message: `Cannot ${action} the last super administrator` },
        ],
      }
    );
  }
}

/** A role that scopes work to a department needs one, or the scope is a blank. */
function assertDepartmentPresent({ role, department }) {
  if (DEPARTMENT_REQUIRED_ROLES.includes(role) && !department) {
    throw ApiError.badRequest(
      `${role.replace(/_/g, " ").toLowerCase()} must belong to a department. ` +
        "Their permissions are scoped to one, and an account with no department " +
        "would silently see nothing.",
      { details: [{ field: "department", message: "Required for this role" }] }
    );
  }
}

/** Turning an account off must also stop it working, right now. */
async function revokeAllSessions(userId, reason) {
  const { revokeAllSessions: revoke } = require("./auth.service");
  await revoke(userId, reason);
}

// ===== People =====

async function listUsers({ query, user: actor }) {
  const filter = {};

  if (query.role) filter.role = query.role;
  if (query.department) filter.department = query.department;
  if (query.isActive !== undefined) filter.isActive = query.isActive;

  if (query.search) {
    // Escaped, so a search for "a.b" cannot match every name, and anchored at
    // both ends is not needed — people type the start of a name.
    const safe = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { fullName: { $regex: safe, $options: "i" } },
      { email: { $regex: safe, $options: "i" } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .populate("department", "name code")
      .populate("student", "rollNumber")
      .sort({ fullName: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  await auditService.record({
    action: AUDIT_ACTION.READ,
    entity: "User",
    metadata: { scope: "list", filters: filter, resultCount: users.length },
    actor,
  });

  return {
    users: users.map((entry) => ({
      ...entry,
      id: entry._id,
      // Never the hash, whatever a lean query was asked for.
      passwordHash: undefined,
      _id: undefined,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

async function createUser({ payload, user: actor, req }) {
  const existing = await User.findOne({ email: payload.email });
  if (existing) {
    throw ApiError.conflict("An account already exists with that email address", {
      details: [{ field: "email", message: "Already in use" }],
    });
  }

  assertDepartmentPresent(payload);

  if (payload.department) {
    const department = await Department.findById(payload.department);
    if (!department) throw ApiError.badRequest("Department not found");
  }

  const account = new User({
    email: payload.email,
    fullName: payload.fullName,
    role: payload.role,
    department: payload.department || null,
    phone: payload.phone || undefined,
    isActive: true,
    mustChangePassword: true,
  });

  const temporaryPassword = generateTemporaryPassword();
  await account.setPassword(temporaryPassword);
  await account.save();

  await auditService.record({
    action: AUDIT_ACTION.CREATE,
    entity: "User",
    entityId: account._id,
    entityRef: account.email,
    // The reason this is safe to log in full: the temporary password is not.
    metadata: { role: account.role, department: account.department },
    actor,
    req,
  });

  // The one and only time this is ever visible. It is not stored anywhere.
  return {
    user: account.toJSON(),
    temporaryPassword,
    notice:
      "Shown once. Give it to the account holder directly and ask them to " +
      "replace it on first sign-in — the account cannot be used until they do.",
  };
}

async function updateUserDetails({ userId, changes, user: actor, req }) {
  const account = await loadUserOr404(userId);
  const before = {
    fullName: account.fullName,
    phone: account.phone,
    department: account.department,
  };

  if (changes.fullName !== undefined) account.fullName = changes.fullName;
  if (changes.phone !== undefined) account.phone = changes.phone || null;

  if (changes.department !== undefined) {
    if (changes.department) {
      const department = await Department.findById(changes.department);
      if (!department) throw ApiError.badRequest("Department not found");
    }
    account.department = changes.department || null;
  }

  assertDepartmentPresent({ role: account.role, department: account.department });

  await account.save();

  await auditService.record({
    action: AUDIT_ACTION.UPDATE,
    entity: "User",
    entityId: account._id,
    entityRef: account.email,
    metadata: { fields: Object.keys(changes), before, self: false },
    actor,
    req,
  });

  return account.toJSON();
}

/**
 * Change what somebody may do.
 *
 * Separate from `updateUserDetails` so it can be refused on its own merits and
 * audited on its own line: a form that can change a name and a role together
 * makes "fix the typo" indistinguishable from promotion.
 */
async function changeUserRole({ userId, changes, user: actor, req }) {
  const account = await loadUserOr404(userId);

  if (account._id.equals(actor._id)) {
    throw ApiError.forbidden(
      "You cannot change your own role. Ask another administrator — otherwise " +
        "a single mistake here cannot be undone by anyone."
    );
  }

  if (account.role === ROLES.SUPER_ADMIN) {
    throw ApiError.forbidden(
      "A super administrator's role cannot be changed from this screen. " +
        "Appointing super administrators is deliberately a reviewed decision, " +
        "not a self-service one."
    );
  }

  const from = account.role;

  if (changes.role) account.role = changes.role;
  if (changes.department !== undefined) {
    if (changes.department) {
      const department = await Department.findById(changes.department);
      if (!department) throw ApiError.badRequest("Department not found");
    }
    account.department = changes.department || null;
  }

  assertDepartmentPresent({ role: account.role, department: account.department });

  await account.save();

  // A role change invalidates every permission cached into a live session, so
  // the old sessions have to go.
  if (from !== account.role) {
    await revokeAllSessions(account._id, `Role changed from ${from} to ${account.role}`);
  }

  await auditService.record({
    action: AUDIT_ACTION.UPDATE,
    entity: "User",
    entityId: account._id,
    entityRef: account.email,
    metadata: {
      change: "role",
      from,
      to: account.role,
      reason: changes.reason,
    },
    actor,
    req,
  });

  return account.toJSON();
}

async function setUserActive({ userId, changes, user: actor, req }) {
  const account = await loadUserOr404(userId);

  if (account._id.equals(actor._id)) {
    throw ApiError.forbidden(
      changes.isActive
        ? "You are already active."
        : "You cannot deactivate your own account. Ask another administrator — " +
            "otherwise one mistake locks everyone out of user administration."
    );
  }

  if (!changes.isActive && account.role === ROLES.SUPER_ADMIN) {
    await assertNotLastSuperAdmin({ excludeId: account._id, action: "deactivate" });
  }

  const from = account.isActive;
  account.isActive = changes.isActive;
  await account.save();

  if (!changes.isActive) {
    // Without this, "deactivated" would leave live refresh tokens working until
    // they expired on their own.
    await revokeAllSessions(account._id, `Account deactivated: ${changes.reason}`);
  }

  await auditService.record({
    action: AUDIT_ACTION.UPDATE,
    entity: "User",
    entityId: account._id,
    entityRef: account.email,
    metadata: {
      change: "isActive",
      from,
      to: changes.isActive,
      reason: changes.reason,
    },
    actor,
    req,
  });

  return account.toJSON();
}

async function resetUserPassword({ userId, changes, user: actor, req }) {
  const account = await loadUserOr404(userId);

  if (account._id.equals(actor._id)) {
    throw ApiError.forbidden(
      "Use your own profile to change your password — this screen cannot reset " +
        "the password of the account you are signed in with."
    );
  }

  if (account.role === ROLES.SUPER_ADMIN && !account.isActive) {
    await assertNotLastSuperAdmin({ excludeId: account._id, action: "reset" });
  }

  const temporaryPassword = generateTemporaryPassword();
  await account.setPassword(temporaryPassword);
  account.mustChangePassword = true;
  await account.save();

  await revokeAllSessions(
    account._id,
    `Password reset by administrator: ${changes.reason}`
  );

  await auditService.record({
    action: AUDIT_ACTION.UPDATE,
    entity: "User",
    entityId: account._id,
    entityRef: account.email,
    metadata: { change: "passwordReset", reason: changes.reason },
    actor,
    req,
  });

  return {
    user: account.toJSON(),
    temporaryPassword,
    notice:
      "Shown once. Their current sessions have been signed out, and the account " +
      "cannot be used until they replace this password.",
  };
}

// ===== Departments =====

async function listDepartments({ query, user: actor }) {
  const filter = {};

  if (!query.includeInactive) filter.isActive = true;
  if (query.search) {
    const safe = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: safe, $options: "i" } },
      { code: { $regex: safe, $options: "i" } },
    ];
  }

  const departments = await Department.find(filter)
    .populate("hod", "fullName email role")
    .sort({ name: 1 })
    .lean();

  await auditService.record({
    action: AUDIT_ACTION.READ,
    entity: "Department",
    metadata: { scope: "list", resultCount: departments.length },
    actor,
  });

  return {
    departments: departments.map((entry) => ({
      ...entry,
      id: entry._id,
      _id: undefined,
    })),
  };
}

async function createDepartment({ payload, user: actor, req }) {
  const clash = await Department.findOne({
    $or: [{ name: payload.name }, { code: payload.code }],
  });

  if (clash) {
    const field = clash.name === payload.name ? "name" : "code";
    throw ApiError.conflict(
      field === "name"
        ? "A department with that name already exists"
        : "A department with that code already exists",
      { details: [{ field, message: "Already in use" }] }
    );
  }

  const department = await Department.create(payload);

  await auditService.record({
    action: AUDIT_ACTION.CREATE,
    entity: "Department",
    entityId: department._id,
    entityRef: department.code,
    metadata: { name: department.name, code: department.code },
    actor,
    req,
  });

  return department.toJSON();
}

async function updateDepartment({ departmentId, changes, user: actor, req }) {
  const department = await Department.findById(departmentId);
  if (!department) throw ApiError.notFound("Department not found");

  if (changes.name || changes.code) {
    const clash = await Department.findOne({
      _id: { $ne: department._id },
      $or: [
        changes.name ? { name: changes.name } : null,
        changes.code ? { code: changes.code } : null,
      ].filter(Boolean),
    });

    if (clash) {
      throw ApiError.conflict("Another department already uses that", {
        details: [
          {
            field: clash.name === changes.name ? "name" : "code",
            message: "Already in use",
          },
        ],
      });
    }
  }

  const before = { name: department.name, code: department.code };
  Object.assign(department, changes);
  await department.save();

  await auditService.record({
    action: AUDIT_ACTION.UPDATE,
    entity: "Department",
    entityId: department._id,
    entityRef: department.code,
    metadata: { fields: Object.keys(changes), before },
    actor,
    req,
  });

  return department.toJSON();
}

/**
 * Switching a department off.
 *
 * Refused while anything still depends on it. A department is a routing target
 * and a permission scope, so deactivating one that still has staff, students or
 * programmes would leave those records pointing at an office that no longer
 * appears in any dropdown — invisible breakage rather than an obvious one.
 */
async function setDepartmentActive({ departmentId, changes, user: actor, req }) {
  const department = await Department.findById(departmentId);
  if (!department) throw ApiError.notFound("Department not found");

  if (!changes.isActive) {
    const [staff, programmes, students] = await Promise.all([
      User.countDocuments({ department: department._id, isActive: true }),
      Program.countDocuments({ department: department._id, isActive: true }),
      Student.countDocuments({ department: department._id }),
    ]);

    const blockers = [];
    if (staff > 0) blockers.push(`${staff} staff`);
    if (programmes > 0) blockers.push(`${programmes} programmes`);
    if (students > 0) blockers.push(`${students} students`);

    if (blockers.length > 0) {
      throw ApiError.badRequest(
        `This department still has ${blockers.join(", ")}. Move or retire them ` +
          "first — otherwise they would point at an office that no longer appears " +
          "in any dropdown.",
        { details: blockers.map((label) => ({ field: "isActive", message: label })) }
      );
    }
  }

  const from = department.isActive;
  department.isActive = changes.isActive;
  await department.save();

  await auditService.record({
    action: AUDIT_ACTION.UPDATE,
    entity: "Department",
    entityId: department._id,
    entityRef: department.code,
    metadata: { change: "isActive", from, to: changes.isActive, reason: changes.reason },
    actor,
    req,
  });

  return department.toJSON();
}

// ===== Programmes =====

async function listPrograms({ query, user: actor }) {
  const filter = {};

  if (!query.includeInactive) filter.isActive = true;
  if (query.department) filter.department = query.department;
  if (query.level) filter.level = query.level;

  if (query.search) {
    const safe = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: safe, $options: "i" } },
      { code: { $regex: safe, $options: "i" } },
    ];
  }

  const programmes = await Program.find(filter)
    .populate("department", "name code")
    .sort({ name: 1 })
    .lean();

  await auditService.record({
    action: AUDIT_ACTION.READ,
    entity: "Program",
    metadata: { scope: "list", resultCount: programmes.length },
    actor,
  });

  return {
    programs: programmes.map((entry) => ({ ...entry, id: entry._id, _id: undefined })),
  };
}

async function createProgram({ payload, user: actor, req }) {
  const department = await Department.findById(payload.department);
  if (!department) throw ApiError.badRequest("Department not found");

  const clash = await Program.findOne({
    $or: [{ name: payload.name }, { code: payload.code }],
  });

  if (clash) {
    const field = clash.name === payload.name ? "name" : "code";
    throw ApiError.conflict(
      field === "name"
        ? "A programme with that name already exists"
        : "A programme with that code already exists",
      { details: [{ field, message: "Already in use" }] }
    );
  }

  const programme = await Program.create(payload);

  await auditService.record({
    action: AUDIT_ACTION.CREATE,
    entity: "Program",
    entityId: programme._id,
    entityRef: programme.code,
    metadata: {
      name: programme.name,
      code: programme.code,
      department: department._id,
    },
    actor,
    req,
  });

  return programme.toJSON();
}

async function updateProgram({ programId, changes, user: actor, req }) {
  const programme = await Program.findById(programId);
  if (!programme) throw ApiError.notFound("Programme not found");

  if (changes.department) {
    const department = await Department.findById(changes.department);
    if (!department) throw ApiError.badRequest("Department not found");
  }

  if (changes.name || changes.code) {
    const clash = await Program.findOne({
      _id: { $ne: programme._id },
      $or: [
        changes.name ? { name: changes.name } : null,
        changes.code ? { code: changes.code } : null,
      ].filter(Boolean),
    });

    if (clash) {
      throw ApiError.conflict("Another programme already uses that", {
        details: [
          {
            field: clash.name === changes.name ? "name" : "code",
            message: "Already in use",
          },
        ],
      });
    }
  }

  const before = { name: programme.name, code: programme.code };
  Object.assign(programme, changes);
  await programme.save();

  await auditService.record({
    action: AUDIT_ACTION.UPDATE,
    entity: "Program",
    entityId: programme._id,
    entityRef: programme.code,
    metadata: { fields: Object.keys(changes), before },
    actor,
    req,
  });

  return programme.toJSON();
}

async function setProgramActive({ programId, changes, user: actor, req }) {
  const programme = await Program.findById(programId);
  if (!programme) throw ApiError.notFound("Programme not found");

  if (!changes.isActive) {
    const enrolled = await Student.countDocuments({ program: programme._id });
    if (enrolled > 0) {
      throw ApiError.badRequest(
        `This programme still has ${enrolled} student${enrolled === 1 ? "" : "s"} ` +
          "on it. A retired programme with students still enrolled would drop " +
          "their programme out of every dropdown.",
        { details: [{ field: "isActive", message: `${enrolled} enrolled` }] }
      );
    }
  }

  const from = programme.isActive;
  programme.isActive = changes.isActive;
  await programme.save();

  await auditService.record({
    action: AUDIT_ACTION.UPDATE,
    entity: "Program",
    entityId: programme._id,
    entityRef: programme.code,
    metadata: { change: "isActive", from, to: changes.isActive, reason: changes.reason },
    actor,
    req,
  });

  return programme.toJSON();
}

// ===== Request types =====

/**
 * The catalogue of services a student can ask for.
 *
 * A request type is not cosmetic: it defines the fields the submission form
 * asks for, and the documents it will demand. Editing one changes what tens of
 * thousands of students will be asked for next time, so a retired type is
 * hidden from the catalogue rather than deleted, and the reason is recorded.
 */
async function listRequestTypes({ query, user: actor }) {
  const filter = {};
  if (!query.includeInactive) filter.isActive = true;
  if (query.department) filter.department = query.department;

  if (query.search) {
    const safe = query.search.replace(/[.*+?^${}()|()[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: safe, $options: "i" } },
      { code: { $regex: safe, $options: "i" } },
    ];
  }

  const requestTypes = await RequestType.find(filter)
    .populate("department", "name code")
    .sort({ name: 1 })
    .lean();

  await auditService.record({
    action: AUDIT_ACTION.READ,
    entity: "RequestType",
    metadata: { scope: "admin-list", resultCount: requestTypes.length },
    actor,
  });

  return {
    requestTypes: requestTypes.map((entry) => ({
      ...entry,
      id: entry._id,
      _id: undefined,
    })),
  };
}

async function createRequestType({ payload, user: actor, req }) {
  // A SELECT with no options renders as an empty dropdown in the submission
  // form, which reads as a broken form rather than as an unfinished definition.
  for (const field of payload.fields ?? []) {
    if (field.type === "SELECT" && !field.options?.length) {
      throw ApiError.badRequest(
        `Field "${field.name}" is a dropdown but declares no options`,
        { details: [{ field: "fields", message: `"${field.name}" has no options` }] }
      );
    }
  }

  const clash = await RequestType.findOne({
    $or: [{ name: payload.name }, { code: payload.code }],
  });

  if (clash) {
    const field = clash.name === payload.name ? "name" : "code";
    throw ApiError.conflict(
      field === "name"
        ? "A request type with that name already exists"
        : "A request type with that code already exists",
      { details: [{ field, message: "Already in use" }] }
    );
  }

  const requestType = await RequestType.create(payload);

  await auditService.record({
    action: AUDIT_ACTION.CREATE,
    entity: "RequestType",
    entityId: requestType._id,
    entityRef: requestType.code,
    metadata: {
      name: requestType.name,
      code: requestType.code,
      fieldCount: (payload.fields ?? []).length,
    },
    actor,
    req,
  });

  return requestType.toJSON();
}

async function updateRequestType({ requestTypeId, changes, user: actor, req }) {
  const requestType = await RequestType.findById(requestTypeId);
  if (!requestType) throw ApiError.notFound("Request type not found");

  const nextFields = changes.fields ?? requestType.fields ?? [];
  for (const field of nextFields) {
    if (field.type === "SELECT" && !field.options?.length) {
      throw ApiError.badRequest(
        `Field "${field.name}" is a dropdown but declares no options`,
        { details: [{ field: "fields", message: `"${field.name}" has no options` }] }
      );
    }
  }

  if (changes.name || changes.code) {
    const clash = await RequestType.findOne({
      _id: { $ne: requestType._id },
      $or: [
        changes.name ? { name: changes.name } : null,
        changes.code ? { code: changes.code } : null,
      ].filter(Boolean),
    });

    if (clash) {
      throw ApiError.conflict("Another request type already uses that", {
        details: [
          {
            field: clash.name === changes.name ? "name" : "code",
            message: "Already in use",
          },
        ],
      });
    }
  }

  const before = { name: requestType.name, code: requestType.code };
  Object.assign(requestType, changes);
  await requestType.save();

  await auditService.record({
    action: AUDIT_ACTION.UPDATE,
    entity: "RequestType",
    entityId: requestType._id,
    entityRef: requestType.code,
    metadata: { fields: Object.keys(changes), before },
    actor,
    req,
  });

  return requestType.toJSON();
}

/**
 * Retiring hides the type from the catalogue. It does not remove it, because
 * requests already filed against it must keep resolving to the definition they
 * were filed under — otherwise an old request's form would change meaning.
 */
async function setRequestTypeActive({ requestTypeId, changes, user: actor, req }) {
  const requestType = await RequestType.findById(requestTypeId);
  if (!requestType) throw ApiError.notFound("Request type not found");

  if (!changes.isActive) {
    const Request = require("../models/Request");
    const open = await Request.countDocuments({
      requestType: requestType._id,
      status: { $nin: ["RESOLVED", "REJECTED", "WITHDRAWN"] },
    });

    if (open > 0) {
      throw ApiError.badRequest(
        `This service still has ${open} open request${open === 1 ? "" : "s"} ` +
          "against it. Close them first — otherwise a student's in-flight " +
          "request would point at a definition they can no longer see.",
        { details: [{ field: "isActive", message: `${open} open` }] }
      );
    }
  }

  const from = requestType.isActive;
  requestType.isActive = changes.isActive;
  await requestType.save();

  await auditService.record({
    action: AUDIT_ACTION.UPDATE,
    entity: "RequestType",
    entityId: requestType._id,
    entityRef: requestType.code,
    metadata: {
      change: "isActive",
      from,
      to: changes.isActive,
      reason: changes.reason,
    },
    actor,
    req,
  });

  return requestType.toJSON();
}

/**
 * What this account would gain, in one call.
 *
 * The create-user form shows this as the person types a role. An administrator
 * choosing between "faculty" and "HoD" is choosing what that person will be able
 * to see, and having to open a second page to find out is how the wrong one gets
 * picked.
 */
async function describeRolePermissions({ role, user: actor }) {
  const described = describePermissions(role);

  await auditService.record({
    action: AUDIT_ACTION.READ,
    entity: "Permission",
    metadata: { scope: "describe", role },
    actor,
  });

  return { role, ...described };
}

module.exports = {
  generateTemporaryPassword,
  listRequestTypes,
  createRequestType,
  updateRequestType,
  setRequestTypeActive,
  listUsers,
  createUser,
  updateUserDetails,
  changeUserRole,
  setUserActive,
  resetUserPassword,
  listDepartments,
  createDepartment,
  updateDepartment,
  setDepartmentActive,
  listPrograms,
  createProgram,
  updateProgram,
  setProgramActive,
  describeRolePermissions,
  assertNotLastSuperAdmin,
  DEPARTMENT_REQUIRED_ROLES,
};
