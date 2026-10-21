/**
 * Campus analytics.
 *
 * ## Sections are omitted, not zeroed
 *
 * A warden has no business reading library circulation, and a librarian has no
 * business reading hostel occupancy. The response therefore contains only the
 * sections the caller may read — the same rule the dashboards follow. A zero
 * would be a claim they are entitled to see, which is why it is not used.
 *
 * ## Figures are aggregates, not stored counters
 *
 * Occupancy is active allocations against total capacity; loans are issues in
 * a status; attendance is the same records-derived arithmetic used elsewhere.
 * Nothing here introduces a second source of truth.
 */
const Hostel = require("../models/Hostel");
const HostelRoom = require("../models/HostelRoom");
const HostelAllocation = require("../models/HostelAllocation");
const HostelLeave = require("../models/HostelLeave");
const Book = require("../models/Book");
const BookIssue = require("../models/BookIssue");
const Company = require("../models/Company");
const PlacementDrive = require("../models/PlacementDrive");
const PlacementApplication = require("../models/PlacementApplication");
const AttendanceSession = require("../models/AttendanceSession");
const Assessment = require("../models/Assessment");
const AssessmentMark = require("../models/AssessmentMark");
const ResultRelease = require("../models/ResultRelease");
const AcademicTerm = require("../models/AcademicTerm");

const {
  ATTENDED_STATUSES,
  BOOK_ISSUE_STATUS,
  HOSTEL_ALLOCATION_STATUS,
  HOSTEL_LEAVE_STATUS,
  PLACEMENT_APPLICATION_STATUS,
  PLACEMENT_DRIVE_STATUS,
} = require("../config/constants");
const { P, userHasPermission } = require("../utils/permissions");

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

function pct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

async function hostelSection() {
  const [hostels, rooms, occupied, pendingLeaves] = await Promise.all([
    Hostel.countDocuments({ isActive: true }),
    HostelRoom.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, rooms: { $sum: 1 }, beds: { $sum: "$capacity" } } },
    ]),
    HostelAllocation.countDocuments({ status: HOSTEL_ALLOCATION_STATUS.ACTIVE }),
    HostelLeave.countDocuments({ status: HOSTEL_LEAVE_STATUS.PENDING }),
  ]);

  const roomStats = rooms[0] ?? { rooms: 0, beds: 0 };

  return {
    blocks: hostels,
    rooms: roomStats.rooms,
    beds: roomStats.beds,
    occupied,
    occupancyPercentage: pct(occupied, roomStats.beds),
    pendingLeaves,
  };
}

async function librarySection() {
  const [titles, copies] = await Promise.all([
    Book.countDocuments({ isActive: true }),
    Book.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          total: { $sum: "$copiesTotal" },
          issued: { $sum: "$copiesIssued" },
        },
      },
    ]),
  ]);

  const copyStats = copies[0] ?? { total: 0, issued: 0 };
  const since = new Date(Date.now() - THIRTY_DAYS);

  const [onLoan, overdue, recentLoans] = await Promise.all([
    BookIssue.countDocuments({ status: BOOK_ISSUE_STATUS.ISSUED }),
    BookIssue.countDocuments({
      status: BOOK_ISSUE_STATUS.ISSUED,
      dueAt: { $lt: new Date() },
    }),
    BookIssue.countDocuments({ issuedAt: { $gte: since } }),
  ]);

  return {
    titles,
    copies: copyStats.total,
    onLoan,
    available: Math.max(0, copyStats.total - copyStats.issued),
    overdue,
    loansLast30Days: recentLoans,
  };
}

