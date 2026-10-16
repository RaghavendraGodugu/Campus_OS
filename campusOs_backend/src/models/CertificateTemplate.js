const mongoose = require("mongoose");

const { CERTIFICATE_TYPES } = require("../config/constants");

/**
 * A certificate template.
 *
 * ## Why a template exists at all
 *
 * The built-in layout covers all nine certificate types, but colleges put their
 * own heading on these documents — the principal's name in a particular style,
 * a reference to a regulation, a footer with an office address. Without a
 * template the only way to change that is a code change and a deployment.
 *
 * ## Templates are text with placeholders, never HTML or images
 *
 * A template holds a heading, a body and a footer as plain text with `{{token}}`
 * placeholders. Allowing markup would mean a template could emit a script into a
 * document that is downloaded and opened, and an uploaded logo would be an
 * unvetted file on an official-looking page.
 *
 * Placeholders are resolved against a fixed allowlist, and an unknown token is
 * left as literal text rather than being blanked — so a typo is visible in the
 * printed document instead of silently disappearing from it.
 */

const certificateTemplateSchema = new mongoose.Schema(
  {
    /**
     * Which certificate type this template is for.
     *
     * Indexed rather than unique: a college may keep a "current" and an
     * "archive" template per type, and switching between them should not
     * require deleting the old one.
     */
    type: {
      type: String,
      required: [true, "A template needs a certificate type"],
      enum: {
        values: CERTIFICATE_TYPES,
        message: "`{VALUE}` is not a valid certificate type",
      },
      index: true,
    },

    name: {
      type: String,
      required: [true, "A template needs a name"],
      trim: true,
      maxlength: 120,
    },

    /**
     * The default for its type.
     *
     * At most one default per type, enforced by a partial unique index rather
     * than by application code — two "defaults" means issuance picks one at
     * random and nobody can say which.
     */
    isDefault: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true },

    heading: { type: String, default: null, trim: true, maxlength: 200 },
    body: { type: String, default: null, trim: true, maxlength: 4000 },
    footer: { type: String, default: null, trim: true, maxlength: 1000 },

    /**
     * Which tokens this template uses, recorded at save time.
     *
     * Purely informational: it lets the editor show "this template has never
     * been checked against the placeholders it needs", which is otherwise a
     * question nobody can answer without issuing a test certificate.
     */
    declaredTokens: { type: [String], default: [] },

    isSystem: { type: Boolean, default: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/** One default per certificate type. */
certificateTemplateSchema.index(
  { type: 1 },
  {
    unique: true,
    partialFilterExpression: { isDefault: true },
    name: "one_default_template_per_type",
  }
);

certificateTemplateSchema.index({ type: 1, isActive: 1 });

module.exports =
  mongoose.models.CertificateTemplate ||
  mongoose.model("CertificateTemplate", certificateTemplateSchema);
