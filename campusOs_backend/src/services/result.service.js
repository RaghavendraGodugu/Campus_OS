/**
 * Marks and results.
 *
 * ## Results are derived, exactly like attendance
 *
 * There is no stored total, percentage or grade. Every figure is computed from
 * the marks of a subject's assessment components at read time. A corrected mark
 * therefore cannot leave a stale result behind — which is the only way a
 * transcript can be trusted after a correction.
 *
 * ## Publication is a gate, not a flag
 *
 * A programme's results are released by creating one `ResultRelease` for
 * `{ term, program }`. Students are never returned a result unless that record
 * exists. The service checks it before building the payload, so an unpublished
 * result is invisible by construction rather than by remembering to set a flag.
 *
 * ## Who enters and who releases
 *
 * Faculty enter marks for subjects they teach. A HOD manages their department's
 * components and may release their programmes. The examination office manages
 * and releases institution-wide. The system administrator reads but never
 * writes: platform administration is not academic authority.
 */

const AcademicTerm = require("../models/AcademicTerm");
const Subject = require("../models/Subject");
const Program = require("../models/Program");
const Student = require("../models/Student");
const TimetableEntry = require("../models/TimetableEntry");
const Assessment = require("../models/Assessment");
const AssessmentMark = require("../models/AssessmentMark");
const ResultRelease = require("../models/ResultRelease");

const {
  AUDIT_ACTION,
  ACADEMIC_TERM_STATUS,
  GRADE_SCALE,
} = require("../config/constants");
const { ApiError } = require("../utils/ApiError");
const { P, userHasPermission } = require("../utils/permissions");
const { rosterForSubject } = require("./attendance.service");
const auditService = require("./audit.service");

function percentage(obtained, maxMarks) {
  if (!maxMarks) return null;
  return Math.round((obtained / maxMarks) * 1000) / 10;
}

/**
 * The first grade whose threshold the percentage reaches.
 *
 * A null percentage (no marks) gets a null grade rather than an F: "not marked"
 * and "failed" are different facts, and a transcript must not conflate them.
 */
function gradeFor(value) {
  if (value === null || value === undefined) {
    return { grade: null, points: null, passing: null };
  }

  const row = GRADE_SCALE.find((entry) => value >= entry.min) ?? GRADE_SCALE.at(-1);

  return { grade: row.grade, points: row.points, passing: row.passing };
}

async function resolveTerm(termId) {
  if (termId) {
    const term = await AcademicTerm.findById(termId).lean();
    if (!term) throw ApiError.notFound("Term not found");
    return term;
  }
  return AcademicTerm.findOne({ isCurrent: true }).lean();
}

function presentTerm(term) {
  if (!term) return null;
  return {
    id: String(term._id),
    name: term.name,
    code: term.code,
    academicYear: term.academicYear,
    status: term.status,
    isCurrent: Boolean(term.isCurrent),
  };
}

async function loadSubject(subjectId) {
  const subject = await Subject.findById(subjectId)
    .populate("program", "name code department")
    .populate("department", "name code");

  if (!subject) {
    throw ApiError.notFound("Subject not found");
  }
  return subject;
}

async function teachesSubject(user, subjectId) {
  return Boolean(await TimetableEntry.exists({ subject: subjectId, faculty: user._id }));
}

/** May this caller read marks and results for the subject? */
async function assertCanRead(user, subject) {
  if (userHasPermission(user, P.RESULT_READ_INSTITUTION)) return;

  if (
    userHasPermission(user, P.RESULT_READ_DEPARTMENT) &&
    user.department &&
    String(subject.department._id ?? subject.department) === String(user.department)
  ) {
    return;
  }

  if (
    userHasPermission(user, P.RESULT_READ_OWN) &&
    (await teachesSubject(user, subject._id))
  ) {
    return;
  }

  throw ApiError.forbidden("You cannot read results for this subject");
}

