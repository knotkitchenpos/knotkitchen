/**
 * Business hours + item availability evaluation (§21).
 *
 * Centralised here so the storefront, the public menu API and order creation
 * all agree on whether a store/product is currently orderable. The existing
 * Menu/MenuItem `schedule` shape ({ enabled, startTime, endTime, daysOfWeek })
 * is reused rather than duplicated.
 */

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || "00:00").split(":").map((n) => parseInt(n, 10) || 0);
  return h * 60 + m;
};

/** Current wall-clock day/minute in the store's IANA timezone. */
const nowInTimezone = (timezone) => {
  const date = new Date();
  if (!timezone) return { day: date.getDay(), minutes: date.getHours() * 60 + date.getMinutes(), date };
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(date).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = dayMap[parts.weekday] ?? date.getDay();
    const hour = parseInt(parts.hour, 10) % 24;
    return { day, minutes: hour * 60 + (parseInt(parts.minute, 10) || 0), date };
  } catch (err) {
    return { day: date.getDay(), minutes: date.getHours() * 60 + date.getMinutes(), date };
  }
};

/**
 * Window check that correctly handles overnight ranges
 * (e.g. 18:00 → 02:00 spans midnight).
 */
const isWithinWindow = (minutes, startTime, endTime) => {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === end) return true;      // 24h
  if (start < end) return minutes >= start && minutes <= end;
  return minutes >= start || minutes <= end; // overnight
};

/**
 * Is the store currently open for online orders?
 * @returns {{isOpen:boolean, reason:string, nextOpen:{day:number,time:string}|null}}
 */
const isStoreOpen = (settings, timezone) => {
  if (!settings) return { isOpen: false, reason: "Store unavailable", nextOpen: null };

  // Stores that have not opted into hour enforcement are always orderable.
  if (!settings.useBusinessHours || !Array.isArray(settings.openingHours) || !settings.openingHours.length) {
    return { isOpen: true, reason: "", nextOpen: null };
  }

  const { day, minutes } = nowInTimezone(timezone);
  const today = settings.openingHours.find((h) => Number(h.day) === day);

  if (today && today.isOpen && isWithinWindow(minutes, today.openTime, today.closeTime)) {
    return { isOpen: true, reason: "", nextOpen: null };
  }

  // Find the next opening slot within the coming week for the "opens at" hint.
  let nextOpen = null;
  for (let i = 0; i < 8; i += 1) {
    const probeDay = (day + i) % 7;
    const slot = settings.openingHours.find((h) => Number(h.day) === probeDay && h.isOpen);
    if (!slot) continue;
    if (i === 0 && minutes >= toMinutes(slot.openTime)) continue; // already passed today
    nextOpen = { day: probeDay, time: slot.openTime };
    break;
  }

  return { isOpen: false, reason: "Restaurant Closed", nextOpen };
};

/** Does an item's own schedule permit ordering right now? */
const isItemAvailableNow = (item, timezone) => {
  if (!item) return false;
  if (item.isAvailable === false) return false;

  const schedule = item.schedule;
  if (!schedule || !schedule.enabled) return true;

  const { day, minutes } = nowInTimezone(timezone);
  const days = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  if (!days.includes(day)) return false;

  return isWithinWindow(minutes, schedule.startTime, schedule.endTime);
};

/**
 * Resolve the effective unit price for an item, applying any active time-based
 * price rule (Happy Hour etc). This is used by BOTH the public menu response
 * and the authoritative order pricing, so a customer is always charged exactly
 * what the storefront displayed.
 */
const getEffectivePrice = (item, timezone) => {
  const base = Number(item?.price) || 0;
  const rules = Array.isArray(item?.priceRules) ? item.priceRules : [];
  if (!rules.length) return base;

  const { day, minutes } = nowInTimezone(timezone);

  for (const rule of rules) {
    if (!rule || rule.isActive === false) continue;
    const days = Array.isArray(rule.daysOfWeek) ? rule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(day)) continue;
    if (isWithinWindow(minutes, rule.startTime, rule.endTime)) {
      return Number(rule.price) || base;
    }
  }

  return base;
};

module.exports = {
  isStoreOpen,
  isItemAvailableNow,
  getEffectivePrice,
  isWithinWindow,
  nowInTimezone,
  toMinutes,
};
