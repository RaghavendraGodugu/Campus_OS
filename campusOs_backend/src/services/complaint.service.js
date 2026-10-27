/**
 * Complaint service.
 *
 * ## Confidentiality lives here, in the query
 *
 * `buildVisibilityFilter` is the only place that decides who may see which
 * complaint, and it produces a Mongo predicate rather than a post-filter. A
 * confidential complaint never enters the result set for an unprivileged
 * caller, so it cannot leak through pagination totals, an aggregate, or an
 * accidental `JSON.stringify` of a fetched document.
 *
 * ## Why a 404 and not a 403
 *
 * Telling a caller "that complaint exists but you may not see it" is itself a
 * disclosure. An unprivileged caller receives exactly the response a
 * non-existent complaint would produce.
 */

const Complaint = require("../models/Complaint");
const Counter = require("../models/Counter");
const Student = require("../models/Student");
const { ApiError, ERROR_CODE } = require("../utils/ApiError");
const { userHasPermission, P } = require("../utils/permissions");
const { resolveStudentProfile } = require("../middleware/auth");
const crypto = require("crypto");

const {
  ROLES,
  COMPLAINT_STATUS,
  COMPLAINT_PRIORITY,
  AUDIT_ACTION,
} = require("../config/constants");
const complaintWorkflow = require("../utils/complaintWorkflow");
const slaPolicy = require("../utils/slaPolicy");
const slaUtils = require("../utils/sla");
const auditService = require("./audit.service");

const { counterKey, formatReference } = Counter;
const NAMESPACE = "complaint";
const PREFIX = "CMP";

/** Generate the next complaint reference, e.g. `CMP-2026-000042`. */
async function generateReference(year = new Date().getFullYear()) {
  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey(NAMESPACE, year) },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return formatReference(PREFIX, year, counter.seq);
}

/**
 * Build the visibility predicate for a user.
 *
 * The shape is always:
 *
 *   base clause          — ownership / assignment / department / institution
 *   AND confidential:$lte — the confidentiality restriction
 *
 * The confidentiality term is applied to *every* branch, including a student's
 * own record. A student may always read their own complaint; that is not a
 * disclosure, because they wrote it.
 *
 * @param {object} user
 * @returns {object} A Mongo filter.
 */
function buildVisibilityFilter(user, req) {
  if (user.role === ROLES.STUDENT) {
    // Own complaints only. `confidential: false` is redundant for the owner but
    // harmless, and keeping the shape uniform avoids a subtle future mistake.
    const student = req?.student;
    return { student: student?._id ?? user.student ?? null };
  }

  // Roles that may read any complaint regardless of confidentiality.
  if (userHasPermission(user, P.COMPLAINT_READ_CONFIDENTIAL)) {
    return userHasPermission(user, P.COMPLAINT_READ_INSTITUTION)
      ? {}
      : { department: user.department ?? null };
  }

  // Everyone else: restricted complaints are invisible, full stop.
  const visibility = { confidential: { $ne: true } };

  if (userHasPermission(user, P.COMPLAINT_READ_INSTITUTION)) {
    return visibility;
  }

  // A department-scoped role sees its own department's queue. This includes
  // complaints that are not yet assigned to anyone: triage is precisely the
  // act of taking an unassigned complaint in hand, so hiding unassigned work
  // would leave nothing to triage.
  if (userHasPermission(user, P.COMPLAINT_READ_DEPARTMENT)) {
    return { ...visibility, department: user.department ?? null };
  }

  // Staff who triage: they may see the unassigned, non-restricted queue.
  //
  // This exists because triage and handling are different acts. Acknowledging
  // an unassigned complaint is how it becomes someone's work; if staff could
  // only see complaints already assigned to them, nothing could ever be
  // assigned in the first place. The `confidential: {$ne: true}` term remains,
  // so the triage queue never contains restricted material — picking up a
  // grievance is a separate, deliberate grant.
  if (userHasPermission(user, P.COMPLAINT_TRIAGE)) {
    return visibility;
  }

  // A handler with no triage right sees only what is assigned to them.
  if (userHasPermission(user, P.COMPLAINT_READ_ASSIGNED)) {
    return { ...visibility, assignedTo: user._id };
  }

  // Least privilege: nothing visible.
  return { _id: null, ...visibility };
}