/** May this caller create components and enter marks for the subject? */
async function assertCanManage(user, subject) {
  if (userHasPermission(user, P.RESULT_MANAGE_INSTITUTION)) return;

  if (
    userHasPermission(user, P.RESULT_MANAGE_DEPARTMENT) &&
    user.department &&
    String(subject.department._id ?? subject.department) === String(user.department)
  ) {
    return;
  }

  if (
    userHasPermission(user, P.RESULT_ENTER_OWN) &&
    (await teachesSubject(user, subject._id))
  ) {
    return;
  }

  throw ApiError.forbidden("You cannot manage marks for this subject");
}

async function assessmentsFor(termId, subjectId) {
  return Assessment.find({ term: termId, subject: subjectId, isActive: true })
    .sort({ sequence: 1, name: 1 })
    .lean();
}

async function listAssessments({ user, subjectId, termId }) {
  const subject = await loadSubject(subjectId);
  await assertCanRead(user, subject);

  const term = await resolveTerm(termId);

  return {
    subject: presentSubject(subject),
    term: presentTerm(term),
    assessments: term
      ? (await assessmentsFor(term._id, subject._id)).map(presentAssessment)
      : [],
  };
}

function presentSubject(subject) {
  return {
    id: String(subject._id),
    code: subject.code,
    name: subject.name,
    semester: subject.semester,
    program: subject.program
      ? {
          id: String(subject.program._id ?? subject.program),
          code: subject.program.code,
          name: subject.program.name,
        }
      : null,
    department: subject.department
      ? {
          id: String(subject.department._id ?? subject.department),
          name: subject.department.name,
        }
      : null,
  };
}

function presentAssessment(assessment) {
  return {
    id: String(assessment._id),
    name: assessment.name,
    kind: assessment.kind,
    maxMarks: assessment.maxMarks,
    sequence: assessment.sequence,
  };
}

async function createAssessment({ user, payload, req }) {
  const subject = await loadSubject(payload.subject);
  await assertCanManage(user, subject);

  const term = await AcademicTerm.findById(payload.term);
  if (!term) throw ApiError.notFound("Term not found");
  if (term.status === ACADEMIC_TERM_STATUS.CLOSED) {
    throw ApiError.badRequest("That term is closed; components cannot be added to it");
  }

  const existing = await Assessment.findOne({
    term: term._id,
    subject: subject._id,
    name: payload.name,
  }).select("_id");
  if (existing) {
    throw ApiError.conflict(
      "That subject already has a component with that name in this term"
    );
  }

  const assessment = await Assessment.create({
    ...payload,
    createdBy: user._id,
  });

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ASSESSMENT_CREATED,
    entity: "Assessment",
    entityId: assessment._id,
    entityRef: `${subject.code} ${assessment.name}`,
    metadata: {
      subject: String(subject._id),
      term: String(term._id),
      maxMarks: assessment.maxMarks,
      kind: assessment.kind,
    },
    req,
  });

  return presentAssessment(assessment.toObject());
}

async function removeAssessment({ user, id, req }) {
  const assessment = await Assessment.findById(id);
  if (!assessment) throw ApiError.notFound("Component not found");

  const subject = await loadSubject(assessment.subject);
  await assertCanManage(user, subject);

  const marks = await AssessmentMark.countDocuments({ assessment: assessment._id });
  if (marks > 0) {
    throw ApiError.conflict(
      "This component already has marks. Remove the marks before deleting it."
    );
  }

  assessment.isActive = false;
  await assessment.save();

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.ASSESSMENT_DELETED,
    entity: "Assessment",
    entityId: assessment._id,
    entityRef: `${subject.code} ${assessment.name}`,
    metadata: { subject: String(subject._id), maxMarks: assessment.maxMarks },
    req,
  });

  return { removed: true };
}

/**
 * Compute one subject's results from components and marks.
 *
 * `complete` is false when any component is missing a mark. Partial results are
 * still returned to staff (so they can see what is outstanding) but they are
 * never published — `publish` refuses while any mark is missing.
 */
