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

      // Counted *before* the save, not after. Setting `term.counts` on a
      // document that has already been written changes nothing in the database:
      // `open()` was persisting a term with no counts while `close()` — which
      // recounts first — stored them. The audit entry showed the real numbers
      // and the record disagreed with itself.
      await recountCounts(term);

      await term.save({ session });
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

/**
 * Prepare the next academic year by cloning the current year's term structure.
 *
 * Given an academic year like "2026-27", this finds all terms in that year and
 * creates corresponding terms for the next year (e.g., "2027-28") with the same
 * kinds, names (year suffix adjusted), codes (year suffix adjusted), and
 * relative date offsets. The new terms are created in PLANNED status, not open.
 *
 * The caller chooses the start date for the first term of the next year; the
 * rest follow the same duration and gap pattern as the source year.
 */
async function prepareNextYear({ user, currentYear, nextYearStart, req }) {
  if (!/^\d{4}(-\d{2,4})?$/.test(currentYear)) {
    throw ApiError.badRequest("currentYear must look like 2026-27");
  }
  if (!(nextYearStart instanceof Date) && isNaN(Date.parse(nextYearStart))) {
    throw ApiError.badRequest("nextYearStart must be a valid date");
  }

  const terms = await AcademicTerm.find({ academicYear: currentYear })
    .sort({ startsOn: 1 })
    .lean();

  if (terms.length === 0) {
    throw ApiError.notFound(`No terms found for academic year ${currentYear}`);
  }

  // Determine the next academic year string
  const nextYear = (() => {
    if (currentYear.includes("-")) {
      const [start, end] = currentYear.split("-").map(Number);
      return `${start + 1}-${String(end + 1).slice(-2)}`;
    }
    const year = Number(currentYear);
    return `${year + 1}-${String(year + 2).slice(-2)}`;
  })();

  // Check if next year already has terms
  const existing = await AcademicTerm.find({ academicYear: nextYear }).countDocuments();
  if (existing > 0) {
    throw ApiError.conflict(`Academic year ${nextYear} already has ${existing} term(s)`);
  }

  // Calculate the offset from the first term's start to the chosen next year start
  const firstStart = new Date(terms[0].startsOn);
  const offsetMs = new Date(nextYearStart).getTime() - firstStart.getTime();

  const created = [];
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const term of terms) {
        const newStartsOn = new Date(new Date(term.startsOn).getTime() + offsetMs);
        const newEndsOn = new Date(new Date(term.endsOn).getTime() + offsetMs);

        // Adjust name and code by replacing the year portion.
        // The academic year "2026-27" means terms span 2026 and 2027.
        // Term names typically contain one of those years (e.g., "Autumn 2026",
        // "Spring 2027"). Codes often have a 2-digit suffix (e.g., "A26", "S27").
        // We increment any 4-digit year in the name, and any 2-digit year suffix in the code.
        const [currStart, currEnd] = currentYear
          .split("-")
          .map((y) => (y.length === 4 ? Number(y) : Number("20" + y)));
        const nextStart = currStart + 1;
        const nextEnd = currEnd + 1;

        const newName = term.name.replace(/\b\d{4}\b/g, (match) => {
          const year = Number(match);
          if (year === currStart) return String(nextStart);
          if (year === currEnd) return String(nextEnd);
          // If the year doesn't match either, increment anyway (fallback)
          return String(year + 1);
        });
        const newCode = term.code.replace(/\d{2}$/, (match) => {
          const year2 = Number(match);
          if (year2 === currStart % 100) return String(nextStart % 100).padStart(2, "0");
          if (year2 === currEnd % 100) return String(nextEnd % 100).padStart(2, "0");
          return String((year2 + 1) % 100).padStart(2, "0");
        });

        const newTerm = await AcademicTerm.create(
          [
            {
              name: newName,
              code: newCode,
              kind: term.kind,
              academicYear: nextYear,
              startsOn: newStartsOn,
              endsOn: newEndsOn,
              status: ACADEMIC_TERM_STATUS.PLANNED,
              isCurrent: false,
              notes: term.notes,
            },
          ],
          { session }
        );

        created.push(newTerm[0].toJSON());
      }
    });
  } finally {
    await session.endSession();
  }

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ACADEMIC_TERM_ROLLOVER_PREPARED,
    entity: "AcademicTerm",
    entityRef: nextYear,
    metadata: { fromYear: currentYear, toYear: nextYear, termsCreated: created.length },
    req,
  });

  logger.info(
    { userId: user._id, fromYear: currentYear, toYear: nextYear },
    "Next academic year prepared"
  );
  return created;
}

/**
 * Automatic rollover check.
 *
 * Runs daily (from cron or an external scheduler). If the current term has
 * ended and there is a PLANNED term for the next period (same academic year
 * or next), it closes the current and opens the next. This is the "set and
 * forget" automation for colleges that want terms to roll over on their dates.
 */
async function autoRolloverCheck({ req }) {
  const current = await AcademicTerm.findOne({ isCurrent: true });
  if (!current) {
    return { action: "none", reason: "no current term" };
  }

  const now = new Date();
  if (new Date(current.endsOn) > now) {
    return { action: "none", reason: "current term has not ended yet" };
  }

  // Find a candidate next term: PLANNED, same or next academic year, starts after current ends
  const nextYear = (() => {
    if (current.academicYear.includes("-")) {
      const [start, end] = current.academicYear.split("-").map(Number);
      return `${start + 1}-${String(end + 1).slice(-2)}`;
    }
    const year = Number(current.academicYear);
    return `${year + 1}-${String(year + 2).slice(-2)}`;
  })();

  const candidate = await AcademicTerm.findOne({
    status: ACADEMIC_TERM_STATUS.PLANNED,
    academicYear: { $in: [current.academicYear, nextYear] },
    startsOn: { $gte: new Date(current.endsOn) },
  }).sort({ startsOn: 1 });

  if (!candidate) {
    return { action: "none", reason: "no planned next term found" };
  }

  // Use the existing open() which closes current and opens candidate in one transaction
  // We need a system user for this - but the audit expects an actor. We'll use the
  // first SUPER_ADMIN we find, or throw if none.
  const User = mongoose.model("User");
  const systemUser = await User.findOne({ role: "SUPER_ADMIN" }).select("_id");
  if (!systemUser) {
    throw ApiError.conflict("No SUPER_ADMIN exists to perform automatic rollover");
  }

  const opened = await open({ user: systemUser, id: candidate._id, req });

  await auditService.record({
    actor: systemUser,
    action: AUDIT_ACTION.ACADEMIC_TERM_AUTO_ROLLOVER,
    entity: "AcademicTerm",
    entityId: opened._id,
    entityRef: opened.code,
    metadata: { previousTerm: current.code, rolledOverAt: now.toISOString() },
    req,
  });

  return { action: "rolled_over", previous: current.code, opened: opened.code };
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
  prepareNextYear,
  autoRolloverCheck,
};
