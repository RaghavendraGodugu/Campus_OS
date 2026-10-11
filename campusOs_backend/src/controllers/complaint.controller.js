/**
 * Complaint controller.
 *
 * HTTP layer only. Every read and write goes through complaint.service, which
 * is where confidentiality and authorization are enforced — a controller has
 * no way to widen access without editing that service, which is the point.
 */

const complaintService = require("../services/complaint.service");
const complaintWorkflow = require("../utils/complaintWorkflow");
const { asyncHandler } = require("../utils/asyncHandler");
const { sendSuccess, sendCreated, sendPaginated } = require("../utils/response");
const { userHasPermission, P } = require("../utils/permissions");
const { ROLES } = require("../config/constants");
const slaPolicy = require("../utils/slaPolicy");

/**
 * POST /api/v1/complaints
 */
const fileComplaint = asyncHandler(async (req, res) => {
  const complaint = await complaintService.fileComplaint({
    user: req.user,
    payload: req.validated.body,
    req,
  });

  // Confidential flag is reported back so the student knows who can see it,
  // but nothing beyond the reference and status is echoed.
  return sendCreated(res, {
    message: "Complaint filed successfully",
    data: {
      id: complaint._id,
      reference: complaint.reference,
      status: complaint.status,
      confidential: complaint.confidential,
      dueAt: complaint.dueAt,
    },
  });
});

/** GET /api/v1/complaints — visibility-filtered in the query. */
const listComplaints = asyncHandler(async (req, res) => {
  const { page, limit, ...filters } = req.validated.query;

  const result = await complaintService.listComplaints({
    user: req.user,
    filters,
    page,
    limit,
  });

  return sendPaginated(res, {
    items: result.items,
    total: result.total,
    page: result.page,
    limit: result.limit,
    message: "Complaints retrieved successfully",
  });
});

/** GET /api/v1/complaints/:id */
const getComplaint = asyncHandler(async (req, res) => {
  const complaint = await complaintService.getComplaint({
    complaintId: req.validated.params.id,
    user: req.user,
  });

  const payload = complaint.toJSON ? complaint.toJSON() : { ...complaint };

  payload.sla = complaintService.slaStatusFor(complaint);
  payload.availableTransitions = complaintWorkflow
    .availableComplaintTransitions(complaint.status, (permission) =>
      userHasPermission(req.user, permission)
    )
    .map((t) => ({ to: t.to, label: t.label, reasonRequired: t.reasonRequired }));

  return sendSuccess(res, {
    message: "Complaint retrieved successfully",
    data: payload,
  });
});

/** POST /api/v1/complaints/:id/transition */
const transitionComplaint = asyncHandler(async (req, res) => {
  const { to, expectedFrom, note, reason, resolution, assignTo } = req.validated.body;

  const complaint = await complaintService.transition({
    complaintId: req.validated.params.id,
    to,
    expectedFrom,
    note,
    reason,
    resolution,
    assignTo,
    user: req.user,
    req,
  });

  return sendSuccess(res, {
    message: `Complaint moved to ${complaint.status}`,
    data: {
      reference: complaint.reference,
      status: complaint.status,
      sla: complaintService.slaStatusFor(complaint),
    },
  });
});

/** POST /api/v1/complaints/:id/updates — student-visible. */
const addUpdate = asyncHandler(async (req, res) => {
  const result = await complaintService.addUpdate({
    complaintId: req.validated.params.id,
    user: req.user,
    body: req.validated.body.body,
  });

  return sendCreated(res, {
    message: "Update added",
    data: { updates: result.updates },
  });
});

/** POST /api/v1/complaints/:id/internal-notes — staff only. */
const addInternalNote = asyncHandler(async (req, res) => {
  const result = await complaintService.addInternalNote({
    complaintId: req.validated.params.id,
    user: req.user,
    body: req.validated.body.body,
  });

  return sendCreated(res, {
    message: "Internal note added",
    data: { internalNotes: result.internalNotes },
  });
});

/** POST /api/v1/complaints/:id/feedback — complainant only, once. */
const submitFeedback = asyncHandler(async (req, res) => {
  const { rating, satisfied, comment } = req.validated.body;

  const result = await complaintService.submitFeedback({
    complaintId: req.validated.params.id,
    user: req.user,
    rating,
    satisfied,
    comment,
  });

  return sendCreated(res, {
    message: "Thank you for your feedback",
    data: { feedback: result.feedback },
  });
});

/**
 * GET /api/v1/complaints/sla-policy
 *
 * Exposes the configured response-time policy so management screens can show
 * "expected first response by ..." without hardcoding a number in the client.
 */
const getSlaPolicy = asyncHandler(async (req, res) => {
  const ladder = slaPolicy.ESCALATION_LADDER.map((step) => ({
    level: step.level,
    afterHours: step.afterHours,
    notifyRoles: step.notifyRoles,
    description: step.description,
  }));

  return sendSuccess(res, {
    message: "SLA policy retrieved",
    data: {
      calendar: slaPolicy.CALENDAR,
      categoryResponseHours: slaPolicy.CATEGORY_RESPONSE_HOURS,
      defaultResponseHours: slaPolicy.DEFAULT_RESPONSE_HOURS,
      escalationLadder: ladder,
      maxEscalationLevel: slaPolicy.MAX_ESCALATION_LEVEL,
    },
  });
});

module.exports = {
  fileComplaint,
  listComplaints,
  getComplaint,
  transitionComplaint,
  addUpdate,
  addInternalNote,
  submitFeedback,
  getSlaPolicy,
  ROLES,
  P,
};