function computeResults({ assessments, marks, roster }) {
  const byKey = new Map(
    marks.map((mark) => [`${mark.assessment}:${mark.student}`, mark.marksObtained])
  );

  return roster.map((student) => {
    let obtained = 0;
    let maxMarks = 0;
    let complete = true;

    const components = assessments.map((assessment) => {
      const value = byKey.get(`${assessment._id}:${student.studentId}`);
      maxMarks += assessment.maxMarks;

      if (value === undefined) {
        complete = false;
        return {
          assessmentId: String(assessment._id),
          name: assessment.name,
          kind: assessment.kind,
          maxMarks: assessment.maxMarks,
          marksObtained: null,
        };
      }

      obtained += value;
      return {
        assessmentId: String(assessment._id),
        name: assessment.name,
        kind: assessment.kind,
        maxMarks: assessment.maxMarks,
        marksObtained: value,
      };
    });

    const pct = percentage(obtained, maxMarks);
    const grade = gradeFor(pct);

    return {
      studentId: student.studentId,
      rollNumber: student.rollNumber,
      name: student.name,
      section: student.section ?? null,
      components,
      obtained,
      maxMarks,
      percentage: pct,
      complete,
      ...grade,
      status: grade.passing === null ? "UNMARKED" : grade.passing ? "PASS" : "FAIL",
    };
  });
}

async function marksGrid({ user, subjectId, termId }) {
  const subject = await loadSubject(subjectId);
  await assertCanRead(user, subject);

  const term = await resolveTerm(termId);
  if (!term) {
    return {
      subject: presentSubject(subject),
      term: null,
      assessments: [],
      students: [],
      canManage: false,
    };
  }

  const [assessments, roster] = await Promise.all([
    assessmentsFor(term._id, subject._id),
    rosterForSubject(subject),
  ]);

  const marks = assessments.length
    ? await AssessmentMark.find({
        term: term._id,
        subject: subject._id,
        assessment: { $in: assessments.map((assessment) => assessment._id) },
      })
        .select("assessment student marksObtained")
        .lean()
    : [];

  const canManage = await canManageSubject(user, subject);

  return {
    subject: presentSubject(subject),
    term: presentTerm(term),
    assessments: assessments.map(presentAssessment),
    students: computeResults({ assessments, marks, roster }),
    canManage,
  };
}

async function canManageSubject(user, subject) {
  try {
    await assertCanManage(user, subject);
    return true;
  } catch {
    return false;
  }
}

/**
 * Enter or update marks for one component.
 *
 * Partial saves are allowed: a teacher may enter a lab batch at a time. What is
 * not allowed is a mark above the component's maximum, or a student who is not
 * in the class. Publication is what requires completeness, not saving.
 */
async function saveMarks({ user, payload, req }) {
  const assessment = await Assessment.findById(payload.assessment);
  if (!assessment || !assessment.isActive) {
    throw ApiError.notFound("Component not found");
  }

  const subject = await loadSubject(assessment.subject);
  await assertCanManage(user, subject);

  const term = await AcademicTerm.findById(assessment.term).select("status");
  if (term?.status === ACADEMIC_TERM_STATUS.CLOSED) {
    throw ApiError.badRequest("That term is closed; marks cannot be changed");
  }

  const roster = await rosterForSubject(subject);
  const rosterIds = new Set(roster.map((student) => student.studentId));

  for (const mark of payload.marks) {
    if (!rosterIds.has(String(mark.student))) {
      throw ApiError.badRequest(
        "One or more students are not in this class. Reload the marks sheet and try again."
      );
    }
    if (mark.marksObtained > assessment.maxMarks) {
      throw ApiError.badRequest(
        `Marks cannot exceed the maximum of ${assessment.maxMarks} for ${assessment.name}`
      );
    }
  }

  await AssessmentMark.bulkWrite(
    payload.marks.map((mark) => ({
      updateOne: {
        filter: { assessment: assessment._id, student: mark.student },
        update: {
          $set: {
            subject: subject._id,
            term: assessment.term,
            marksObtained: mark.marksObtained,
            enteredBy: user._id,
          },
        },
        upsert: true,
      },
    }))
  );

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.MARKS_ENTERED,
    entity: "Assessment",
    entityId: assessment._id,
    entityRef: `${subject.code} ${assessment.name}`,
    metadata: {
      subject: String(subject._id),
      term: String(assessment.term),
      count: payload.marks.length,
    },
    req,
  });

  return marksGrid({ user, subjectId: subject._id, termId: assessment.term });
}

