/**
 * Notification preferences.
 *
 * ## Muting never loses a notification
 *
 * A muted category is still delivered and still recorded in the list; it simply
 * does not raise the unread badge. This is the whole design.
 *
 * Muting by *not delivering* would be the obvious implementation and it is
 * wrong: a student who mutes finance and then misses "your refund was
 * processed" has been harmed by a setting they chose to stop noise, not to stop
 * information. Everything that matters is still in the inbox, findable, and the
 * badge still means "something is waiting".
 *
 * ## Two categories are not optional
 *
 * Security-relevant and account-relevant notifications are always delivered
 * and always badge. A password reset link that respects a "quiet mode" is not a
 * preference, it is a lockout.
 */

/**
 * Which category each notification type belongs to.
 *
 * One table, deliberately explicit. Deriving it from a naming convention means a
 * type called `REQUEST_WHATEVER` is silently filed by a substring match, and a
 * typo becomes a notification nobody can switch off.
 */
const TYPE_CATEGORY = Object.freeze({
  REQUEST_SUBMITTED: "requests",
  REQUEST_ASSIGNED: "requests",
  REQUEST_STATUS_CHANGED: "requests",
  REQUEST_COMMENT: "requests",
  REQUEST_ACTION_REQUIRED: "requests",

  COMPLAINT_STATUS_CHANGED: "complaints",
  COMPLAINT_ESCALATED: "complaints",

  CERTIFICATE_STATUS_CHANGED: "certificates",
  CERTIFICATE_READY: "certificates",

  INVOICE_ISSUED: "finance",
  PAYMENT_RECEIVED: "finance",
  PAYMENT_FAILED: "finance",
  REFUND_STATUS_CHANGED: "finance",

  ANNOUNCEMENT: "announcements",
});

/** The categories a person may switch on and off. */
const CATEGORIES = Object.freeze([
  "requests",
  "complaints",
  "certificates",
  "finance",
  "announcements",
]);

/**
 * Should this notification raise the unread badge?
 *
 * @param {object} preferences The recipient's stored preferences.
 * @param {string} type NOTIFICATION_TYPE value.
 * @returns {boolean}
 */
function shouldBadge({ preferences, type }) {
  const settings = preferences ?? {};

  // A notification type with no category is treated as badge-worthy. Not
  // filing a new type into a category must not silently mute it — the failure
  // of a notification nobody receives is worse than one badge too many.
  const category = TYPE_CATEGORY[type];
  if (!category) return true;

  // Muting a category stops the badge. It never stops the delivery: see the
  // note at the top of this file.
  if (settings[category] === false) return false;

  if (settings.unreadBadge === false) return false;
  return true;
}

/** The preferences as a client-facing object, with every key present. */
function present(user) {
  const stored = user?.notificationPreferences ?? {};
  const result = { unreadBadge: true };
  for (const category of CATEGORIES) {
    result[category] = stored[category] !== false;
  }
  return result;
}

module.exports = {
  TYPE_CATEGORY,
  CATEGORIES,
  shouldBadge,
  present,
};