/**
 * May this user read this specific complaint?
 *
 * Used after a fetch that was already scope-filtered, and to decide whether an
 * assigned handler may see a confidential complaint.
 *
 * @param {object} complaint
 * @param {object} user
 */
function canRead(complaint, user, _req) {
  const id = (value) => (value && value._id ? value._id.toString() : value?.toString());

  // Student can read their own complaints (confidential or not)
  if (user.role === ROLES.STUDENT) {
    const studentId = _req?.student?._id?.toString() ?? user.student?.toString();
    return Boolean(complaint.student && id(complaint.student) === studentId);
  }

  // Confidential complaints: only complainant, assigned handler, and oversight roles
  if (complaint.confidential) {
    // Oversight roles can read any confidential complaint
    if (userHasPermission(user, P.COMPLAINT_READ_CONFIDENTIAL)) return true;
    // Assigned handler can always read their assigned complaint
    if (complaint.assignedTo && id(complaint.assignedTo) === user._id.toString())
      return true;
    // Complainant (student) can read their own confidential complaint
    if (
      complaint.student &&
      _req?.student &&
      id(complaint.student) === _req.student._id.toString()
    )
      return true;
    if (
      complaint.student &&
      user.student &&
      id(complaint.student) === user.student.toString()
    )
      return true;
    return false;
  }

  // Non-confidential complaints
  if (userHasPermission(user, P.COMPLAINT_READ_INSTITUTION)) return true;
  if (complaint.assignedTo && id(complaint.assignedTo) === user._id.toString())
    return true;
  if (
    userHasPermission(user, P.COMPLAINT_READ_DEPARTMENT) &&
    complaint.department &&
    id(complaint.department) === user.department?.toString()
  )
    return true;
  if (userHasPermission(user, P.COMPLAINT_TRIAGE)) return true;
  return false;
}

/**
 * File a complaint.
 *
 * @param {object} params
 * @param {object} params.user
 * @param {object} params.payload Validated body.
 * @param {object} [params.req]
 * @returns {Promise<object>}
 */
async function fileComplaint({ user, payload, req }) {
  // Support both middleware-attached student (req.student) and legacy user.student,
  // plus auto-resolving student profile for student accounts.
  let student =
    req?.student ?? (user.student ? await Student.findById(user.student).lean() : null);
  if (!student && user.role === ROLES.STUDENT) {
    student = await resolveStudentProfile(user);
  }
  if (!student) {
    throw ApiError.forbidden(
      "Only student accounts with a linked student profile can file complaints"
    );
  }

  const now = new Date();

  // Confidentiality is derived from the category by the schema default, so a
  // client cannot downgrade a harassment complaint. Reading it from a
  // throwaway document rather than trusting the request body means the
  // client's claim is never consulted.
  //
  // `validate()` is deliberately not called: this instance exists only to have
  // the default evaluated, and full validation would fail on the fields not yet
  // assigned.
  const provisional = new Complaint({ category: payload.category });
  const confidential = provisional.confidential;

  const reference = await generateReference(now.getFullYear());

  // Deadline from configured policy, not a constant.
  const dueAt = slaPolicy.responseDeadlineFor(now, payload.category);

  const complaint = await Complaint.create({
    reference,
    student: student._id,
    department: payload.department ?? null,
    subject: payload.subject,
    description: payload.description,
    category: payload.category,
    subCategory: payload.subCategory,
    confidential,
    priority: payload.priority,
    status: COMPLAINT_STATUS.OPEN,
    dueAt,
    submittedAt: now,
    statusHistory: [
      {
        from: null,
        to: COMPLAINT_STATUS.OPEN,
        actor: user._id,
        actorRole: user.role,
        at: now,
      },
    ],
  });

  await auditService.record({
    action: AUDIT_ACTION.CREATE,
    entity: "Complaint",
    entityId: complaint._id,
    entityRef: complaint.reference,
    // Deliberately does NOT record the description: audit readers are a wider
    // audience than the complaint handlers.
    metadata: { category: complaint.category, confidential },
    actor: user,
    req,
  });

  return complaint;
}

/**
 * List complaints visible to a user.
 *
 * @param {object} params
 * @param {object} params.user
 * @param {object} [params.filters]
 * @param {number} [params.page]
 * @param {number} [params.limit]
 */