/**
 * Release a programme's results for a term.
 *
 * Completeness is checked first: every active component of every subject in the
 * programme must have a mark for every student on that subject's roster. A
 * result released with a hole in it is a result the college cannot defend, and
 * the error names how many marks are outstanding rather than silently treating
 * them as zero.
 */
async function publish({ user, payload, req }) {
  const term = await AcademicTerm.findById(payload.term);
  if (!term) throw ApiError.notFound("Term not found");

  const program = await Program.findById(payload.program).select("name code department");
  if (!program) throw ApiError.notFound("Programme not found");

  const departmentId = String(program.department);

  const canPublish =
    userHasPermission(user, P.RESULT_PUBLISH_INSTITUTION) ||
    (userHasPermission(user, P.RESULT_PUBLISH_DEPARTMENT) &&
      user.department &&
      String(user.department) === departmentId);

  if (!canPublish) {
    throw ApiError.forbidden("You cannot release results for this programme");
  }

  const subjects = await Subject.find({ program: program._id })
    .select("code name program semester department")
    .lean();

  const assessments = await Assessment.find({
    term: term._id,
    subject: { $in: subjects.map((subject) => subject._id) },
    isActive: true,
  })
    .select("_id subject maxMarks name")
    .lean();

  if (assessments.length === 0) {
    throw ApiError.badRequest(
      "No assessment components exist for this programme in this term. There is nothing to release."
    );
  }

  const marks = await AssessmentMark.find({
    term: term._id,
    assessment: { $in: assessments.map((assessment) => assessment._id) },
  })
    .select("assessment student")
    .lean();

  const markSet = new Set(marks.map((mark) => `${mark.assessment}:${mark.student}`));

  const subjectById = new Map(subjects.map((subject) => [String(subject._id), subject]));
  let missing = 0;

  for (const assessment of assessments) {
    const subject = subjectById.get(String(assessment.subject));
    if (!subject) continue;

    const roster = await rosterForSubject(subject);
    for (const student of roster) {
      if (!markSet.has(`${assessment._id}:${student.studentId}`)) {
        missing += 1;
      }
    }
  }

  if (missing > 0) {
    throw ApiError.badRequest(
      `${missing} mark${missing === 1 ? "" : "s"} are still missing. Every student needs a mark for every component before results can be released.`
    );
  }

  const existing = await ResultRelease.findOne({
    term: term._id,
    program: program._id,
  });

  if (existing) {
    return {
      release: presentRelease(existing, program),
      alreadyPublished: true,
    };
  }

  const release = await ResultRelease.create({
    term: term._id,
    program: program._id,
    publishedBy: user._id,
    publishedAt: new Date(),
  });

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.RESULTS_PUBLISHED,
    entity: "ResultRelease",
    entityId: release._id,
    entityRef: `${program.code} ${term.code}`,
    metadata: {
      term: String(term._id),
      program: String(program._id),
      assessments: assessments.length,
      marks: marks.length,
    },
    req,
  });

  return { release: presentRelease(release, program), alreadyPublished: false };
}

function presentRelease(release, program) {
  return {
    id: String(release._id),
    program: { id: String(program._id), code: program.code, name: program.name },
    publishedAt: release.publishedAt,
  };
}

async function listReleases({ user, termId }) {
  const term = await resolveTerm(termId);
  if (!term) return [];

  const releases = await ResultRelease.find({ term: term._id })
    .populate("program", "name code department")
    .sort({ publishedAt: -1 })
    .lean();

  if (!userHasPermission(user, P.RESULT_READ_INSTITUTION)) {
    if (!userHasPermission(user, P.RESULT_READ_DEPARTMENT) || !user.department) {
      throw ApiError.forbidden("You cannot read result releases");
    }
    return releases
      .filter(
        (release) =>
          release.program &&
          String(release.program.department) === String(user.department)
      )
      .map((release) => ({
        id: String(release._id),
        program: {
          id: String(release.program._id),
          code: release.program.code,
          name: release.program.name,
        },
        publishedAt: release.publishedAt,
      }));
  }

  return releases.map((release) => ({
    id: String(release._id),
    program: {
      id: String(release.program._id),
      code: release.program.code,
      name: release.program.name,
    },
    publishedAt: release.publishedAt,
  }));
}

