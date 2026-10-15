/**
 * Academic terms.
 *
 * ## The whole point: a figure belongs to a named term
 *
 * Without terms, "how many certificates did we issue this semester?" can only be
 * answered by a date range somebody typed. Two people typing "this semester"
 * produce two answers and neither can be shown to be right.
 *
 * With terms the answer is a record. Reports name the term they cover, exports
 * carry the term's name, and last term's total cannot be presented as this
 * term's by accident.
 *
 * ## Opening a term is the only step that touches other collections
 *
 * Everything else here is bookkeeping. `openTerm` is different: it closes the
 * current term and marks this one current, and it has to be one atomic step. Two
 * administrators clicking "open" at once would otherwise leave two terms marked
 * current, and every downstream figure would be ambiguous.
 *
 * The unique partial index on `isCurrent` is the real guard — application code
 * that checks-then-writes races with itself — but the transaction means a
 * failure part-way leaves the previous term still open, rather than none.
 */

const mongoose = require("mongoose");

const AcademicTerm = require("../models/AcademicTerm");
const { ACADEMIC_TERM_STATUS, AUDIT_ACTION } = require("../config/constants");
const { ApiError } = require("../utils/ApiError");
const auditService = require("./audit.service");
const { logger } = require("../config/logger");

/** Every term, newest first. */
async function list() {
  return AcademicTerm.find().sort({ startsOn: -1 }).lean();
}

/**
 * The term new records belong to.
 *
 * Null is a real answer, not a failure: a college that has not yet opened its
 * term can still read, export and audit. It simply cannot raise a fee against a
 * term that does not exist.
 */
async function current() {
  return AcademicTerm.findOne({ isCurrent: true }).lean();
}

async function getById(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound("Term not found");
  }
  const term = await AcademicTerm.findById(id).lean();
  if (!term) {
    throw ApiError.notFound("Term not found");
  }
  return term;
}

async function getByCode(code) {
  const term = await AcademicTerm.findOne({
    code: String(code ?? "")
      .trim()
      .toUpperCase(),
  }).lean();
  if (!term) {
    throw ApiError.notFound("Term not found");
  }
  return term;
}

/** Counters refreshed from the collections a term covers. */
async function recountCounts(term) {
  const [students, invoices, certificates, requests] = await Promise.all([
    mongoose.model("Student").countDocuments({ academicYear: term.academicYear }),
    mongoose
      .model("Invoice")
      .countDocuments({ createdAt: { $gte: term.startsOn, $lte: term.endsOn } }),
    mongoose.model("Certificate").countDocuments({
      createdAt: { $gte: term.startsOn, $lte: term.endsOn },
    }),
    mongoose.model("Request").countDocuments({
      createdAt: { $gte: term.startsOn, $lte: term.endsOn },
    }),
  ]);

  term.counts = { students, invoices, certificates, requests };
  return term.counts;
}

/**
 * Create a term.
 *
 * Creating never opens it. A term typed up in June for a semester starting in
 * July should not start accepting fees because someone saved the form.
 */
async function create({ user, payload }) {
  const existing = await AcademicTerm.findOne({
    $or: [{ code: payload.code }, { name: payload.name }],
  });
  if (existing) {
    throw ApiError.conflict(
      `A term already exists with that ${existing.code === payload.code ? "code" : "name"}`
    );
  }

  const term = await AcademicTerm.create({ ...payload, isCurrent: false });

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ACADEMIC_TERM_CREATED,
    entity: "AcademicTerm",
    entityId: term._id,
    entityRef: term.code,
    // The dates are not sensitive, but the name and code are what a later
    // report cites, so they are recorded.
    metadata: { name: term.name, code: term.code, academicYear: term.academicYear },
    req: arguments[0]?.req,
  });

  logger.info({ termId: term._id, userId: user._id }, "Academic term created");
  return term.toJSON();
}