async function placementSection() {
  const [drives, applications] = await Promise.all([
    PlacementDrive.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    PlacementApplication.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  const driveCounts = Object.fromEntries(drives.map((row) => [row._id, row.count]));
  const applicationCounts = Object.fromEntries(
    applications.map((row) => [row._id, row.count])
  );

  const totalApplications = applications.reduce((sum, row) => sum + row.count, 0);
  const selected = applicationCounts[PLACEMENT_APPLICATION_STATUS.SELECTED] ?? 0;

  return {
    companies: await Company.countDocuments({ isActive: true }),
    drives: {
      draft: driveCounts[PLACEMENT_DRIVE_STATUS.DRAFT] ?? 0,
      open: driveCounts[PLACEMENT_DRIVE_STATUS.OPEN] ?? 0,
      closed: driveCounts[PLACEMENT_DRIVE_STATUS.CLOSED] ?? 0,
      total: drives.reduce((sum, row) => sum + row.count, 0),
    },
    applications: {
      total: totalApplications,
      applied: applicationCounts[PLACEMENT_APPLICATION_STATUS.APPLIED] ?? 0,
      shortlisted: applicationCounts[PLACEMENT_APPLICATION_STATUS.SHORTLISTED] ?? 0,
      selected,
      rejected: applicationCounts[PLACEMENT_APPLICATION_STATUS.REJECTED] ?? 0,
      withdrawn: applicationCounts[PLACEMENT_APPLICATION_STATUS.WITHDRAWN] ?? 0,
    },
    selectionPercentage: pct(selected, totalApplications),
  };
}

async function academicSection() {
  const term = await AcademicTerm.findOne({ isCurrent: true }).lean();

  if (!term) {
    return {
      term: null,
      sessions: 0,
      marks: 0,
      averageAttendance: null,
      resultsReleased: 0,
      assessments: 0,
    };
  }

  const [sessions, attendance, resultsReleased, assessments, marksEntered] =
    await Promise.all([
      AttendanceSession.countDocuments({ term: term._id }),
      AttendanceSession.aggregate([
        { $match: { term: term._id } },
        { $unwind: "$records" },
        {
          $group: {
            _id: null,
            marks: { $sum: 1 },
            attended: {
              $sum: { $cond: [{ $in: ["$records.status", ATTENDED_STATUSES] }, 1, 0] },
            },
          },
        },
      ]),
      ResultRelease.countDocuments({ term: term._id }),
      Assessment.countDocuments({ term: term._id, isActive: true }),
      AssessmentMark.countDocuments({ term: term._id }),
    ]);

  const attendanceStats = attendance[0] ?? { marks: 0, attended: 0 };

  return {
    term: {
      id: String(term._id),
      name: term.name,
      academicYear: term.academicYear,
      status: term.status,
    },
    sessions,
    marks: attendanceStats.marks,
    averageAttendance: pct(attendanceStats.attended, attendanceStats.marks),
    resultsReleased,
    assessments,
    marksEntered,
  };
}

/**
 * Build the caller's slice of the campus picture.
 *
 * The order is fixed so the response shape is predictable; sections the caller
 * cannot read are absent, never null.
 */
async function campus({ user }) {
  const sections = {};

  if (userHasPermission(user, P.HOSTEL_READ_INSTITUTION)) {
    sections.hostel = await hostelSection();
  }
  if (userHasPermission(user, P.LIBRARY_READ_INSTITUTION)) {
    sections.library = await librarySection();
  }
  if (userHasPermission(user, P.PLACEMENT_READ_INSTITUTION)) {
    sections.placements = await placementSection();
  }
  if (
    userHasPermission(user, P.ATTENDANCE_READ_INSTITUTION) ||
    userHasPermission(user, P.RESULT_READ_INSTITUTION)
  ) {
    sections.academics = await academicSection();
  }

  return {
    generatedAt: new Date(),
    sections,
  };
}

/** The permissions that make the page reachable at all. */
const READ_PERMISSIONS = Object.freeze([
  P.HOSTEL_READ_INSTITUTION,
  P.LIBRARY_READ_INSTITUTION,
  P.PLACEMENT_READ_INSTITUTION,
  P.ATTENDANCE_READ_INSTITUTION,
  P.RESULT_READ_INSTITUTION,
]);

module.exports = { campus, READ_PERMISSIONS, pct };
