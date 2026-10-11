/**
 * SLA business-calendar arithmetic.
 *
 * ## Why this is not `createdAt + 48 hours`
 *
 * The spec (§10) requires SLA durations to be *institutional policy*, not
 * universal hardcoded truths, and requires the timezone and business-calendar
 * rules to be defined explicitly. A college is closed on Sundays and public
 * holidays, so counting elapsed hours would guarantee that complaints raised on
 * a Friday evening breach their deadline before anyone has looked at them.
 *
 * ## The rules, stated
 *
 *  - Deadlines are counted in **business hours**, not calendar hours.
 *  - A business day is Monday-Friday, excluding configured holidays.
 *  - Work outside business hours does not advance the clock: a complaint raised
 *    at 23:00 is due at the same wall-clock time the next business day.
 *  - The business day ends at `businessHours.end` (default 17:00 IST); work
 *    submitted after that carries into the next business day.
 *  - Timezone is fixed at `Asia/Kolkata` by default and is a configured
 *    institution-level setting, never the server's local time. A server running
 *    in UTC must not silently shift every deadline.
 *
 * The implementation works on "minutes from the start of a business day" in the
 * configured timezone. It deliberately avoids a date library dependency: the
 * arithmetic is simple, and a dependency that silently disagrees about
 * half-open DST intervals is a worse failure mode than explicit code.
 */

/** Default institution timezone. Indian institutions; override per deployment. */
const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** Default working window, in local time. */
const DEFAULT_BUSINESS_HOURS = {
  start: 9, // 09:00
  end: 17, // 17:00
};

/** Monday=0 .. Sunday=6. */
const WEEKEND_DAYS = new Set([0, 6]);

/**
 * Minutes since local midnight for a Date, in the configured timezone.
 *
 * Uses `Intl.DateTimeFormat` with the target timezone, which is the only
 * reliable way to do this without a date library: the server's own clock says
 * nothing about the institution's local time.
 *
 * @param {Date} date
 * @param {string} timezone
 * @returns {{year:number, month:number, day:number, weekday:number, minutes:number}}
 */
function getLocalParts(date, timezone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday] ?? 1,
    // `hour` can arrive as "24" for midnight under hour12:false in some ICU
    // versions; normalise it to 0.
    hours: Number(parts.hour) % 24,
    minutes: Number(parts.minute),
  };
}

/**
 * Is this local calendar day a working day?
 *
 * @param {{weekday:number}} parts
 * @param {Set<string>} holidays  ISO "YYYY-MM-DD" strings.
 */
function isBusinessDay(parts, holidays) {
  if (WEEKEND_DAYS.has(parts.weekday)) return false;
  if (holidays.has(toIsoDate(parts))) return false;
  return true;
}

/** "YYYY-MM-DD" for a parts object. */
function toIsoDate({ year, month, day }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Compute the SLA deadline for a complaint.
 *
 * @param {Date} from            When the clock starts (submission or assignment).
 * @param {number} slaHours      Policy duration in business hours.
 * @param {object} [options]
 * @param {string} [options.timezone]
 * @param {number} [options.businessHoursStart]
 * @param {number} [options.businessHoursEnd]
 * @param {Set<string>} [options.holidays] ISO dates.
 * @returns {Date} The deadline.
 */
function addBusinessHours(from, slaHours, options = {}) {
  const {
    timezone = DEFAULT_TIMEZONE,
    holidays = new Set(),
    businessHours = DEFAULT_BUSINESS_HOURS,
  } = options;

  let cursor = new Date(from.getTime());
  let remainingMinutes = Math.round(slaHours * 60);

  const dayStartMinutes = businessHours.start * 60;
  const dayEndMinutes = businessHours.end * 60;
  // A policy longer than a single working day must roll over whole days, then
  // consume the remainder inside a final day's window.
  const MAX_ITERATIONS = 3650;
  for (let i = 0; i < MAX_ITERATIONS && remainingMinutes > 0; i++) {
    const parts = getLocalParts(cursor, timezone);
    const nowMinutes = parts.hours * 60 + parts.minutes;

    if (isBusinessDay(parts, holidays)) {
      if (nowMinutes < dayStartMinutes) {
        // Before opening: jump to opening time on this same day.
        cursor = applyLocalMinutes(cursor, dayStartMinutes, timezone);
        continue;
      }

      if (nowMinutes >= dayEndMinutes) {
        // After closing: move to the next calendar day.
        cursor = advanceToNextDay(cursor, timezone);
        continue;
      }

      const available = dayEndMinutes - nowMinutes;
      if (remainingMinutes <= available) {
        // Fits inside today's remaining window. The loop exits here, so there
        // is no need to zero the counter.
        cursor = applyLocalMinutes(cursor, nowMinutes + remainingMinutes, timezone);
        break;
      }

      // Consume today's window and carry the rest forward.
      remainingMinutes -= available;
      cursor = advanceToNextDay(cursor, timezone);
      continue;
    }

    // Weekend or holiday: skip to the next calendar day.
    cursor = advanceToNextDay(cursor, timezone);
  }

  return cursor;
}

/**
 * Set the local wall-clock time on a Date, expressed in `timezone`.
 *
 * Converting "09:00 on 2026-03-02 in Asia/Kolkata" to a UTC instant requires the
 * zone offset, which is obtained by formatting the same instant and reading the
 * offset back. Doing this explicitly avoids depending on the server's local
 * timezone, which is the usual source of SLA deadlines being off by hours.
 */
function applyLocalMinutes(date, minutesFromMidnight, timezone) {
  const parts = getLocalParts(date, timezone);
  const offsetMinutes = getTimezoneOffsetMinutes(date, timezone);
  const utcMs =
    Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0) +
    (minutesFromMidnight - offsetMinutes) * 60_000;
  return new Date(utcMs);
}

