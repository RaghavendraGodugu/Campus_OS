/**
 * Model registry.
 *
 * Requiring every model from one place guarantees they are all compiled and
 * their indexes registered, regardless of which feature route was loaded. A
 * model that is only required by a route the current process does not mount
 * would otherwise never be compiled, and `Model.init()` would never sync.
 */

// ===== Phase A: foundation =====
const User = require("./User");
require("./InstitutionTaxProfile");
require("./CertificateTemplate");
require("./AcademicTerm");
const Department = require("./Department");
const Program = require("./Program");
const Student = require("./Student");
const AuditLog = require("./AuditLog");
const Counter = require("./Counter");
const RequestType = require("./RequestType");
const Request = require("./Request");
const Document = require("./Document");
const Notification = require("./Notification");
const Announcement = require("./Announcement");
const Complaint = require("./Complaint");
const Certificate = require("./Certificate");
const Invoice = require("./Invoice");
const Payment = require("./Payment");
const Refund = require("./Refund");

// Each entry maps a model name to the Mongoose model, used by the index-sync
// health check and by the test harness for cleanup between suites.
const models = {
  User,
  Department,
  Program,
  Student,
  AuditLog,
  Counter,
  RequestType,
  Request,
  Document,
  Notification,
  Announcement,
  Complaint,
  Certificate,
  Invoice,
  Payment,
  Refund,
  Subject: require("./Subject"),
  Room: require("./Room"),
  TimetableEntry: require("./TimetableEntry"),
  AttendanceSession: require("./AttendanceSession"),
  Assessment: require("./Assessment"),
  AssessmentMark: require("./AssessmentMark"),
  ResultRelease: require("./ResultRelease"),
  Hostel: require("./Hostel"),
  HostelRoom: require("./HostelRoom"),
  HostelAllocation: require("./HostelAllocation"),
  HostelLeave: require("./HostelLeave"),
  Book: require("./Book"),
  BookIssue: require("./BookIssue"),
  Company: require("./Company"),
  PlacementDrive: require("./PlacementDrive"),
  PlacementApplication: require("./PlacementApplication"),
};

/**
 * Wait for every index to finish building.
 *
 * `autoIndex` builds indexes in the background, so a test that inserts
 * immediately after boot can race a unique index that does not exist yet and
 * miss a constraint it believes is enforced. Tests await this explicitly.
 */
async function initIndexes() {
  await Promise.all(Object.values(models).map((model) => model.init()));
}

module.exports = {
  ...models,
  models,
  AcademicTerm: require("./AcademicTerm"),
  CertificateTemplate: require("./CertificateTemplate"),
  InstitutionTaxProfile: require("./InstitutionTaxProfile"),
  initIndexes,
  // Re-exported counter helpers so callers need a single import path.
  counterKey: Counter.counterKey,
  formatReference: Counter.formatReference,
};
