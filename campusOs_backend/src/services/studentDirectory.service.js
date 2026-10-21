/**
 * A minimal student lookup for operational screens.
 *
 * Issuing a book and allocating a room both need to turn a roll number or a
 * name into a student id. Exposing the full student record for a picker would
 * be a wider disclosure than the task needs, so this returns an id, a roll
 * number, a name and the programme/semester — nothing else.
 */
const Student = require("../models/Student");
const User = require("../models/User");
const { ROLES } = require("../config/constants");
const { escapeRegex } = require("../utils/academicScope");

async function search({ q, limit = 20 }) {
  const term = String(q ?? "").trim();
  if (term.length < 2) return [];

  const pattern = new RegExp(escapeRegex(term), "i");

  const users = await User.find({
    role: ROLES.STUDENT,
    isActive: true,
    fullName: pattern,
  })
    .select("_id")
    .limit(limit * 2)
    .lean();

  const students = await Student.find({
    $or: [{ rollNumber: pattern }, { user: { $in: users.map((user) => user._id) } }],
  })
    .select("rollNumber semester program user")
    .populate("user", "fullName")
    .limit(limit)
    .lean();

  return students.map((student) => ({
    studentId: String(student._id),
    rollNumber: student.rollNumber,
    name: student.user?.fullName ?? "Unknown student",
    semester: student.semester,
  }));
}

module.exports = { search };
