/**
 * Reports and analytics.
 *
 * ## Scope is resolved once, and absence is not "everything"
 *
 * A viewer holds either `REPORT_READ_INSTITUTION` or `REPORT_READ_DEPARTMENT`.
 * Both are legitimate, and the difference between them is the whole security
 * surface of this module.
 *
 * The rule that carries the weight: **a department-scoped viewer with no
 * department set sees nothing.** It does not see everything, and it does not see
 * an error page full of zeroes — it sees empty sections, because the honest
 * answer to "how many requests did your department handle" when you have no
 * department is "I cannot tell".
 *
 * This is the same trap the announcement audience query could have fallen into,
 * where an absent attribute produced a `null` comparison that matched
 * everything.
 *
 * ## Forbidden sections are omitted, not zeroed
 *
 * A department-scoped viewer asking for the overview is not shown
 * `complaints: 0`. They are shown no complaints section at all. A zero would be
 * an assertion about grievances they were never permitted to see, and on a
 * report that is simply wrong.
 *
 * ## Money is summed as integers
 *
 * `$sum` over integer-valued doubles is exact well past any figure a college
 * will reach (the per-amount ceiling is 1e11 paise), so totals are whole paise
 * and every amount is formatted through `money.format`. Nothing here rounds.
 */

const Student = require("../models/Student");
const Request = require("../models/Request");
const Complaint = require("../models/Complaint");
const Certificate = require("../models/Certificate");
const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const Refund = require("../models/Refund");
const Department = require("../models/Department");
const Program = require("../models/Program");

const { ApiError } = require("../utils/ApiError");
const { userHasPermission, P } = require("../utils/permissions");
const {
  INVOICE_STATUS,
  PAYMENT_STATUS,
  REFUND_STATUS,
  COMPLAINT_STATUS,
  REQUEST_STATUS,
} = require("../config/constants");
const money = require("../utils/money");

/**
 * Longest period a single report may span.
 *
 * Report aggregations are unbounded scans by nature. Without a ceiling, one
 * request with `from=1970` becomes a full collection scan against a live
 * database, and it is reachable by anyone holding the permission.
 */
const MAX_RANGE_DAYS = 366;

/** Default window when a caller names no period. */
const DEFAULT_RANGE_DAYS = 30;

/**
 * Resolve what a viewer may see.
 *
 * @returns {{scope: "INSTITUTION"|"DEPARTMENT", department: string|null, institutionWide: boolean}}
 */
function resolveScope(user) {
  if (userHasPermission(user, P.REPORT_READ_INSTITUTION)) {
    return { scope: "INSTITUTION", department: null, institutionWide: true };
  }

  if (userHasPermission(user, P.REPORT_READ_DEPARTMENT)) {
    return {
      scope: "DEPARTMENT",
      department: user.department ? user.department.toString() : null,
      institutionWide: false,
    };
  }

  throw ApiError.forbidden("You do not have permission to view reports");
}

/**
 * Normalise and bound a requested period.
 *
 * Always returns both ends, so no aggregation is ever left unbounded.
 */
function resolveRange({ from, to } = {}) {
  const end = to ? new Date(to) : new Date();
  const start = from
    ? new Date(from)
    : new Date(end.getTime() - DEFAULT_RANGE_DAYS * 86400000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw ApiError.badRequest("The report period contains an invalid date");
  }

  if (start > end) {
    throw ApiError.badRequest("The start of the period must not be after its end");
  }

  const days = (end - start) / 86400000;
  if (days > MAX_RANGE_DAYS) {
    throw ApiError.badRequest(
      `A report may span at most ${MAX_RANGE_DAYS} days. Requested ${Math.ceil(days)}.`
    );
  }

  return { from: start, to: end, days: Math.ceil(days) };
}

