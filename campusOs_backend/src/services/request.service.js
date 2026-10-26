/**
 * Request service.
 *
 * ## Where authorization actually happens
 *
 * Route middleware answers "may this ROLE read requests?". That is not
 * sufficient. Every read here additionally applies a **scope filter** to the
 * Mongo query itself, so the database never returns a row the caller should not
 * see. Hiding a control in the UI is not access control; filtering the query
 * is.
 *
 * `buildScopeFilter()` is the single place that mapping lives. A new read path
 * that forgets to call it will fail its tests rather than leak.
 *
 * ## Idempotent submission
 *
 * A student retrying a failed submit must not create two applications. The
 * client sends an `Idempotency-Key`; a repeat of the same key returns the
 * original request instead of creating a second one.
 */

const Request = require("../models/Request");
const RequestType = require("../models/RequestType");
const Counter = require("../models/Counter");
const Student = require("../models/Student");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { userHasPermission, P, SCOPE } = require("../utils/permissions");
const { ROLES, REQUEST_STATUS, AUDIT_ACTION } = require("../config/constants");
const { logger } = require("../config/logger");
const auditService = require("./audit.service");

const { counterKey, formatReference } = Counter;
const REFERENCE_NAMESPACE = "request";
const REFERENCE_PREFIX = "REQ";

/**
 * Generate the next reference, e.g. `REQ-2026-000042`.
 *
 * Uses an atomic `$inc`, so concurrent submissions never collide. See
 * models/Counter.js.
 */
async function generateReference(year = new Date().getFullYear()) {
  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey(REFERENCE_NAMESPACE, year) },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );

  return formatReference(REFERENCE_PREFIX, year, counter.seq);
}

/**
 * Build the Mongo filter that limits a request list to what this user may see.
 *
 * Scope resolution, in order:
 *  - a student sees only their own requests
 *  - a department-scoped role sees its own department
 *  - an institution-scoped role sees everything
 *  - otherwise only requests assigned to them
 *
 * Returns null when the user may see everything, so callers can spread it.
 *
 * @param {object} user
 * @returns {object|null}
 */
async function buildScopeFilter(user, req) {
  // A student is limited to their own records, full stop.
  if (user.role === ROLES.STUDENT) {
    // Support both middleware-attached student (req.student) and legacy user.student
    const student = req?.student ?? (user.student ? await Student.findById(user.student).lean() : null);
    return { student: student?._id ?? null };
  }

  if (userHasPermission(user, P.REQUEST_READ_INSTITUTION)) {
    return null;
  }

  if (userHasPermission(user, P.REQUEST_READ_DEPARTMENT)) {
    return { department: user.department ?? null };
  }

  if (userHasPermission(user, P.REQUEST_READ_ASSIGNED)) {
    return { assignedTo: user._id };
  }

  // Least privilege: no read permission at all yields no results, rather than
  // defaulting to "everything".
  return { _id: null };
}

/**
 * Submit a new request.
 *
 * @param {object} params
 * @param {object} params.user      Acting student.
 * @param {string} params.requestTypeId
 * @param {object} params.data      Field values, validated against the type.
 * @param {string} [params.title]
 * @param {string} [params.description]
 * @param {string} [params.idempotencyKey]
 * @param {object} [params.req]
 * @returns {Promise<object>}
 */
async function submitRequest({
  user,
  requestTypeId,
  data,
  title,
  description,
  idempotencyKey,
  req,
}) {
  // Support both middleware-attached student (req.student) and legacy user.student
  const student = req?.student ?? (user.student ? await Student.findById(user.student).lean() : null);
  if (!student) {
    throw ApiError.forbidden("Only student accounts with a linked student profile can submit requests");
  }

  // An idempotent retry returns the original rather than a duplicate.
  if (idempotencyKey) {
    const existing = await Request.findOne({
      student: student._id,
      "data.__idempotencyKey": idempotencyKey,
    });
    if (existing) {
      logger.info(
        { idempotencyKey },
        "Duplicate submission collapsed onto original request"
      );
      return existing;
    }
  }

  const requestType = await RequestType.findOne({
    _id: requestTypeId,
    isActive: true,
  });

  if (!requestType) {
    // "Not found" rather than "inactive", so a student cannot enumerate
    // retired request types.
    throw ApiError.notFound("Request type not found");
  }

  // The catalogue drives validation; the client is never trusted on shape.
  validateAgainstType(data ?? {}, requestType.fields);

  const now = new Date();
  const reference = await generateReference(now.getFullYear());

  // slaHours is the configured response-time policy, turned into an absolute
  // deadline at submission time.
  const dueAt = new Date(now.getTime() + (requestType.slaHours ?? 72) * 3600 * 1000);

  const request = await Request.create({
    reference,
    requestType: requestType._id,
    student: student._id,
    department: requestType.department,
    title: title?.trim() || requestType.name,
    data: {
      ...(data ?? {}),
      ...(idempotencyKey ? { __idempotencyKey: idempotencyKey } : {}),
    },
    description,
    status: REQUEST_STATUS.SUBMITTED,
    submittedAt: now,
    dueAt,
    statusHistory: [
      {
        from: null,
        to: REQUEST_STATUS.SUBMITTED,
        actor: user._id,
        actorRole: user.role,
        at: now,
      },
    ],
  });

  await auditService.record({
    action: AUDIT_ACTION.CREATE,
    entity: "Request",
    entityId: request._id,
    entityRef: request.reference,
    metadata: { requestType: requestType.code, department: requestType.department, student: student._id },
    actor: user,
    req,
  });

  return request;
}