async function listComplaints({ user, filters = {}, page = 1, limit = 20, req }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);

  const query = {
    ...buildVisibilityFilter(user, req),
    ...buildFilters(filters, user, req),
  };

  const [items, total] = await Promise.all([
    Complaint.find(query)
      .sort({ submittedAt: -1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("department", "name code")
      .populate("assignedTo", "fullName role")
      .lean(),
    Complaint.countDocuments(query),
  ]);

  // Internal notes never leave this service for a caller who may not see them.
  const canSeeNotes = user.role !== ROLES.STUDENT;
  const shaped = items.map((item) => shapeForReader(item, canSeeNotes));

  return { items: shaped, total, page: safePage, limit: safeLimit };
}

/** Strip fields the reader is not entitled to. */
function shapeForReader(complaint, canSeeInternal) {
  const shaped = { ...complaint };
  if (!canSeeInternal) {
    delete shaped.internalNotes;
  }
  return shaped;
}

/** Client filters, intersected with — never widening — the visibility scope. */
function buildFilters(filters, user, _req) {
  const query = {};

  if (filters.status) query.status = filters.status;
  if (filters.category) query.category = filters.category;
  if (filters.priority) query.priority = filters.priority;

  // `confidential` is not a filter a non-oversight caller may use.
  if (userHasPermission(user, P.COMPLAINT_READ_CONFIDENTIAL)) {
    if (filters.confidential !== undefined) {
      query.confidential = filters.confidential === "true";
    }
  }

  if (filters.department && userHasPermission(user, P.COMPLAINT_READ_DEPARTMENT)) {
    query.department = filters.department;
  }

  if (filters.overdue === "true") {
    query.dueAt = { $lt: new Date() };
    query.resolvedAt = null;
    query.respondedAt = null;
  }

  if (filters.assignedToMe && user.role !== ROLES.STUDENT) {
    query.assignedTo = user._id;
  }

  return query;
}

/**
 * Fetch one complaint, enforcing visibility.
 *
 * @throws 404 when absent or not visible — never 403.
 */
async function getComplaint({ complaintId, user, req }) {
  const complaint = await Complaint.findOne({
    $or: [{ _id: toObjectId(complaintId) }, { reference: String(complaintId) }],
  })
    .populate("department", "name code")
    .populate("assignedTo", "fullName role")
    .populate("student", "rollNumber program semester");

  if (!complaint) {
    throw ApiError.notFound("Complaint not found");
  }

  if (!canRead(complaint, user, req)) {
    // Identical to a genuinely missing record.
    throw ApiError.notFound("Complaint not found");
  }

  if (user.role === ROLES.STUDENT) {
    complaint.internalNotes = undefined;
    // The student should not see their own SLA breach accounting.
    complaint.slaBreachMinutes = undefined;
  }

  return complaint;
}

/** Only pass a well-formed ObjectId into a query; otherwise null. */
function toObjectId(value) {
  return /^[a-f\d]{24}$/i.test(String(value)) ? String(value) : null;
}

/**
 * Apply a status transition.
 *
 * Mirrors the request workflow: a declared edge, an authority check, then a
 * single atomic write whose filter pins the expected status and the
 * confidentiality-scoped visibility, so a reassignment or a permission change
 * between read and write invalidates the attempt.
 *
 * @param {object} params
 * @param {string} params.complaintId
 * @param {string} params.to
 * @param {string} params.expectedFrom
 * @param {object} params.user
 * @param {string} [params.note]     Student-visible update.
 * @param {string} [params.reason]
 * @param {string} [params.resolution]
 * @param {string} [params.assignTo]
 * @param {object} [params.req]
 */
async function transition({
  complaintId,
  to,
  expectedFrom,
  user,
  note,
  reason,
  resolution,
  assignTo,
  req,
}) {
  const edge = complaintWorkflow.findComplaintTransition(expectedFrom, to);

  if (!edge) {
    const legal = complaintWorkflow
      .complaintTransitionsFrom(expectedFrom)
      .map((t) => t.to);
    throw new ApiError(
      ERROR_CODE.INVALID_TRANSITION,
      `A complaint cannot move from ${expectedFrom} to ${to}`,
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

  if (!userHasPermission(user, edge.permission)) {
    await auditService.recordAccessDenied({
      req,
      user,
      entity: "Complaint",
      entityId: complaintId,
      required: edge.permission,
    });
    throw ApiError.forbidden("You do not have permission to perform this action");
  }

  if (edge.reasonRequired && !reason?.trim()) {
    throw ApiError.badRequest(`A reason is required to ${edge.label.toLowerCase()}`);
  }
  if (edge.noteRequired && !note?.trim()) {
    throw ApiError.badRequest(
      `A student-visible update is required to ${edge.label.toLowerCase()}`
    );
  }

  // `note` is commentary shown in the timeline; `resolution` is the formal
  // record of what was done. Both are required when closing, because a
  // timeline entry alone leaves nothing for a later reader to act on.
  if (to === COMPLAINT_STATUS.RESOLVED && !resolution?.trim()) {
    throw ApiError.badRequest("A resolution summary is required to resolve a complaint");
  }

  const condition = {
    $or: [{ _id: toObjectId(complaintId) }, { reference: String(complaintId) }],
  };
  const current = await Complaint.findOne(condition);

  if (!current) {
    throw ApiError.notFound("Complaint not found");
  }

  // Visibility is re-checked here so a caller cannot drive a transition on a
  // complaint they are not permitted to read.
  if (!(await canRead(current, user, req))) {
    throw ApiError.notFound("Complaint not found");
  }

  // Only the assigned handler, a department colleague, or an oversight role may
  // progress a complaint. Department colleagues are included because the first
  // action on an unassigned complaint — acknowledging it — is itself the act of
  // taking it in hand.
  if (user.role !== ROLES.STUDENT && edge.permission !== P.COMPLAINT_REOPEN_OWN) {
    const isAssignee = current.assignedTo?.toString() === user._id.toString();
    const isDepartmental =
      userHasPermission(user, P.COMPLAINT_READ_DEPARTMENT) &&
      current.department &&
      current.department.toString() === user.department?.toString();
    // A triager may take an unassigned complaint in hand — that is the point.
    const isUnclaimedTriage =
      userHasPermission(user, P.COMPLAINT_TRIAGE) && !current.assignedTo;
    const mayOverride = userHasPermission(user, P.COMPLAINT_READ_CONFIDENTIAL);

    if (!isAssignee && !isDepartmental && !isUnclaimedTriage && !mayOverride) {
      throw ApiError.forbidden("Only the assigned handler can progress this complaint");
    }
  }

  const now = new Date();
  const update = {
    $set: {
      status: to,
      ...(to === COMPLAINT_STATUS.RESOLVED
        ? { resolution, resolvedAt: now, canReopen: true }
        : {}),
      ...(to === COMPLAINT_STATUS.REOPENED ? { resolvedAt: null, canReopen: false } : {}),
      ...(assignTo ? { assignedTo: assignTo } : {}),
      // First staff response stops the response clock.
      ...(user.role !== ROLES.STUDENT && !current.respondedAt
        ? { respondedAt: now }
        : {}),
    },
    $push: {
      statusHistory: {
        from: expectedFrom,
        to,
        actor: user._id,
        actorRole: user.role,
        note: note?.trim() || reason?.trim() || undefined,
        at: now,
      },
    },
  };

  // Student-visible update, when one was supplied.
  if (note?.trim()) {
    update.$push.updates = {
      author: user._id,
      authorRole: user.role,
      body: note.trim(),
      at: now,
    };
  }

  const updated = await Complaint.findOneAndUpdate(
    { ...condition, status: expectedFrom },
    update,
    { new: true, runValidators: true }
  );

  if (!updated) {
    throw new ApiError(
      ERROR_CODE.CONFLICT,
      "This complaint was updated by someone else. Refresh and try again.",
      {
        details: [
          {
            field: "status",
            message: `Expected ${expectedFrom} but the complaint is now ${current.status}`,
            code: "STALE_STATE",
          },
        ],
      }
    );
  }

  // Record the breach once the clock has stopped, so the number is stable.
  if (to === COMPLAINT_STATUS.RESOLVED && updated.dueAt) {
    await recordBreach(updated);
  }

  await auditService.record({
    action: AUDIT_ACTION.STATUS_TRANSITION,
    entity: "Complaint",
    entityId: updated._id,
    entityRef: updated.reference,
    // The note may quote the complaint, so only the transition is recorded.
    metadata: { from: expectedFrom, to },
    actor: user,
    req,
  });

  return updated;
}

/**
 * Freeze the breach duration when the clock stops.
 *
 * Computed once so a later report does not change the historical figure.
 */
async function recordBreach(complaint) {
  const calendar = slaPolicy.calendarOptions();
  const stoppedAt = complaint.respondedAt ?? complaint.resolvedAt ?? new Date();
  const overdueMinutes = slaUtils.businessMinutesBetween(
    complaint.dueAt,
    stoppedAt,
    calendar
  );

  if (overdueMinutes > 0) {
    await Complaint.updateOne(
      { _id: complaint._id },
      { $set: { slaBreachMinutes: overdueMinutes } }
    );
  }
}

/**
 * Add a student-visible update.
 */
async function addUpdate({ complaintId, user, body }) {
  const complaint = await getComplaint({ complaintId, user });

  await Complaint.updateOne(
    { _id: complaint._id },
    {
      $push: {
        updates: {
          author: user._id,
          authorRole: user.role,
          body: body.trim(),
          at: new Date(),
        },
      },
    }
  );

  return Complaint.findById(complaint._id).select("updates").lean();
}

/**
 * Add an internal investigation note.
 *
 * Staff only. A student cannot reach this, and a complaint they cannot read
 * cannot be annotated.
 */
async function addInternalNote({ complaintId, user, body }) {
  if (user.role === ROLES.STUDENT) {
    throw ApiError.forbidden("Students cannot add internal notes");
  }

  const complaint = await getComplaint({ complaintId, user });

  await Complaint.updateOne(
    { _id: complaint._id },
    { $push: { internalNotes: { author: user._id, body: body.trim(), at: new Date() } } }
  );

  return Complaint.findById(complaint._id).select("internalNotes").lean();
}

/**
 * Record student feedback on a resolution.
 *
 * One submission only: a second attempt is rejected rather than overwriting,
 * so the recorded satisfaction figure cannot be revised after the fact.
 */
async function submitFeedback({ complaintId, user, rating, satisfied, comment }) {
  const complaint = await getComplaint({ complaintId, user });

  if (user.role !== ROLES.STUDENT) {
    throw ApiError.forbidden("Only the complainant can submit feedback");
  }

  if (!complaintWorkflow.CLOSED_STATUSES.includes(complaint.status)) {
    throw ApiError.badRequest(
      "Feedback can only be submitted once the complaint is closed"
    );
  }

  if (complaint.feedback?.at) {
    throw ApiError.conflict("Feedback has already been submitted for this complaint");
  }

  await Complaint.updateOne(
    { _id: complaint._id, "feedback.at": null },
    {
      $set: {
        "feedback.rating": rating,
        "feedback.satisfied": satisfied,
        "feedback.comment": comment?.trim(),
        "feedback.at": new Date(),
      },
    }
  );

  return Complaint.findById(complaint._id).select("feedback").lean();
}

/**
 * SLA position for a complaint, for display.
 */
function slaStatusFor(complaint) {
  const calendar = slaPolicy.calendarOptions();
  const now = new Date();
  const clockRunning = complaintWorkflow.isComplaintOpen(complaint.status);

  const reference = clockRunning
    ? now
    : (complaint.respondedAt ?? complaint.resolvedAt ?? now);
  // null for an anonymous grievance: there is nobody to hold to a deadline.
  const remaining = slaUtils.businessMinutesBetween(now, complaint.dueAt, calendar);

  return {
    dueAt: complaint.dueAt,
    // `remaining < 0` alone would be true for null — 0 - 1 is 1 — and would
    // report every anonymous complaint as breached.
    breached: remaining !== null && remaining < 0,
    /** Human-readable, e.g. "-2h 15m" when breached. */
    remaining: remaining === null ? null : slaUtils.formatDuration(remaining),
    elapsed: slaUtils.businessMinutesBetween(
      complaint.submittedAt ?? now,
      reference,
      calendar
    ),
    clockRunning,
    frozenBreachMinutes: complaint.slaBreachMinutes,
  };
}

/**
 * A tracking code: 16 characters from an alphabet with no look-alike glyphs, so
 * it survives being read off a phone screen and copied from a printed note.
 *
 * 16 characters of base32 is 80 bits. Guessing one is not a practical attack,
 * which is why the code is still hashed before storage — not to make guessing
 * impossible, but so that a stolen database is not a list of working codes.
 */
function generateTrackingCode() {
  // Excludes 0/O and 1/I/L.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 16; i += 1) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `${code.slice(0, 8)}-${code.slice(8)}`;
}

/**
 * SHA-256, so the same code always produces the same digest and a lookup is a
 * single indexed query rather than a scan.
 *
 * The hyphen is a display convenience for reading a code aloud or copying it
 * from a printed note, so it is stripped before hashing. A code that stops
 * working because somebody dropped a hyphen is the kind of failure that makes a
 * person conclude their report was lost.
 */
function hashTrackingCode(code) {
  const normalised = String(code)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return crypto.createHash("sha256").update(normalised).digest("hex");
}

module.exports = {
  fileComplaint,
  fileAnonymousComplaint,
  trackComplaint,
  generateTrackingCode,
  listComplaints,
  getComplaint,
  transition,
  addUpdate,
  addInternalNote,
  submitFeedback,
  slaStatusFor,
  buildVisibilityFilter,
  canRead,
  generateReference,
};

// ===== Anonymous grievances and tracking =====

/**
 * File a grievance without an account.
 *
 * ## What the record deliberately does not have
 *
 * No student, no user, no email, no IP. The IP is tempting to keep for abuse
 * investigation, but keeping it means the "anonymous" grievance is attached to
 * a person by whoever holds the database — which is the one thing the person
 * filing it was promised would not happen. Abuse is handled with rate limiting
 * and by the fact that the endpoint returns a code, not a receipt.
 *
 * ## What the person gets instead
 *
 * A tracking code, once. It is the only handle on the record, and it is shown
 * one time because the stored value is a hash and cannot be read back.
 */
async function fileAnonymousComplaint({ payload, req }) {
  const reference = await generateReference();
  const now = new Date();

  const trackingCode = generateTrackingCode();

  const complaint = await Complaint.create({
    reference,
    subject: payload.subject,
    description: payload.description,
    category: payload.category,
    subCategory: payload.subCategory?.trim(),
    // Set by the model's category rule, never by the caller. A person must not
    // be able to downgrade a harassment report by passing a flag.
    confidential:
      ["SAFETY", "HARASSMENT", "MISCONDUCT"].includes(payload.category) || undefined,
    isAnonymous: true,
    student: null,
    trackingCodeHash: hashTrackingCode(trackingCode),
    status: COMPLAINT_STATUS.OPEN,
    submittedAt: now,
    priority: COMPLAINT_PRIORITY.HIGH,
    statusHistory: [
      {
        from: null,
        to: COMPLAINT_STATUS.OPEN,
        actor: null,
        actorRole: null,
        at: now,
      },
    ],
  });

  // Recorded without an actor, because there is not one. A null actor is the
  // honest entry; inventing a system user would be a lie in the audit trail.
  await auditService.record({
    action: AUDIT_ACTION.CREATE,
    entity: "Complaint",
    entityId: complaint._id,
    entityRef: complaint.reference,
    metadata: { anonymous: true, category: complaint.category },
    req,
  });

  return {
    reference: complaint.reference,
    trackingCode,
    confidential: complaint.confidential,
    notice:
      "Write this code down now. It is the only way to check on this report, " +
      "and it cannot be recovered or sent to you.",
  };
}

/**
 * Look up a grievance by tracking code.
 *
 * Returns the state of the matter and nothing else — no subject, no category,
 * no description, no assigned officer, no internal notes, and no dates beyond
 * when it arrived and when it last moved.
 *
 * That restraint is the feature. Someone who has been handed a tracking code
 * is being shown that a grievance exists; they are not being given the right to
 * read it. The complainant chose anonymity precisely so that the *content* would
 * not follow them around.
 */
async function trackComplaint({ code }) {
  const hashed = hashTrackingCode(code);

  const complaint = await Complaint.findOne({ trackingCodeHash: hashed })
    .select(
      "+trackingCodeHash reference status submittedAt statusHistory confidential priority"
    )
    .lean();

  if (!complaint) return { found: false };

  const lastActivity = complaint.statusHistory?.length
    ? complaint.statusHistory[complaint.statusHistory.length - 1]?.at
    : complaint.submittedAt;

  return {
    found: true,
    reference: complaint.reference,
    status: complaint.status,
    submittedAt: complaint.submittedAt,
    lastActivityAt: lastActivity ?? complaint.submittedAt,
    // The category is withheld. It is the single most identifying field on a
    // grievance, and someone holding a code is not necessarily its author.
    confidential: complaint.confidential,
    resolved: ["RESOLVED", "REJECTED", "WITHDRAWN"].includes(complaint.status),
    /**
     * A count, not the text. Enough to tell whether anything is happening
     * without describing what was said.
     */
    updateCount: Math.max(0, (complaint.statusHistory?.length ?? 1) - 1),
  };
}