/** Move to 00:00 on the next local calendar day. */
function advanceToNextDay(date, timezone) {
  const parts = getLocalParts(date, timezone);
  const offsetMinutes = getTimezoneOffsetMinutes(date, timezone);
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0) +
      86_400_000 -
      offsetMinutes * 60_000
  );
}

/**
 * Offset of `timezone` from UTC, in minutes, at the given instant.
 *
 * Positive east of Greenwich. India is +330.
 */
function getTimezoneOffsetMinutes(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );

  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000;
}

/**
 * Remaining business minutes between two instants.
 *
 * Used to report "overdue by 3h 20m" on management screens.
 *
 * @returns {number} Negative when `to` is in the past.
 */
function businessMinutesBetween(from, to, options = {}) {
  const {
    timezone = DEFAULT_TIMEZONE,
    holidays = new Set(),
    businessHours = DEFAULT_BUSINESS_HOURS,
  } = options;

  if (to <= from) return -businessMinutesBetween(to, from, options);

  let cursor = new Date(from.getTime());
  let total = 0;

  const dayStartMinutes = businessHours.start * 60;
  const dayEndMinutes = businessHours.end * 60;

  const MAX_ITERATIONS = 3650;
  for (let i = 0; i < MAX_ITERATIONS && cursor < to; i++) {
    const parts = getLocalParts(cursor, timezone);

    if (isBusinessDay(parts, holidays)) {
      const windowStart = new Date(
        Math.max(cursor.getTime(), shiftLocal(cursor, dayStartMinutes, timezone))
      );
      const windowEnd = shiftLocal(cursor, dayEndMinutes, timezone);
      const segmentStart = windowStart > cursor ? windowStart : cursor;
      const segmentEnd = windowEnd < to ? windowEnd : to;

      if (segmentEnd > segmentStart) {
        total += (segmentEnd.getTime() - segmentStart.getTime()) / 60_000;
      }
    }

    cursor = advanceToNextDay(cursor, timezone);
    if (cursor.getTime() === from.getTime()) break; // defensive: never stall
  }

  return Math.round(total);
}

/** Convert "minutes from local midnight" into an absolute instant. */
function shiftLocal(date, minutesFromMidnight, timezone) {
  return applyLocalMinutes(date, minutesFromMidnight, timezone);
}

/**
 * Human-readable breach duration, e.g. "2h 15m" or "3d 4h".
 *
 * The sign is preserved for the caller: a negative value means the deadline has
 * passed, and reporting it as "1d 16h" without a marker would be read as
 * remaining time. `-formatDuration(x)` renders "1d 16m" as "1d 16h ago".
 *
 * @param {number} minutes May be negative.
 */
function formatDuration(minutes) {
  const rounded = Math.round(minutes);
  const abs = Math.abs(rounded);
  const sign = rounded < 0 ? "-" : "";
  const days = Math.floor(abs / (60 * 24));
  const hours = Math.floor((abs % (60 * 24)) / 60);
  const mins = abs % 60;

  if (days > 0) return `${sign}${days}d ${hours}h`;
  if (hours > 0) return `${sign}${hours}h ${mins}m`;
  return `${sign}${mins}m`;
}

module.exports = {
  DEFAULT_TIMEZONE,
  DEFAULT_BUSINESS_HOURS,
  addBusinessHours,
  businessMinutesBetween,
  isBusinessDay,
  toIsoDate,
  getLocalParts,
  getTimezoneOffsetMinutes,
  formatDuration,
};