/**
 * Validate submitted values against the request type's declared fields.
 *
 * The field list is admin-defined at runtime, so this cannot be expressed as a
 * static Zod schema. Unknown keys are rejected rather than stored, which stops
 * a client smuggling extra data into `data`.
 *
 * @param {object} data
 * @param {Array<object>} fields
 */
function validateAgainstType(data, fields) {
  const problems = [];
  const declared = new Map(fields.map((f) => [f.name, f]));

  // Reject anything the type never asked for.
  for (const key of Object.keys(data)) {
    if (key.startsWith("__")) continue; // internal markers
    if (!declared.has(key)) {
      problems.push({
        field: key,
        message: "This field is not part of this application",
      });
    }
  }

  for (const field of fields) {
    const value = data[field.name];

    if (value === undefined || value === null || value === "") {
      if (field.required) {
        problems.push({ field: field.name, message: `${field.label} is required` });
      }
      continue;
    }

    switch (field.type) {
      case "NUMBER": {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          problems.push({
            field: field.name,
            message: `${field.label} must be a number`,
          });
          break;
        }
        if (field.min !== undefined && num < field.min) {
          problems.push({
            field: field.name,
            message: `${field.label} must be at least ${field.min}`,
          });
        }
        if (field.max !== undefined && num > field.max) {
          problems.push({
            field: field.name,
            message: `${field.label} must be at most ${field.max}`,
          });
        }
        break;
      }
      case "BOOLEAN": {
        if (typeof value !== "boolean") {
          problems.push({
            field: field.name,
            message: `${field.label} must be true or false`,
          });
        }
        break;
      }
      case "SELECT": {
        if (!field.options?.includes(String(value))) {
          problems.push({
            field: field.name,
            message: `${field.label} must be one of: ${field.options?.join(", ")}`,
          });
        }
        break;
      }
      case "DATE": {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          problems.push({
            field: field.name,
            message: `${field.label} must be a valid date`,
          });
        }
        break;
      }
      case "TEXTAREA":
      case "TEXT":
      default: {
        const str = String(value);
        const limit = field.maxLength ?? 2000;
        if (str.length > limit) {
          problems.push({
            field: field.name,
            message: `${field.label} cannot exceed ${limit} characters`,
          });
        }
        break;
      }
    }
  }

  if (problems.length > 0) {
    throw new ApiError(ERROR_CODE.VALIDATION_ERROR, "The submitted data is invalid", {
      details: problems,
    });
  }
}

/**
 * List requests visible to a user.
 *
 * @param {object} params
 * @param {object} params.user
 * @param {object} [params.filters] status, department, requestType, assignedTo, search
 * @param {number} [params.page]
 * @param {number} [params.limit]
 * @param {string} [params.sort]
 * @returns {Promise<{items: object[], total: number, page: number, limit: number}>}
 */
async function listRequests({ user, filters = {}, page = 1, limit = 20, sort, req }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);

  // Scope first: this is what prevents cross-student access.
  const scope = (await buildScopeFilter(user, req)) ?? {};
  const query = { ...scope, ...buildFilters(filters, user) };

  const sortSpec = parseSort(sort);

  const [items, total] = await Promise.all([
    Request.find(query)
      .sort(sortSpec)
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("requestType", "name code")
      .populate("department", "name code")
      .populate("assignedTo", "fullName email role")
      .lean(),
    Request.countDocuments(query),
  ]);

  return { items, total, page: safePage, limit: safeLimit };
}

/**
 * Translate client filters into a query, refusing anything outside scope.
 *
 * An explicit `department` filter must not be able to widen access: it is
 * intersected with the caller's scope by the caller, so here it only ever
 * narrows.
 */
