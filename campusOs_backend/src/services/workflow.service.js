/**
 * Workflow service — the only module permitted to write `Request.status`.
 *
 * ## Two independent checks
 *
 * A transition must clear both gates, in this order:
 *
 *  1. **Legality** — does the edge exist in the table at all? Answered by
 *     `utils/workflow.js`, independent of who is asking.
 *  2. **Authority** — does the actor hold the permission that edge requires?
 *
 * Separating them means an illegal move reports "that transition does not
 * exist" (422) while a legal-but-unauthorised one reports "you may not do
 * that" (403), and neither can be reached by skipping the other.
 *
 * ## Optimistic concurrency
 *
 * The write is a single `findOneAndUpdate` whose filter includes the status we
 * expect to move *from*:
 *
 *   findOneAndUpdate({ _id, status: expectedFrom, ...ownership }, { $set: { status: to } })
 *
 * MongoDB re-evaluates a single-document predicate while holding the document
 * lock, so two simultaneous approvals of the same request cannot both succeed:
 * the loser matches nothing and is reported as a conflict. This needs no
 * transaction and therefore works on a standalone `mongod`.
 *
 * ## Ownership is part of the filter, not a separate check
 *
 * `assignedTo` is included in the same filter for assignee-scoped transitions.
 * A request reassigned between read and write will simply not match, which
 * closes the window where a staff member acts on a request that is no longer
 * theirs.
 */

const Request = require("../models/Request");
const Student = require("../models/Student");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const workflow = require("../utils/workflow");
const { userHasPermission } = require("../utils/permissions");
const { REQUEST_STATUS, AUDIT_ACTION, ROLES } = require("../config/constants");
const { logger } = require("../config/logger");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");

/**
 * Resolve a caller-supplied identifier to a Request `_id`.
 *
 * The API accepts either a 24-character ObjectId or a human-readable reference
 * (`REQ-2026-000042`) — the URL validator permits both, and the SPA uses the
 * reference because it reads better. Feeding a reference into `_id` produces a
 * CastError (a 500), so both forms must be resolved here, before any query is
 * built.
 *
 * @param {string} identifier
 * @returns {Promise<import('mongoose').Types.ObjectId>}
 * @throws 404 when neither form matches a request.
 */
async function resolveRequestId(identifier) {
  const asObjectId = /^[a-f\d]{24}$/i.test(String(identifier)) ? identifier : null;

  if (asObjectId) return asObjectId;

  const found = await Request.findOne({ reference: String(identifier) })
    .select("_id")
    .lean();

  if (!found) {
    throw ApiError.notFound("Request not found");
  }

  return found._id;
}

/**
 * Transitions that only the owning assignee may perform.
 * For these, the atomic filter also pins `assignedTo`.
 */
const ASSIGNEE_SCOPED = new Set([
  REQUEST_STATUS.UNDER_REVIEW,
  REQUEST_STATUS.APPROVAL_PENDING,
  REQUEST_STATUS.PROCESSING,
  REQUEST_STATUS.COMPLETED,
]);

/**
 * Statuses a student is allowed to act on.
 *
 * Note the ownership gate is applied separately and always — a student's
 * permission says "students may cancel their own requests", never "students
 * may cancel requests".
 */
const STUDENT_OWNED_STATUSES = new Set([
  REQUEST_STATUS.DRAFT,
  REQUEST_STATUS.ACTION_REQUIRED,
  REQUEST_STATUS.SUBMITTED,
]);

/**
 * Build the Mongo filter that pins the preconditions for a transition.
 *
 * Every guard that could be racy is expressed here so it is enforced by the
 * same atomic write, rather than by a read-then-write check that another
 * request could interleave with.
 */
function buildTransitionFilter({ requestId, expectedFrom, to, user, isAssignee }) {
  const filter = { _id: requestId, status: expectedFrom };

  // A student may only ever touch their own request.
  if (user.role === ROLES.STUDENT) {
    if (!STUDENT_OWNED_STATUSES.has(expectedFrom)) {
      throw ApiError.forbidden("You cannot act on this request at its current stage");
    }
    filter.student = user.student;
  } else if (ASSIGNEE_SCOPED.has(to)) {
    // Only the assignee may advance the request. An exception is made when a
    // privileged role with explicit scope performs the move.
    const mayActWithoutAssignment =
      userHasPermission(user, "request:review:institution") ||
      userHasPermission(user, "request:approve:institution");

    if (!isAssignee && !mayActWithoutAssignment) {
      filter.assignedTo = user._id.toString();
    }
  }

  return filter;
}