async function update({ user, id, payload, req }) {
  const term = await AcademicTerm.findById(id);
  if (!term) {
    throw ApiError.notFound("Term not found");
  }

  // A closed term is a historical record. Editing its dates afterwards would
  // move the window that every figure ever reported against it was measured in.
  if (
    term.status === ACADEMIC_TERM_STATUS.CLOSED &&
    (payload.startsOn || payload.endsOn)
  ) {
    throw ApiError.conflict(
      "A closed term's dates cannot be changed — its figures were measured against them"
    );
  }

  const merged = {
    name: payload.name ?? term.name,
    startsOn: payload.startsOn ?? term.startsOn,
    endsOn: payload.endsOn ?? term.endsOn,
  };

  if (new Date(merged.endsOn) <= new Date(merged.startsOn)) {
    throw ApiError.badRequest("The term's end date must be after its start date");
  }

  Object.assign(term, payload);
  await term.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ACADEMIC_TERM_UPDATED,
    entity: "AcademicTerm",
    entityId: term._id,
    entityRef: term.code,
    metadata: { changed: Object.keys(payload) },
    req,
  });

  return term.toJSON();
}

/**
 * Open a term, closing whichever was open before it.
 *
 * One transaction, because leaving zero current terms is worse than leaving the
 * wrong one: every form that asks which term it belongs to would have nothing to
 * offer.
 */
async function open({ user, id, req }) {
  const session = await mongoose.startSession();
  let opened;

  try {
    await session.withTransaction(async () => {
      const term = await AcademicTerm.findOne({ _id: id }).session(session);
      if (!term) {
        throw ApiError.notFound("Term not found");
      }

      if (term.isCurrent && term.status === ACADEMIC_TERM_STATUS.OPEN) {
        throw ApiError.conflict("That term is already open");
      }

      const previous = await AcademicTerm.findOne({ isCurrent: true }).session(session);

      if (previous) {
        previous.isCurrent = false;
        if (previous.status === ACADEMIC_TERM_STATUS.OPEN) {
          previous.status = ACADEMIC_TERM_STATUS.CLOSED;
          previous.closedAt = new Date();
          previous.closedBy = user._id;
        }
        await previous.save({ session });
      }

      term.isCurrent = true;
      term.status = ACADEMIC_TERM_STATUS.OPEN;
      term.openedAt = new Date();
      term.openedBy = user._id;
      await term.save({ session });

      await recountCounts(term);
      opened = term.toJSON();
    });
  } finally {
    await session.endSession();
  }

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ACADEMIC_TERM_OPENED,
    entity: "AcademicTerm",
    entityId: opened._id,
    entityRef: opened.code,
    metadata: { name: opened.name, counts: opened.counts },
    req,
  });

  logger.info({ termId: opened._id, userId: user._id }, "Academic term opened");
  return opened;
}

/**
 * Close a term without opening another.
 *
 * A distinct action from `open`, because "we are between terms" is a real state:
 * closing the last term outright would leave the college with no current term,
 * which is different from having closed one and opened its replacement.
 */
async function close({ user, id, req }) {
  const term = await AcademicTerm.findById(id);
  if (!term) {
    throw ApiError.notFound("Term not found");
  }
  if (term.status === ACADEMIC_TERM_STATUS.CLOSED) {
    throw ApiError.conflict("That term is already closed");
  }

  term.isCurrent = false;
  term.status = ACADEMIC_TERM_STATUS.CLOSED;
  term.closedAt = new Date();
  term.closedBy = user._id;

  await recountCounts(term);
  await term.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ACADEMIC_TERM_CLOSED,
    entity: "AcademicTerm",
    entityId: term._id,
    entityRef: term.code,
    metadata: { name: term.name, counts: term.counts },
    req,
  });

  return term.toJSON();
}

/** A term with no open replacement cannot be deleted. */
async function remove({ user, id, req }) {
  const term = await AcademicTerm.findById(id);
  if (!term) {
    throw ApiError.notFound("Term not found");
  }

  if (term.isCurrent) {
    throw ApiError.conflict("Close the term before deleting it");
  }

  await AcademicTerm.deleteOne({ _id: term._id });

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ACADEMIC_TERM_DELETED,
    entity: "AcademicTerm",
    entityRef: term.code,
    metadata: { name: term.name },
    req,
  });

  return true;
}

module.exports = {
  list,
  current,
  getById,
  getByCode,
  create,
  update,
  open,
  close,
  remove,
  recountCounts,
};