/** Counts documents grouped by a field. */
async function countBy(Model, filter, field) {
  const rows = await Model.aggregate([
    { $match: filter },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  return Object.fromEntries(
    rows.filter((row) => row._id !== null).map((row) => [row._id, row.count])
  );
}

/** Sums an integer money field across documents matching a filter. */
async function sumMoney(Model, filter, field) {
  const [row] = await Model.aggregate([
    { $match: filter },
    { $group: { _id: null, total: { $sum: `$${field}` } } },
  ]);

  // $sum over integers is exact; a missing group yields no row at all.
  return row?.total ?? 0;
}

// ===========================================================================
// Overview
// ===========================================================================

/**
 * Headline counts, limited to what this viewer may see.
 *
 * Sections the viewer is not entitled to are omitted from the response rather
 * than reported as zero.
 */
async function overview({ user, from, to }) {
  const scope = resolveScope(user);
  const period = resolveRange({ from, to });

  const withinPeriod = { createdAt: { $gte: period.from, $lte: period.to } };
  const departmentFilter = scope.department ? { department: scope.department } : {};

  const report = {
    scope: scope.scope,
    period: { from: period.from, to: period.to, days: period.days },
    generatedAt: new Date(),
  };

  // ----- Students: visible at both scopes -----
  const studentFilter = scope.department ? { department: scope.department } : {};

  report.students = {
    total: await Student.countDocuments(studentFilter),
    active: await Student.countDocuments({ ...studentFilter, isActive: true }),
    newInPeriod: await Student.countDocuments({ ...studentFilter, ...withinPeriod }),
  };

  // ----- Requests: visible at both scopes -----
  const requestFilter = { ...departmentFilter, ...withinPeriod };

  report.requests = {
    total: await Request.countDocuments(requestFilter),
    open: await Request.countDocuments({
      ...requestFilter,
      status: {
        $nin: [
          REQUEST_STATUS.COMPLETED,
          REQUEST_STATUS.REJECTED,
          REQUEST_STATUS.CANCELLED,
        ],
      },
    }),
    completed: await Request.countDocuments({
      ...requestFilter,
      status: REQUEST_STATUS.COMPLETED,
    }),
    escalated: await Request.countDocuments({
      ...requestFilter,
      status: REQUEST_STATUS.ESCALATED,
    }),
    byStatus: await countBy(Request, requestFilter, "status"),
  };

  // ----- Certificates: institutional concern -----
  if (scope.institutionWide) {
    report.certificates = {
      total: await Certificate.countDocuments({}),
      byStatus: await countBy(Certificate, {}, "status"),
      newInPeriod: await Certificate.countDocuments(withinPeriod),
    };
  }

  // ----- Complaints: omitted entirely for a department-scoped viewer -----
  // Not zero. They are not entitled to this figure, and a zero would be a
  // statement about grievances they cannot see.
  if (scope.institutionWide) {
    report.complaints = {
      total: await Complaint.countDocuments({}),
      open: await Complaint.countDocuments({
        status: { $nin: [COMPLAINT_STATUS.RESOLVED, COMPLAINT_STATUS.REJECTED] },
      }),
      resolved: await Complaint.countDocuments({ status: COMPLAINT_STATUS.RESOLVED }),
      newInPeriod: await Complaint.countDocuments(withinPeriod),
      byPriority: await countBy(Complaint, {}, "priority"),
    };
  }

  // ----- Finance: institution only -----
  if (scope.institutionWide) {
    const invoiceFilter = { createdAt: { $gte: period.from, $lte: period.to } };

    const invoiced = await sumMoney(Invoice, invoiceFilter, "total");
    const collectedInPeriod = await sumMoney(
      Payment,
      {
        status: PAYMENT_STATUS.PAID,
        verifiedAt: { $gte: period.from, $lte: period.to },
      },
      "capturedAmount"
    );
    const refundedInPeriod = await sumMoney(
      Refund,
      {
        status: REFUND_STATUS.PROCESSED,
        processedAt: { $gte: period.from, $lte: period.to },
      },
      "refundAmount"
    );

    // Outstanding is a standing balance, not a period figure, so it is summed
    // over every invoice rather than those raised in the window.
    const outstanding = await sumMoney(
      Invoice,
      { status: { $ne: INVOICE_STATUS.PAID } },
      "balanceDue"
    );

    report.finance = {
      invoicedInPeriod: invoiced,
      invoicedInPeriodFormatted: money.format(invoiced),
      collectedInPeriod: collectedInPeriod,
      collectedInPeriodFormatted: money.format(collectedInPeriod),
      refundedInPeriod: refundedInPeriod,
      refundedInPeriodFormatted: money.format(refundedInPeriod),
      outstandingTotal: outstanding,
      outstandingTotalFormatted: money.format(outstanding),
      byStatus: await countBy(Invoice, invoiceFilter, "status"),
    };
  }

  return report;
}

// ===========================================================================
// Requests
// ===========================================================================

async function requestsReport({ user, from, to, department }) {
  const scope = resolveScope(user);
  const period = resolveRange({ from, to });

  // A department-scoped viewer cannot widen out of their department by
  // supplying a different one.
  const target = scope.institutionWide
    ? department
      ? { department }
      : {}
    : scope.department
      ? { department: scope.department }
      : null;

  if (target === null) {
    // Department scope with no department: everything is invisible, and saying
    // so plainly is better than returning an empty set that looks like "no
    // requests were made".
    return {
      scope: scope.scope,
      period: { from: period.from, to: period.to, days: period.days },
      available: false,
      reason:
        "Your account has no department set, so departmental reporting cannot be scoped.",
      totals: { total: 0, open: 0, completed: 0, escalated: 0 },
      byStatus: {},
      byType: [],
      byDepartment: [],
    };
  }

  const filter = { ...target, createdAt: { $gte: period.from, $lte: period.to } };

  const [total, open, completed, escalated, byStatus, byType] = await Promise.all([
    Request.countDocuments(filter),
    Request.countDocuments({
      ...filter,
      status: {
        $nin: [
          REQUEST_STATUS.COMPLETED,
          REQUEST_STATUS.REJECTED,
          REQUEST_STATUS.CANCELLED,
        ],
      },
    }),
    Request.countDocuments({ ...filter, status: REQUEST_STATUS.COMPLETED }),
    Request.countDocuments({ ...filter, status: REQUEST_STATUS.ESCALATED }),
    countBy(Request, filter, "status"),
    aggregateBy(Request, filter, "$lookup:requestType"),
  ]);

  // Departmental breakdown is only meaningful to someone who may see more than
  // one department.
  const byDepartment = scope.institutionWide
    ? await aggregateBy(Request, filter, "$group:department")
    : [];

  return {
    scope: scope.scope,
    period: { from: period.from, to: period.to, days: period.days },
    available: true,
    totals: { total, open, completed, escalated },
    byStatus,
    byType,
    byDepartment,
  };
}

/** Small aggregation helper for the two joins the request report needs. */
async function aggregateBy(Model, filter, mode) {
  if (mode === "$lookup:requestType") {
    return Model.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: "requesttypes",
          localField: "requestType",
          foreignField: "_id",
          as: "type",
        },
      },
      { $unwind: { path: "$type", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { name: "$type.name", category: "$type.category" },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 50 },
      {
        $project: {
          _id: 0,
          name: { $ifNull: ["$_id.name", "Unknown"] },
          category: { $ifNull: ["$_id.category", "UNKNOWN"] },
          count: 1,
        },
      },
    ]);
  }

  if (mode === "$group:department") {
    const rows = await Model.aggregate([
      { $match: filter },
      { $group: { _id: "$department", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const departments = await Department.find({
      _id: { $in: rows.map((row) => row._id).filter(Boolean) },
    })
      .select("name code")
      .lean();

    const names = new Map(departments.map((d) => [String(d._id), d]));

    return rows.map((row) => ({
      departmentId: row._id ?? null,
      name: row._id ? (names.get(String(row._id))?.name ?? "Unknown") : "No department",
      count: row.count,
    }));
  }

  return [];
}

// ===========================================================================
// Students
// ===========================================================================

async function studentsReport({ user, from, to, department }) {
  const scope = resolveScope(user);
  const period = resolveRange({ from, to });

  const target = scope.institutionWide
    ? department
      ? { department }
      : {}
    : scope.department
      ? { department: scope.department }
      : null;

  if (target === null) {
    return {
      scope: scope.scope,
      period: { from: period.from, to: period.to, days: period.days },
      available: false,
      reason:
        "Your account has no department set, so departmental reporting cannot be scoped.",
      totals: { total: 0, active: 0, newInPeriod: 0 },
      byDepartment: [],
      byProgram: [],
      byBatchYear: [],
    };
  }

  const filter = { ...target };

  const [total, active, newInPeriod, byDepartment, byProgram, byBatchYear] =
    await Promise.all([
      Student.countDocuments(filter),
      Student.countDocuments({ ...filter, isActive: true }),
      Student.countDocuments({
        ...filter,
        createdAt: { $gte: period.from, $lte: period.to },
      }),
      departmentBreakdown(filter),
      programBreakdown(filter),
      countBy(Student, filter, "batchYear"),
    ]);

  return {
    scope: scope.scope,
    period: { from: period.from, to: period.to, days: period.days },
    available: true,
    totals: { total, active, newInPeriod },
    byDepartment,
    byProgram,
    byBatchYear: Object.entries(byBatchYear)
      .map(([year, count]) => ({ batchYear: year, count }))
      .sort((a, b) => b.batchYear.localeCompare(a.batchYear)),
  };
}

async function departmentBreakdown(filter) {
  const rows = await Student.aggregate([
    { $match: filter },
    { $group: { _id: "$department", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const departments = await Department.find({
    _id: { $in: rows.map((r) => r._id).filter(Boolean) },
  })
    .select("name code")
    .lean();

  const names = new Map(departments.map((d) => [String(d._id), d]));

  return rows.map((row) => ({
    departmentId: row._id ?? null,
    name: row._id ? (names.get(String(row._id))?.name ?? "Unknown") : "No department",
    code: row._id ? (names.get(String(row._id))?.code ?? null) : null,
    count: row.count,
  }));
}

async function programBreakdown(filter) {
  const rows = await Student.aggregate([
    { $match: filter },
    { $group: { _id: "$program", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 50 },
  ]);

  const programs = await Program.find({
    _id: { $in: rows.map((r) => r._id).filter(Boolean) },
  })
    .select("name code level")
    .lean();

  const names = new Map(programs.map((p) => [String(p._id), p]));

  return rows.map((row) => ({
    programId: row._id ?? null,
    name: row._id ? (names.get(String(row._id))?.name ?? "Unknown") : "No programme",
    level: row._id ? (names.get(String(row._id))?.level ?? null) : null,
    count: row.count,
  }));
}

// ===========================================================================
// Complaints — institution scope only
// ===========================================================================

/**
 * Complaint reporting is institution-wide and gated on that scope.
 *
 * A grievance is confidential to the roles that handle it, and there is no
 * departmental dimension to scope to — a department-scoped viewer is refused
 * outright rather than shown a partial figure.
 */
async function complaintsReport({ user, from, to }) {
  const scope = resolveScope(user);

  if (!scope.institutionWide) {
    throw ApiError.forbidden(
      "Complaint reporting is available only with institution-wide access"
    );
  }

  const period = resolveRange({ from, to });
  const filter = { createdAt: { $gte: period.from, $lte: period.to } };

  const [total, byStatus, byPriority] = await Promise.all([
    Complaint.countDocuments(filter),
    countBy(Complaint, filter, "status"),
    countBy(Complaint, filter, "priority"),
  ]);

  // SLA: a complaint is breached when its deadline passed while still open.
  const now = new Date();
  const [openOverdue, resolvedInPeriod, breachedOnResolution] = await Promise.all([
    Complaint.countDocuments({
      status: { $nin: [COMPLAINT_STATUS.RESOLVED, COMPLAINT_STATUS.REJECTED] },
      dueAt: { $ne: null, $lt: now },
    }),
    Complaint.countDocuments({
      ...filter,
      resolvedAt: { $gte: period.from, $lte: period.to },
    }),
    Complaint.countDocuments({
      ...filter,
      resolvedAt: { $ne: null },
      /*
       * `dueAt: { $ne: null }` is load-bearing, not a tidy-up.
       *
       * BSON orders Null below Date, so `$resolvedAt > null` is true for every
       * resolved anonymous grievance — and those have no deadline at all. Left
       * unguarded they were counted as breaches for ever, quietly depressing the
       * on-time rate in a report an administrator trusts.
       */
      dueAt: { $ne: null },
      $expr: { $gt: ["$resolvedAt", "$dueAt"] },
    }),
  ]);

  return {
    scope: scope.scope,
    period: { from: period.from, to: period.to, days: period.days },
    totals: {
      total,
      open: await Complaint.countDocuments({
        status: { $nin: [COMPLAINT_STATUS.RESOLVED, COMPLAINT_STATUS.REJECTED] },
      }),
      openOverdue,
      resolvedInPeriod,
      resolvedLate: breachedOnResolution,
      // A rate, not a sum of money. Null rather than 0 when nothing resolved.
      onTimeRate:
        resolvedInPeriod > 0
          ? Math.round(
              ((resolvedInPeriod - breachedOnResolution) / resolvedInPeriod) * 1000
            ) / 10
          : null,
    },
    byStatus,
    byPriority,
  };
}

// ===========================================================================
// Finance — institution scope only
// ===========================================================================

async function financeReport({ user, from, to }) {
  const scope = resolveScope(user);

  if (!scope.institutionWide) {
    throw ApiError.forbidden(
      "Finance reporting is available only with institution-wide access"
    );
  }

  const period = resolveRange({ from, to });
  const invoiceFilter = { createdAt: { $gte: period.from, $lte: period.to } };

  const [invoiced, collected, refunded, byStatus] = await Promise.all([
    sumMoney(Invoice, invoiceFilter, "total"),
    sumMoney(
      Payment,
      { status: PAYMENT_STATUS.PAID, verifiedAt: { $gte: period.from, $lte: period.to } },
      "capturedAmount"
    ),
    sumMoney(
      Refund,
      {
        status: REFUND_STATUS.PROCESSED,
        processedAt: { $gte: period.from, $lte: period.to },
      },
      "refundAmount"
    ),
    countBy(Invoice, invoiceFilter, "status"),
  ]);

  const outstanding = await sumMoney(
    Invoice,
    { status: { $ne: INVOICE_STATUS.PAID } },
    "balanceDue"
  );

  const invoiceCount = await Invoice.countDocuments(invoiceFilter);
  const paidCount = await Invoice.countDocuments({
    ...invoiceFilter,
    status: INVOICE_STATUS.PAID,
  });

  return {
    scope: scope.scope,
    period: { from: period.from, to: period.to, days: period.days },
    // Every figure is whole paise; the formatted twins are what a client shows.
    totals: {
      invoiced,
      invoicedFormatted: money.format(invoiced),
      collected,
      collectedFormatted: money.format(collected),
      refunded,
      refundedFormatted: money.format(refunded),
      outstandingTotal: outstanding,
      outstandingTotalFormatted: money.format(outstanding),
      // Net of refunds, since refunded money was collected and handed back.
      netCollected: collected - refunded,
      netCollectedFormatted: money.format(collected - refunded),
    },
    invoiceCounts: {
      raised: invoiceCount,
      paid: paidCount,
      unpaid: invoiceCount - paidCount,
      // Null rather than 0 when nothing was raised, so "no data" is not
      // reported as a perfect record.
      collectionRate:
        invoiceCount > 0 ? Math.round((paidCount / invoiceCount) * 1000) / 10 : null,
    },
    byStatus,
  };
}

module.exports = {
  resolveScope,
  resolveRange,
  overview,
  requestsReport,
  studentsReport,
  complaintsReport,
  financeReport,
  countBy,
  sumMoney,
  MAX_RANGE_DAYS,
  DEFAULT_RANGE_DAYS,
};