/**
 * A student's released results.
 *
 * Without a release, this returns `{ published: false, results: [] }` — not an
 * error and not a redacted result. The UI shows "not released yet", which is
 * the truthful answer.
 */
async function studentResults({ user, termId }) {
  const student = await Student.findOne({ user: user._id })
    .select("program semester rollNumber")
    .lean();

  if (!student) {
    throw ApiError.forbidden("No student record is linked to this account");
  }

  const term = await resolveTerm(termId);
  if (!term) {
    return {
      published: false,
      term: null,
      release: null,
      results: [],
      overall: null,
      arrears: [],
    };
  }

  const release = await ResultRelease.findOne({
    term: term._id,
    program: student.program,
  }).lean();

  if (!release) {
    return {
      published: false,
      term: presentTerm(term),
      release: null,
      results: [],
      overall: null,
      arrears: [],
    };
  }

  const subjects = await Subject.find({
    program: student.program,
    semester: student.semester,
    isActive: true,
  })
    .select("code name credits semester")
    .lean();

  const assessments = await Assessment.find({
    term: term._id,
    subject: { $in: subjects.map((subject) => subject._id) },
    isActive: true,
  })
    .select("_id subject name kind maxMarks sequence")
    .sort({ sequence: 1, name: 1 })
    .lean();

  const marks = await AssessmentMark.find({
    term: term._id,
    student: student._id,
    assessment: { $in: assessments.map((assessment) => assessment._id) },
  })
    .select("assessment marksObtained")
    .lean();

  const markByAssessment = new Map(
    marks.map((mark) => [String(mark.assessment), mark.marksObtained])
  );

  const results = [];
  let totalObtained = 0;
  let totalMax = 0;

  for (const subject of subjects) {
    const components = assessments.filter(
      (assessment) => String(assessment.subject) === String(subject._id)
    );

    if (components.length === 0) continue;

    let obtained = 0;
    let maxMarks = 0;
    let complete = true;

    const detail = components.map((assessment) => {
      maxMarks += assessment.maxMarks;
      const value = markByAssessment.get(String(assessment._id));
      if (value === undefined) {
        complete = false;
        return {
          assessmentId: String(assessment._id),
          name: assessment.name,
          kind: assessment.kind,
          maxMarks: assessment.maxMarks,
          marksObtained: null,
        };
      }
      obtained += value;
      return {
        assessmentId: String(assessment._id),
        name: assessment.name,
        kind: assessment.kind,
        maxMarks: assessment.maxMarks,
        marksObtained: value,
      };
    });

    const pct = percentage(obtained, maxMarks);
    const grade = gradeFor(pct);

    totalObtained += obtained;
    totalMax += maxMarks;

    results.push({
      subject: {
        id: String(subject._id),
        code: subject.code,
        name: subject.name,
        credits: subject.credits,
      },
      components: detail,
      obtained,
      maxMarks,
      percentage: pct,
      complete,
      ...grade,
      status: grade.passing === null ? "UNMARKED" : grade.passing ? "PASS" : "FAIL",
    });
  }

  const overallPct = percentage(totalObtained, totalMax);
  const overallGrade = gradeFor(overallPct);

  return {
    published: true,
    term: presentTerm(term),
    release: { publishedAt: release.publishedAt },
    results: results.sort((a, b) => a.subject.code.localeCompare(b.subject.code)),
    overall:
      totalMax > 0
        ? {
            obtained: totalObtained,
            maxMarks: totalMax,
            percentage: overallPct,
            ...overallGrade,
          }
        : null,
    arrears: results
      .filter((result) => result.status === "FAIL")
      .map((result) => result.subject),
  };
}

module.exports = {
  listAssessments,
  createAssessment,
  removeAssessment,
  marksGrid,
  saveMarks,
  publish,
  listReleases,
  studentResults,
  gradeFor,
  percentage,
};
