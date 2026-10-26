/**
 * Request controller.
 *
 * Thin HTTP layer. Every read goes through `request.service.getRequest` and
 * every write through the workflow or request service, so authorization is
 * never decided here.
 */

const requestService = require("../services/request.service");
const workflowService = require("../services/workflow.service");
const RequestType = require("../models/RequestType");
const adminService = require("../services/admin.service");
const User = require("../models/User");
const { asyncHandler } = require("../utils/asyncHandler");
const {
  sendSuccess,
  sendCreated,
  sendPaginated,
  buildPaginationMeta,
} = require("../utils/response");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { userHasPermission, P } = require("../utils/permissions");
const workflow = require("../utils/workflow");

/**
 * POST /api/v1/requests
 *
 * Accepts an `Idempotency-Key` header so a client retrying a failed submit
 * receives the original request instead of creating a duplicate.
 */
const createRequest = asyncHandler(async (req, res) => {
  const { requestType, title, description, data } = req.validated.body;
  const idempotencyKey = req.get("idempotency-key");

  const request = await requestService.submitRequest({
    user: req.user,
    requestTypeId: requestType,
    title,
    description,
    data,
    idempotencyKey,
    req,
  });

  return sendCreated(res, {
    message: "Request submitted successfully",
    data: { id: request._id, reference: request.reference, status: request.status },
  });
});

/** GET /api/v1/requests — scoped to what the caller may see. */
const listRequests = asyncHandler(async (req, res) => {
  const { page, limit, ...filters } = req.validated.query;

  const result = await requestService.listRequests({
    user: req.user,
    filters,
    page,
    limit,
    sort: req.validated.query.sort,
    req,
  });

  return sendPaginated(res, {
    items: result.items,
    total: result.total,
    page: result.page,
    limit: result.limit,
    message: "Requests retrieved successfully",
  });
});

/** GET /api/v1/requests/:id */
const getRequest = asyncHandler(async (req, res) => {
  const request = await requestService.getRequest({
    requestId: req.validated.params.id,
    user: req.user,
    req,
  });

  // The student-facing timeline excludes internal-only steps, computed on the
  // server so the client cannot be trusted to filter them.
  const isStudent = req.user.role === "STUDENT";
  const payload = request.toJSON ? request.toJSON() : { ...request };

  if (isStudent) {
    payload.statusHistory = workflow.studentVisibleHistory(request.statusHistory);
    delete payload.internalNotes;
  }

  /**
   * Available actions, so the UI never offers a move the server would reject.
   * Presentation only — every transition is re-validated on submit.
   */
  payload.availableTransitions = workflow
    .availableTransitions(request.status, (permission) =>
      userHasPermission(req.user, permission)
    )
    .map((t) => ({ to: t.to, label: t.label, reasonRequired: t.reasonRequired }));

  return sendSuccess(res, {
    message: "Request retrieved successfully",
    data: payload,
  });
});

/**
 * POST /api/v1/requests/:id/transition
 *
 * The single endpoint through which status ever changes.
 */
const transitionRequest = asyncHandler(async (req, res) => {
  const { to, expectedFrom, reason, resolution, assignTo } = req.validated.body;

  const request = await workflowService.transition({
    requestId: req.validated.params.id,
    to,
    expectedFrom,
    reason,
    resolution,
    assignTo,
    user: req.user,
    req,
  });

  return sendSuccess(res, {
    message: `Request moved to ${workflowService.humanise(request.status)}`,
    data: {
      id: request._id,
      reference: request.reference,
      status: request.status,
    },
  });
});

/** POST /api/v1/requests/:id/assign */
const assignRequest = asyncHandler(async (req, res) => {
  const { assignTo, expectedFrom, reason } = req.validated.body;

  // Confirm the target is a real, active staff account before assigning.
  const assignee = await User.findOne({
    _id: assignTo,
    role: { $ne: "STUDENT" },
    isActive: true,
  }).select("fullName role");

  if (!assignee) {
    throw new ApiError(
      ERROR_CODE.VALIDATION_ERROR,
      "Assignee must be an active staff account"
    );
  }

  const request = await workflowService.transition({
    requestId: req.validated.params.id,
    to: "ASSIGNED",
    expectedFrom,
    reason,
    assignTo,
    user: req.user,
    req,
  });

  return sendSuccess(res, {
    message: "Request assigned",
    data: {
      reference: request.reference,
      status: request.status,
      assignedTo: { id: assignee._id, fullName: assignee.fullName, role: assignee.role },
    },
  });
});

/** POST /api/v1/requests/:id/comments — student-visible. */
const addComment = asyncHandler(async (req, res) => {
  const comments = await requestService.addComment({
    requestId: req.validated.params.id,
    user: req.user,
    body: req.validated.body.body,
  });

  return sendCreated(res, {
    message: "Comment added",
    data: { comments: comments.comments },
  });
});

/** POST /api/v1/requests/:id/internal-notes — staff only. */
const addInternalNote = asyncHandler(async (req, res) => {
  const notes = await requestService.addInternalNote({
    requestId: req.validated.params.id,
    user: req.user,
    body: req.validated.body.body,
  });

  return sendCreated(res, {
    message: "Internal note added",
    data: { internalNotes: notes.internalNotes },
  });
});

/**
 * GET /api/v1/request-types
 *
 * The catalogue students browse. Inactive types are hidden from students and
 * shown to administrators managing the catalogue.
 */
const listRequestTypes = asyncHandler(async (req, res) => {
  const { department, includeInactive, page, limit } = req.validated.query;

  const canManage = userHasPermission(req.user, P.REQUEST_TYPE_MANAGE);
  const filter = {};

  if (!canManage || includeInactive !== true) {
    filter.isActive = true;
  }
  if (department) filter.department = department;

  const [items, total] = await Promise.all([
    RequestType.find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    RequestType.countDocuments(filter),
  ]);

  return sendSuccess(res, {
    message: "Request types retrieved successfully",
    data: items,
    meta: buildPaginationMeta(total, page, limit),
  });
});

/** GET /api/v1/request-types/:id */
const getRequestType = asyncHandler(async (req, res) => {
  const requestType = await RequestType.findById(req.validated.params.id).lean();

  if (
    !requestType ||
    (!requestType.isActive && !userHasPermission(req.user, P.REQUEST_TYPE_MANAGE))
  ) {
    throw ApiError.notFound("Request type not found");
  }

  return sendSuccess(res, {
    message: "Request type retrieved successfully",
    data: requestType,
  });
});

/**
 * POST /api/v1/request-types
 *
 * Creates a catalogue entry. Administration only; the field definition it
 * accepts becomes the validation contract every future submission is checked
 * against, so the schema is strict.
 */
/**
 * Kept at the original path for the existing clients, but the rules now live in
 * one place.
 *
 * This route used to talk to the model directly, which meant it skipped the
 * duplicate-name/code check the administration screen uses. Two ways to create
 * one thing with different rules is how a catalogue ends up with two services
 * called "Bonafide".
 */
const createRequestType = asyncHandler(async (req, res) => {
  const requestType = await adminService.createRequestType({
    payload: req.validated.body,
    user: req.user,
    req,
  });

  return sendCreated(res, {
    message: "Request type created",
    data: requestType,
  });
});

module.exports = {
  createRequest,
  listRequests,
  getRequest,
  transitionRequest,
  assignRequest,
  addComment,
  addInternalNote,
  listRequestTypes,
  getRequestType,
  createRequestType,
};
