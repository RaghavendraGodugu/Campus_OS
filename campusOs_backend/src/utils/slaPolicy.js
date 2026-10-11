/**
 * SLA policy.
 *
 * ## Policy, not constants
 *
 * The spec (§10) requires SLA durations to be configurable institutional
 * policy. These defaults are a starting point, not a truth: they live in one
 * module so an administrator can override them through `settings`, and the
 * resolution order is explicit:
 *
 *   1. a `settings` override, if present
 *   2. the per-category default below
 *   3. the global default below
 *
 * ## Categories are expressed in business hours
 *
 * Hours are *business* hours, consumed only during the institution's working
 * window (see utils/sla.js). A 48-business-hour complaint raised on a Friday
 * evening is therefore not already breached on Saturday morning.
 */

/** Institution's working window and timezone. */
const CALENDAR = {
  timezone: "Asia/Kolkata",
  businessHours: { start: 9, end: 17 },
  weekendDays: [0, 6],
  /**
   * Known institutional holidays, ISO "YYYY-MM-DD".
   *
   * A real deployment should read these from `settings` so they can be updated
   * without a deploy; they are listed here so development produces sensible
   * deadlines out of the box.
   */
  holidays: [
    // Republic Day
    "2026-01-26",
    // Independence Day
    "2026-08-15",
    // Gandhi Jayanti
    "2026-10-02",
  ],
};

/**
 * SLA per category, in business hours to *first response*.
 *
 * Higher-stakes categories are faster. `HARASSMENT` and `SAFETY` are the
 * shortest because a delay is itself a harm.
 */
const CATEGORY_RESPONSE_HOURS = Object.freeze({
  SAFETY: 4,
  HARASSMENT: 4,
  MISCONDUCT: 8,
  ACADEMICS: 24,
  FEES: 24,
  SCHOLARSHIP: 48,
  HOSTEL: 24,
  MESS: 24,
  TRANSPORT: 24,
  LIBRARY: 48,
  INFRASTRUCTURE: 72,
  IT: 24,
  MAINTENANCE: 48,
  PLACEMENTS: 48,
  OTHER: 72,
});

/** Fallback when a category is unknown or unconfigured. */
const DEFAULT_RESPONSE_HOURS = 72;

/**
 * Escalation ladder.
 *
 * `afterHours` is cumulative: level 1 fires at the response deadline, level 2
 * at the deadline plus the second step. Each level names the roles that become
 * responsible, and escalation stops at `maxLevel` so a complaint cannot loop
 * indefinitely.
 */
const ESCALATION_LADDER = Object.freeze([
  {
    level: 1,
    afterHours: 0,
    /** Nobody new is notified; the deadline is simply marked breached. */
    notifyRoles: [],
    description: "Response deadline passed.",
  },
  {
    level: 2,
    afterHours: 4,
    notifyRoles: ["HOD", "PRINCIPAL"],
    description: "Department head notified.",
  },
  {
    level: 3,
    afterHours: 24,
    notifyRoles: ["DEAN", "PRINCIPAL"],
    description: "Dean and principal notified.",
  },
]);

/** Ceiling for automatic escalation. */
const MAX_ESCALATION_LEVEL = ESCALATION_LADDER.length;

/**
 * Build the calendar options `utils/sla.js` expects.
 *
 * Accepts a `settings`-derived override so configuration can change without a
 * code change.
 *
 * @param {object} [overrides]
 * @param {object} [overrides.timezone]
 * @param {object} [overrides.businessHours]
 * @param {string[]} [overrides.holidays]
 */
function calendarOptions(overrides = {}) {
  return {
    timezone: overrides.timezone ?? CALENDAR.timezone,
    businessHours: overrides.businessHours ?? CALENDAR.businessHours,
    holidays: new Set(overrides.holidays ?? CALENDAR.holidays),
  };
}

/**
 * Response-time policy for a category, in business hours.
 *
 * @param {string} category
 * @param {object} [settings] Optional `settings` overrides.
 */
function responseHoursFor(category, settings) {
  const perCategory = settings?.sla?.categoryHours ?? CATEGORY_RESPONSE_HOURS;
  const configured = perCategory[category];

  if (typeof configured === "number" && configured > 0) {
    return configured;
  }

  const global = settings?.sla?.defaultResponseHours ?? DEFAULT_RESPONSE_HOURS;
  return global;
}

/**
 * Compute the response deadline for a complaint raised at `from`.
 *
 * @param {Date} from
 * @param {string} category
 * @param {object} [settings]
 * @returns {Date}
 */
function responseDeadlineFor(from, category, settings) {
  const { addBusinessHours } = require("./sla");
  const hours = responseHoursFor(category, settings);
  return addBusinessHours(from, hours, calendarOptions(settings?.sla));
}

module.exports = {
  CALENDAR,
  CATEGORY_RESPONSE_HOURS,
  DEFAULT_RESPONSE_HOURS,
  ESCALATION_LADDER,
  MAX_ESCALATION_LEVEL,
  calendarOptions,
  responseHoursFor,
  responseDeadlineFor,
};
