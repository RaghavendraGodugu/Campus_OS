const mongoose = require("mongoose");

/**
 * A library title.
 *
 * `copiesIssued` is the live count, not `copiesTotal - issues.length`: issuing a
 * copy is one atomic `$inc` guarded by `copiesIssued < copiesTotal`, which is
 * what prevents two simultaneous issues from taking the same last copy.
 */
const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    author: { type: String, required: true, trim: true, maxlength: 160 },
    isbn: { type: String, trim: true, maxlength: 24, default: "" },
    category: { type: String, trim: true, maxlength: 60, default: "General" },
    copiesTotal: { type: Number, required: true, min: 1, max: 1000 },
    copiesIssued: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
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
bookSchema.index({ title: "text", author: "text" });
bookSchema.index({ category: 1, isActive: 1 });

module.exports = mongoose.model("Book", bookSchema);