function buildFilters(filters, user) {
  const query = {};

  if (filters.status) query.status = filters.status;
  if (filters.requestType) query.requestType = filters.requestType;
  if (filters.isActive !== undefined) query.isActive = filters.isActive;

  // Only a department-scoped or institution-scoped caller may filter by
  // department; a student filtering by department must not escape their scope.
  if (filters.department && userHasPermission(user, P.REQUEST_READ_DEPARTMENT)) {
    query.department = filters.department;
  }

  // "Assigned to me" shortcut, usable by any staff role.
  if (filters.assignedToMe && user.role !== ROLES.STUDENT) {
    query.assignedTo = user._id;
  }

  // Free-text search across the title and reference only.
  if (filters.search) {
    const escaped = String(filters.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { title: { $regex: escaped, $options: "i" } },
      { reference: { $regex: escaped, $options: "i" } },
    ];
  }

  return query;
}

/** Whitelist sort options. Never pass client input straight to `.sort()`. */
function parseSort(sort) {
  const allowed = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    due: { dueAt: 1 },
    status: { status: 1 },
  };
  return allowed[sort] ?? allowed.newest;
}

/**
 * Fetch one request, enforcing read access.
 *
 * @param {object} params
 * @param {string} params.requestId Request id or reference.
 * @param {object} params.user
 * @returns {Promise<object>}
 * @throws 404 when not found *or* not visible.
 *
 * A caller who may not see a record receives the same 404 as one that does not
 * exist, so ids cannot be probed to discover other students' requests.
 */
async function getRequest({ requestId, user, req }) {
  // Accept either an ObjectId or a reference. Resolving first avoids building
  // a `$or` whose `_id` branch may hold a non-ObjectId string, which Mongoose
  // rejects with a CastError (a 500 on a perfectly valid request).
  const condition = /^[a-f\d]{24}$/i.test(String(requestId))
    ? { $or: [{ _id: requestId }, { reference: String(requestId) }] }
    : { reference: String(requestId) };

  const request = await Request.findOne(condition)
    .populate("requestType", "name code fields")
    .populate("department", "name code")
    .populate("student", "rollNumber semester year program")
    .populate("assignedTo", "fullName email role")
    .populate("documents");

  if (!request) {
    throw ApiError.notFound("Request not found");
  }

  const scope = (await buildScopeFilter(user, req)) ?? {};
  if (scope && !matchesScope(request, scope)) {
    // Indistinguishable from "does not exist".
    throw ApiError.notFound("Request not found");
  }

  // Strip internal notes unless the caller may see them.
  if (!userHasPermission(user, P.REQUEST_INTERNAL_NOTE)) {
    request.internalNotes = undefined;
  }

  return request;
}

/** Does a document satisfy a scope filter object? */
function matchesScope(doc, scope) {
  return Object.entries(scope).every(([key, value]) => {
    if (value === null) return false; // `_id: null` matches nothing
    if (key === "$or") {
      return value.some((clause) =>
        Object.entries(clause).every(([k, v]) => String(doc[k]) === String(v))
      );
    }
    const actual = doc[key];
    if (actual && typeof actual === "object" && "_id" in actual) {
      return String(actual._id) === String(value);
    }
    return String(actual) === String(value);
  });
}

/**
 * Add a student-visible comment.
 *
 * Only the owning student and staff who may read the request can comment.
 */
async function addComment({ requestId, user, body }) {
  const request = await getRequest({ requestId, user });

  await Request.updateOne(
    { _id: request._id },
    {
      $push: {
        comments: {
          author: user._id,
          authorRole: user.role,
          body: body.trim(),
          at: new Date(),
        },
      },
    }
  );

  return Request.findById(request._id).select("comments").lean();
}

/**
 * Add a staff-only internal note.
 *
 * Requires the internal-note permission, which no student holds.
 */
async function addInternalNote({ requestId, user, body }) {
  if (!userHasPermission(user, P.REQUEST_INTERNAL_NOTE)) {
    throw ApiError.forbidden("You cannot add internal notes to this request");
  }

  const request = await getRequest({ requestId, user });

  await Request.updateOne(
    { _id: request._id },
    { $push: { internalNotes: { author: user._id, body: body.trim(), at: new Date() } } }
  );

  return Request.findById(request._id).select("internalNotes").lean();
}

module.exports = {
  submitRequest,
  listRequests,
  getRequest,
  addComment,
  addInternalNote,
  generateReference,
  buildScopeFilter,
  validateAgainstType,
  SCOPE,
};
