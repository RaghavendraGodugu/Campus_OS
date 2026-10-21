const mongoose = require("mongoose");
const { BOOK_ISSUE_STATUS } = require("../config/constants");

/** One borrow. Returned rows are kept as history. */
const bookIssueSchema = new mongoose.Schema(
  {
    book: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    issuedAt: { type: Date, default: Date.now },
    dueAt: { type: Date, required: true },
    returnedAt: { type: Date, default: null },
    returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: {
      type: String,
      enum: Object.values(BOOK_ISSUE_STATUS),
      default: BOOK_ISSUE_STATUS.ISSUED,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_d, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);
bookIssueSchema.index(
  { book: 1, student: 1 },
  { unique: true, partialFilterExpression: { status: "ISSUED" } }
);
bookIssueSchema.index({ student: 1, status: 1 });
bookIssueSchema.index({ status: 1, dueAt: 1 });

module.exports = mongoose.model("BookIssue", bookIssueSchema);
