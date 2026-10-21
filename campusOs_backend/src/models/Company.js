const mongoose = require("mongoose");

/** A recruiting company. Drives belong to it. */
const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, maxlength: 160 },
    sector: { type: String, trim: true, maxlength: 80, default: "" },
    website: { type: String, trim: true, maxlength: 200, default: "" },
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

module.exports = mongoose.model("Company", companySchema);
