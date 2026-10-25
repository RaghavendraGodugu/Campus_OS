const Branding = require("../models/Branding");

const PALETTE_KEYS = [
  "midnight-vanilla",
  "oxblood-parchment",
  "deep-teal-chalk",
  "graphite-acid",
  "ink-blue-apricot",
  "plum-powder",
];

/** Get the branding document (singleton). */
async function getBranding() {
  let branding = await Branding.findOne().lean();
  if (!branding) {
    branding = await Branding.create({});
  }
  return branding;
}

/** Get the resolved CSS variables for the current branding. */
async function getResolvedVariables() {
  const branding = await getBranding();
  if (!branding.isActive) {
    return {};
  }
  return branding.resolveVariables();
}

/** Update branding. Only SUPER_ADMIN may write. */
async function updateBranding({ user, payload }) {
  let branding = await Branding.findOne();
  if (!branding) {
    branding = await Branding.create({ ...payload, updatedBy: user._id });
  } else {
    Object.assign(branding, payload, { updatedBy: user._id });
    await branding.save();
  }
  return branding.toJSON();
}

/** Toggle branding on/off. */
async function toggleBranding({ user, isActive }) {
  let branding = await Branding.findOne();
  if (!branding) {
    branding = await Branding.create({ isActive, updatedBy: user._id });
  } else {
    branding.isActive = isActive;
    branding.updatedBy = user._id;
    await branding.save();
  }
  return branding.toJSON();
}

/** Get available palette options. */
function listPalettes() {
  return PALETTE_KEYS.map((key) => ({
    id: key,
    name: key.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" / "),
  }));
}

module.exports = {
  getBranding,
  getResolvedVariables,
  updateBranding,
  toggleBranding,
  listPalettes,
};