/**
 * Perform a status transition.
 *
 * @param {object} params
 * @param {string} params.requestId
 * @param {string} params.to            Target status.
 * @param {object} params.user          Acting user (a Mongoose document).
 * @param {string} params.expectedFrom  Status the caller believes it is in.
 * @param {string} [params.reason]      Required on some edges.
 * @param {string} [params.resolution]  Required when completing.
 * @param {string} [params.assignTo]    When moving to ASSIGNED.
 * @param {object} [params.req]         Express request, for audit metadata.
 * @returns {Promise<object>} The updated request.
 */
async function transition({
  requestId: rawRequestId,
  to,
  user,
  expectedFrom,
  reason,
  resolution,
  assignTo,
  req,
}) {
  // Accept either an ObjectId or a reference such as "REQ-2026-000042".
  const requestId = await resolveRequestId(rawRequestId);

  // --- 1. The edge must exist -------------------------------------------
  const edge = workflow.findTransition(expectedFrom, to);
  if (!edge) {
    const legal = workflow.transitionsFrom(expectedFrom).map((t) => t.to);
    throw new ApiError(
      ERROR_CODE.INVALID_TRANSITION,
      `A request cannot move from ${expectedFrom} to ${to}`,
      {
        details: [
          {
            field: "to",
            message:
              legal.length > 0
                ? `Allowed from ${expectedFrom}: ${legal.join(", ")}`
                : `${expectedFrom} is a final status and cannot change`,
            code: "INVALID_TRANSITION",
          },
        ],
      }
    );
  }

  // --- 2. The actor must hold the required permission -------------------
  if (!userHasPermission(user, edge.permission)) {
    await auditService.recordAccessDenied({
      req,
      user,
      entity: "Request",
      entityId: requestId,
      required: edge.permission,
    });
    throw ApiError.forbidden("You do not have permission to perform this action");
  }

  // --- 3. Required input -------------------------------------------------
  if (edge.reasonRequired && !reason?.trim()) {
    throw ApiError.badRequest(`A reason is required to ${edge.label.toLowerCase()}`);
  }
  if (to === REQUEST_STATUS.COMPLETED && !resolution?.trim()) {
    throw ApiError.badRequest("A resolution summary is required to complete a request");
  }

  // Assignment target is required to move into ASSIGNED.
  if (to === REQUEST_STATUS.ASSIGNED && !assignTo) {
    throw ApiError.badRequest("An assignee is required");
  }

  const now = new Date();

  // Read once for context (history, current owner) before the atomic write.
  const current = await Request.findById(requestId).select(
    "status assignedTo student statusHistory"
  );
  if (!current) {
    throw ApiError.notFound("Request not found");
  }

  const isAssignee =
    current.assignedTo && current.assignedTo.toString() === user._id.toString();

  const filter = buildTransitionFilter({
    requestId,
    expectedFrom,
    to,
    user,
    isAssignee,
  });

  // Ownership conditions are separated from the status condition so that a
  // failed write can be reported correctly. Conflating them would either leak
  // the existence of another user's record or misreport an ordinary race.
  const ownershipFilter = { ...filter };
  delete ownershipFilter.status;

  const update = {
    $set: {
      status: to,
      ...(to === REQUEST_STATUS.ASSIGNED ? { assignedTo: assignTo } : {}),
      ...(to === REQUEST_STATUS.COMPLETED ? { resolution, completedAt: now } : {}),
      ...(to === REQUEST_STATUS.CANCELLED ? { cancelledAt: now } : {}),
      ...(to === REQUEST_STATUS.SUBMITTED ? { submittedAt: now } : {}),
    },
    $push: {
      statusHistory: {
        from: expectedFrom,
        to,
        actor: user._id,
        actorRole: user.role,
        reason: reason?.trim() || undefined,
        at: now,
      },
    },
  };

  const updated = await Request.findOneAndUpdate(filter, update, {
    new: true,
    runValidators: true,
  });

  if (!updated) {
    // --- 4. Why the write matched nothing ------------------------------
    //
    // Two very different situations produce the same empty result, and they
    // must not be reported the same way:
    //
    //  - the caller does not own the request -> 404, identical to "no such
    //    request". Reporting a conflict here would confirm the record exists,
    //    letting a caller probe ids to discover other students' applications.
    //  - the caller does own it, but the status moved underneath them -> 409,
    //    so they know to refresh.
    const exists = await Request.findOne(ownershipFilter).select("_id status").lean();

    if (!exists) {
      throw ApiError.notFound("Request not found");
    }

    throw new ApiError(
      ERROR_CODE.CONFLICT,
      "This request was updated by someone else. Refresh and try again.",
      {
        details: [
          {
            field: "status",
            message: `Expected ${expectedFrom} but the request is now ${exists.status}`,
            code: "STALE_STATE",
          },
        ],
      }
    );
  }

  // --- 5. Side effects (never fatal to the transition) ------------------
  await recordTransition(updated, { user, reason, from: expectedFrom, to, req });

  logger.info(
    { requestId, from: expectedFrom, to, actor: user._id.toString() },
    "Request transitioned"
  );

  return updated;
}

