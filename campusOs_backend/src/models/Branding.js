const mongoose = require("mongoose");

/**
 * Per-college branding.
 *
 * A college can customise its visual identity — name, logo, colour palette —
 * without code changes. The palette is stored as CSS variable overrides that
 * are injected into the page at runtime.
 *
 * Only one branding document exists per institution. The SUPER_ADMIN manages
 * it; everyone else reads the resolved CSS variables.
 */
const brandingSchema = new mongoose.Schema(
  {
    /**
     * The college's display name, used in the header, emails and PDFs.
     */
    institutionName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "CampusOS",
    },

    /**
     * Short name for tight spaces (sidebar, favicon tooltip).
     */
    shortName: {
      type: String,
      trim: true,
      maxlength: 24,
      default: "CampusOS",
    },

    /**
     * Logo URL (served from Cloudinary or a CDN).
     * Recommended: SVG or PNG, square, transparent background, max 200KB.
     */
    logoUrl: { type: String, default: null },

    /**
     * Favicon URL (served from Cloudinary or a CDN).
     * Recommended: 32x32 PNG or ICO.
     */
    faviconUrl: { type: String, default: null },

    /**
     * Palette identifier. One of the six built-in palettes.
     * Maps to a set of CSS variable overrides injected at runtime.
     */
    palette: {
      type: String,
      enum: [
        "midnight-vanilla",
        "oxblood-parchment",
        "deep-teal-chalk",
        "graphite-acid",
        "ink-blue-apricot",
        "plum-powder",
      ],
      default: "midnight-vanilla",
    },

    /**
     * Custom CSS variable overrides (JSON). Allows fine-grained control beyond
     * the six palettes — e.g., a specific brand hex the college insists on.
     * Keys are CSS variable names without the leading "--" (e.g., "color-brand-600").
     */
    customVariables: {
      type: Map,
      of: String,
      default: {},
    },

    /**
     * Whether the branding is active. When false, the built-in defaults apply.
     */
    isActive: { type: Boolean, default: true },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

brandingSchema.pre("save", function () {
  this.updatedAt = new Date();
});

/** Resolve the full set of CSS variable overrides for this branding. */
brandingSchema.methods.resolveVariables = function () {
  const paletteOverrides = PALETTES[this.palette] ?? {};
  const custom = Object.fromEntries(this.customVariables ?? []);
  return { ...paletteOverrides, ...custom };
};

/**
 * Built-in palette definitions.
 *
 * Each palette defines the CSS variables it overrides. Variables not listed
 * fall back to the built-in defaults in index.css.
 */
const PALETTES = {
  "midnight-vanilla": {
    "color-brand-50": "oklch(0.975 0.012 96)",
    "color-brand-100": "oklch(0.9378 0.0228 98.6)",
    "color-brand-200": "oklch(0.885 0.02 96)",
    "color-brand-300": "oklch(0.79 0.03 95)",
    "color-brand-400": "oklch(0.66 0.045 92)",
    "color-brand-500": "oklch(0.52 0.055 278)",
    "color-brand-600": "oklch(0.302 0.0559 278.3)",
    "color-brand-700": "oklch(0.255 0.052 279)",
    "color-brand-800": "oklch(0.205 0.045 280)",
    "color-brand-900": "oklch(0.16 0.038 281)",
    "color-brand-950": "oklch(0.105 0.028 282)",
    "color-brand-ink": "oklch(0.225 0.045 279)",
    "color-accent-50": "oklch(0.985 0.012 96)",
    "color-accent-100": "oklch(0.968 0.018 96)",
    "color-accent-200": "oklch(0.9378 0.0228 98.6)",
    "color-accent-300": "oklch(0.905 0.028 96)",
    "color-accent-400": "oklch(0.86 0.035 94)",
    "color-accent-500": "oklch(0.79 0.045 92)",
    "color-accent-600": "oklch(0.68 0.05 90)",
    "color-accent-700": "oklch(0.5 0.045 88)",
    "color-accent-800": "oklch(0.42 0.04 86)",
    "color-ink-50": "oklch(0.987 0.004 96)",
    "color-ink-100": "oklch(0.968 0.006 96)",
    "color-ink-200": "oklch(0.932 0.008 96)",
    "color-ink-300": "oklch(0.882 0.01 96)",
    "color-ink-400": "oklch(0.47 0.012 96)",
    "color-ink-500": "oklch(0.3 0.02 280)",
    "color-ink-600": "oklch(0.27 0.022 280)",
    "color-ink-700": "oklch(0.215 0.024 280)",
    "color-ink-800": "oklch(0.16 0.026 280)",
    "color-ink-900": "oklch(0.11 0.028 280)",
    "color-surface": "oklch(0.985 0.008 96)",
    "color-canvas": "oklch(0.9378 0.0228 98.6)",
  },
  "oxblood-parchment": {
    "color-brand-50": "oklch(0.97 0.01 15)",
    "color-brand-100": "oklch(0.93 0.02 18)",
    "color-brand-200": "oklch(0.87 0.03 18)",
    "color-brand-300": "oklch(0.78 0.04 18)",
    "color-brand-400": "oklch(0.65 0.05 18)",
    "color-brand-500": "oklch(0.52 0.06 18)",
    "color-brand-600": "oklch(0.295 0.055 18.3)", // #4A1F24
    "color-brand-700": "oklch(0.25 0.05 18)",
    "color-brand-800": "oklch(0.2 0.045 18)",
    "color-brand-900": "oklch(0.155 0.038 18)",
    "color-brand-950": "oklch(0.1 0.028 18)",
    "color-brand-ink": "oklch(0.22 0.045 18)",
    "color-accent-50": "oklch(0.98 0.01 55)",
    "color-accent-100": "oklch(0.96 0.018 55)",
    "color-accent-200": "oklch(0.93 0.022 55)", // #F1E7D6
    "color-accent-300": "oklch(0.9 0.028 55)",
    "color-accent-400": "oklch(0.85 0.035 52)",
    "color-accent-500": "oklch(0.78 0.045 50)",
    "color-accent-600": "oklch(0.67 0.05 48)",
    "color-accent-700": "oklch(0.49 0.045 46)",
    "color-accent-800": "oklch(0.41 0.04 44)",
    "color-ink-50": "oklch(0.985 0.004 18)",
    "color-ink-100": "oklch(0.965 0.006 18)",
    "color-ink-200": "oklch(0.93 0.008 18)",
    "color-ink-300": "oklch(0.88 0.01 18)",
    "color-ink-400": "oklch(0.46 0.012 18)",
    "color-ink-500": "oklch(0.29 0.02 18)",
    "color-ink-600": "oklch(0.26 0.022 18)",
    "color-ink-700": "oklch(0.21 0.024 18)",
    "color-ink-800": "oklch(0.155 0.026 18)",
    "color-ink-900": "oklch(0.105 0.028 18)",
    "color-surface": "oklch(0.98 0.008 55)",
    "color-canvas": "oklch(0.93 0.022 55)",
  },
  "deep-teal-chalk": {
    "color-brand-50": "oklch(0.97 0.01 185)",
    "color-brand-100": "oklch(0.93 0.02 188)",
    "color-brand-200": "oklch(0.87 0.03 188)",
    "color-brand-300": "oklch(0.78 0.04 188)",
    "color-brand-400": "oklch(0.65 0.05 188)",
    "color-brand-500": "oklch(0.52 0.06 188)",
    "color-brand-600": "oklch(0.236 0.055 188.3)", // #0C3B3A
    "color-brand-700": "oklch(0.2 0.05 188)",
    "color-brand-800": "oklch(0.16 0.045 188)",
    "color-brand-900": "oklch(0.125 0.038 188)",
    "color-brand-950": "oklch(0.08 0.028 188)",
    "color-brand-ink": "oklch(0.18 0.045 188)",
    "color-accent-50": "oklch(0.98 0.01 95)",
    "color-accent-100": "oklch(0.96 0.018 95)",
    "color-accent-200": "oklch(0.93 0.022 95)", // #E9E7DE
    "color-accent-300": "oklch(0.9 0.028 95)",
    "color-accent-400": "oklch(0.85 0.035 95)",
    "color-accent-500": "oklch(0.78 0.045 95)",
    "color-accent-600": "oklch(0.67 0.05 95)",
    "color-accent-700": "oklch(0.49 0.045 95)",
    "color-accent-800": "oklch(0.41 0.04 95)",
    "color-ink-50": "oklch(0.985 0.004 185)",
    "color-ink-100": "oklch(0.965 0.006 185)",
    "color-ink-200": "oklch(0.93 0.008 185)",
    "color-ink-300": "oklch(0.88 0.01 185)",
    "color-ink-400": "oklch(0.46 0.012 185)",
    "color-ink-500": "oklch(0.29 0.02 188)",
    "color-ink-600": "oklch(0.26 0.022 188)",
    "color-ink-700": "oklch(0.21 0.024 188)",
    "color-ink-800": "oklch(0.155 0.026 188)",
    "color-ink-900": "oklch(0.105 0.028 188)",
    "color-surface": "oklch(0.98 0.008 95)",
    "color-canvas": "oklch(0.93 0.022 95)",
  },
  "graphite-acid": {
    "color-brand-50": "oklch(0.97 0.005 280)",
    "color-brand-100": "oklch(0.93 0.01 280)",
    "color-brand-200": "oklch(0.87 0.015 280)",
    "color-brand-300": "oklch(0.78 0.02 280)",
    "color-brand-400": "oklch(0.65 0.025 280)",
    "color-brand-500": "oklch(0.52 0.03 280)",
    "color-brand-600": "oklch(0.11 0.02 280.3)", // #1C1D21
    "color-brand-700": "oklch(0.09 0.018 280)",
    "color-brand-800": "oklch(0.07 0.015 280)",
    "color-brand-900": "oklch(0.055 0.012 280)",
    "color-brand-950": "oklch(0.04 0.008 280)",
    "color-brand-ink": "oklch(0.08 0.015 280)",
    "color-accent-50": "oklch(0.98 0.01 115)",
    "color-accent-100": "oklch(0.96 0.018 115)",
    "color-accent-200": "oklch(0.93 0.022 115)", // #EDECE6
    "color-accent-300": "oklch(0.9 0.028 115)",
    "color-accent-400": "oklch(0.85 0.035 115)",
    "color-accent-500": "oklch(0.78 0.045 115)",
    "color-accent-600": "oklch(0.67 0.05 115)",
    "color-accent-700": "oklch(0.49 0.045 115)",
    "color-accent-800": "oklch(0.41 0.04 115)",
    "color-ink-50": "oklch(0.985 0.003 280)",
    "color-ink-100": "oklch(0.965 0.005 280)",
    "color-ink-200": "oklch(0.93 0.007 280)",
    "color-ink-300": "oklch(0.88 0.009 280)",
    "color-ink-400": "oklch(0.45 0.01 280)",
    "color-ink-500": "oklch(0.28 0.018 280)",
    "color-ink-600": "oklch(0.25 0.02 280)",
    "color-ink-700": "oklch(0.2 0.022 280)",
    "color-ink-800": "oklch(0.15 0.024 280)",
    "color-ink-900": "oklch(0.1 0.026 280)",
    "color-surface": "oklch(0.98 0.007 280)",
    "color-canvas": "oklch(0.93 0.02 280)",
  },
  "ink-blue-apricot": {
    "color-brand-50": "oklch(0.97 0.01 255)",
    "color-brand-100": "oklch(0.93 0.02 258)",
    "color-brand-200": "oklch(0.87 0.03 258)",
    "color-brand-300": "oklch(0.78 0.04 258)",
    "color-brand-400": "oklch(0.65 0.05 258)",
    "color-brand-500": "oklch(0.52 0.06 258)",
    "color-brand-600": "oklch(0.25 0.055 258.3)", // #14243A
    "color-brand-700": "oklch(0.22 0.05 258)",
    "color-brand-800": "oklch(0.17 0.045 258)",
    "color-brand-900": "oklch(0.13 0.038 258)",
    "color-brand-950": "oklch(0.085 0.028 258)",
    "color-brand-ink": "oklch(0.19 0.045 258)",
    "color-accent-50": "oklch(0.98 0.01 45)",
    "color-accent-100": "oklch(0.96 0.018 45)",
    "color-accent-200": "oklch(0.93 0.022 45)", // #F2E9DC
    "color-accent-300": "oklch(0.9 0.028 45)",
    "color-accent-400": "oklch(0.85 0.035 45)",
    "color-accent-500": "oklch(0.78 0.045 45)",
    "color-accent-600": "oklch(0.67 0.05 45)",
    "color-accent-700": "oklch(0.49 0.045 45)",
    "color-accent-800": "oklch(0.41 0.04 45)",
    "color-ink-50": "oklch(0.985 0.004 255)",
    "color-ink-100": "oklch(0.965 0.006 255)",
    "color-ink-200": "oklch(0.93 0.008 255)",
    "color-ink-300": "oklch(0.88 0.01 255)",
    "color-ink-400": "oklch(0.46 0.012 255)",
    "color-ink-500": "oklch(0.29 0.02 258)",
    "color-ink-600": "oklch(0.26 0.022 258)",
    "color-ink-700": "oklch(0.21 0.024 258)",
    "color-ink-800": "oklch(0.155 0.026 258)",
    "color-ink-900": "oklch(0.105 0.028 258)",
    "color-surface": "oklch(0.98 0.008 45)",
    "color-canvas": "oklch(0.93 0.022 45)",
  },
  "plum-powder": {
    "color-brand-50": "oklch(0.97 0.01 320)",
    "color-brand-100": "oklch(0.93 0.02 322)",
    "color-brand-200": "oklch(0.87 0.03 322)",
    "color-brand-300": "oklch(0.78 0.04 322)",
    "color-brand-400": "oklch(0.65 0.05 322)",
    "color-brand-500": "oklch(0.52 0.06 322)",
    "color-brand-600": "oklch(0.23 0.055 322.3)", // #3A2340
    "color-brand-700": "oklch(0.2 0.05 322)",
    "color-brand-800": "oklch(0.16 0.045 322)",
    "color-brand-900": "oklch(0.125 0.038 322)",
    "color-brand-950": "oklch(0.08 0.028 322)",
    "color-brand-ink": "oklch(0.18 0.045 322)",
    "color-accent-50": "oklch(0.98 0.01 340)",
    "color-accent-100": "oklch(0.96 0.018 340)",
    "color-accent-200": "oklch(0.93 0.022 340)", // #F0E9EE
    "color-accent-300": "oklch(0.9 0.028 340)",
    "color-accent-400": "oklch(0.85 0.035 340)",
    "color-accent-500": "oklch(0.78 0.045 340)",
    "color-accent-600": "oklch(0.67 0.05 340)",
    "color-accent-700": "oklch(0.49 0.045 340)",
    "color-accent-800": "oklch(0.41 0.04 340)",
    "color-ink-50": "oklch(0.985 0.004 320)",
    "color-ink-100": "oklch(0.965 0.006 320)",
    "color-ink-200": "oklch(0.93 0.008 320)",
    "color-ink-300": "oklch(0.88 0.01 320)",
    "color-ink-400": "oklch(0.46 0.012 320)",
    "color-ink-500": "oklch(0.29 0.02 322)",
    "color-ink-600": "oklch(0.26 0.022 322)",
    "color-ink-700": "oklch(0.21 0.024 322)",
    "color-ink-800": "oklch(0.155 0.026 322)",
    "color-ink-900": "oklch(0.105 0.028 322)",
    "color-surface": "oklch(0.98 0.008 340)",
    "color-canvas": "oklch(0.93 0.022 340)",
  },
};

module.exports = mongoose.models.Branding || mongoose.model("Branding", brandingSchema);
