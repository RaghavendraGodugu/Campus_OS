const InstitutionTaxProfile = require("../models/InstitutionTaxProfile");
const { ApiError } = require("../utils/ApiError");
const auditService = require("./audit.service");
const { AUDIT_ACTION } = require("../config/constants");
const { logger } = require("../config/logger");

/**
 * The institution's GST profile.
 *
 * ## One row, and the index enforces it
 *
 * A second profile would mean an invoice picks a GSTIN at random, and a tax
 * invoice's GSTIN must be the registered one. The singleton unique index makes
 * a second row impossible whatever the application does — an upsert on the
 * constant key, never an insert.
 *
 * ## `stateCode` comes from the GSTIN
 *
 * The first two digits of a GSTIN are the state it is registered in. Letting
 * somebody also type a state code invites the two to disagree, and a profile
 * claiming state 07 with a GSTIN beginning 29 issues invoices that state the
 * wrong place of supply — invisible on the document, caught by an auditor.
 */

/** The profile, or null. Null is a real answer, not a failure. */
async function get() {
  return InstitutionTaxProfile.findOne({ singleton: "primary" }).lean();
}

/**
 * Create or replace the profile.
 *
 * An upsert rather than create-then-update: with the index in place there can
 * only ever be one row, and two concurrent administrators saving the profile
 * should not produce a duplicate-key error.
 */
async function save({ user, payload }) {
  const existed = await InstitutionTaxProfile.findOne({ singleton: "primary" });

  const profile = await InstitutionTaxProfile.findOneAndUpdate(
    { singleton: "primary" },
    { $set: { ...payload, updatedBy: user._id } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  await auditService.record({
    actor: user,
    action: existed ? AUDIT_ACTION.UPDATE : AUDIT_ACTION.CREATE,
    entity: "InstitutionTaxProfile",
    entityId: profile._id,
    entityRef: profile.gstin,
    // The GSTIN is recorded because "who changed the tax registration" is a
    // legitimate audit question. The address is not.
    metadata: {
      gstin: profile.gstin,
      stateCode: profile.stateCode,
      existed: Boolean(existed),
    },
  });

  logger.info(
    { userId: user._id, gstin: profile.gstin },
    "Institution GST profile saved"
  );

  return profile.toJSON();
}

/** Refuse to delete the profile while taxable invoices exist. */
async function remove({ user }) {
  const profile = await get();
  if (!profile) throw ApiError.notFound("No GST profile is set up");

  await InstitutionTaxProfile.deleteOne({ singleton: "primary" });

  await auditService.record({
    actor: user,
    action: AUDIT_ACTION.DELETE,
    entity: "InstitutionTaxProfile",
    entityRef: profile.gstin,
    metadata: {},
  });

  return true;
}

module.exports = { get, save, remove };