/**
 * Audit entry and notification for a completed transition.
 *
 * Deliberately awaited but individually guarded: the audit record matters, and
 * the notification must not be able to fail the operation that produced it.
 */
async function recordTransition(request, { user, reason, from, to, req }) {
  try {
    await auditService.record({
      action: AUDIT_ACTION.STATUS_TRANSITION,
      entity: "Request",
      entityId: request._id,
      entityRef: request.reference,
      metadata: {
        from,
        to,
        reason: reason ? reason.slice(0, 200) : undefined,
      },
      actor: user,
      req,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to audit status transition");
  }

  try {
    await notifyParticipants(request, { to });
  } catch (error) {
    logger.error({ err: error }, "Failed to notify participants of transition");
  }
}

/**
 * Notify the people affected by a transition.
 *
 * Text is composed here from the status names only — the request's own content
 * is never copied into a notification.
 *
 * Recipients must be **User** ids. `Request.student` points at a Student
 * profile, whose id differs from the owning User's id, so the profile is
 * resolved before notifying. Using the profile id directly is a silent failure:
 * the notification is created successfully and simply never appears for anyone.
 */
async function notifyParticipants(request, { to }) {
  const notifications = [];

  const studentProfile = await Student.findById(request.student).select("user").lean();

  if (studentProfile?.user) {
    notifications.push(
      notificationService.notify({
        userId: studentProfile.user.toString(),
        type: "REQUEST_STATUS_CHANGED",
        title: `Request ${request.reference} is now ${humanise(to)}`,
        body: statusMessage(to),
        link: `/student/requests/${request.reference}`,
        // One notification per request per status, so a retried transition does
        // not produce a duplicate.
        dedupeKey: `req:${request._id}:${to}`,
      })
    );
  }

  // The assignee should hear about approvals and escalations immediately.
  if (to === REQUEST_STATUS.ACTION_REQUIRED && request.assignedTo) {
    notifications.push(
      notificationService.notify({
        userId: request.assignedTo.toString(),
        type: "REQUEST_ACTION_REQUIRED",
        title: `Information requested for ${request.reference}`,
        body: "A student has been asked for more information.",
        link: `/management/requests/${request.reference}`,
        dedupeKey: `req:${request._id}:action-required`,
      })
    );
  }

  await Promise.all(notifications);
}

/** "UNDER_REVIEW" -> "Under review" */
function humanise(status) {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Student-facing explanation of a status. */
function statusMessage(status) {
  const messages = {
    [REQUEST_STATUS.SUBMITTED]:
      "Your application has been received and is awaiting assignment.",
    [REQUEST_STATUS.ASSIGNED]: "An officer has been assigned to your application.",
    [REQUEST_STATUS.UNDER_REVIEW]: "Your application is being reviewed.",
    [REQUEST_STATUS.ACTION_REQUIRED]:
      "Please provide the requested information to continue.",
    [REQUEST_STATUS.APPROVAL_PENDING]: "Your application is awaiting approval.",
    [REQUEST_STATUS.APPROVED]: "Your application has been approved.",
    [REQUEST_STATUS.REJECTED]: "Your application was rejected. See the details provided.",
    [REQUEST_STATUS.PROCESSING]: "Your application is being processed.",
    [REQUEST_STATUS.COMPLETED]: "Your application has been completed.",
    [REQUEST_STATUS.CANCELLED]: "Your application was cancelled.",
    [REQUEST_STATUS.ESCALATED]:
      "Your application has been escalated for further attention.",
  };
  return messages[status] ?? `Status updated to ${humanise(status)}.`;
}

module.exports = {
  transition,
  resolveRequestId,
  statusMessage,
  humanise,
  ASSIGNEE_SCOPED,
};
