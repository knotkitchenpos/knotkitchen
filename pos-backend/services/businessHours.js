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
 * Check if the store is override-closed for today (including overnight boundary).
 */
const isClosedForToday = (settings, timezone) => {
  const cft = settings?.closedForToday;
  if (!cft || !cft.enabled || !cft.date) return false;

  const { day, date } = nowInTimezone(timezone);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const todayStr = `${y}-${m}-${d}`;

  // 1. Direct match for today's date
  if (cft.date === todayStr) {
    return true;
  }

  // 2. Check if yesterday was cft.date AND we are currently within yesterday's overnight shift
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const yy = yesterday.getFullYear();
  const ym = String(yesterday.getMonth() + 1).padStart(2, "0");
  const yd = String(yesterday.getDate()).padStart(2, "0");
  const yesterdayStr = `${yy}-${ym}-${yd}`;

  if (cft.date === yesterdayStr) {
    const prevDay = (day + 6) % 7;
    const yesterdayEntry = settings.openingHours?.find((h) => Number(h.day) === prevDay);
    if (yesterdayEntry && yesterdayEntry.isOpen) {
      const startM = toMinutes(yesterdayEntry.openTime);
      const endM = toMinutes(yesterdayEntry.closeTime);
      const startDay = Number(yesterdayEntry.day);
      const closeDay = (yesterdayEntry.closeDay !== undefined && yesterdayEntry.closeDay !== null)
        ? Number(yesterdayEntry.closeDay)
        : (endM < startM ? (startDay + 1) % 7 : startDay);

      if (startDay !== closeDay) {
        const { minutes } = nowInTimezone(timezone);
        if (minutes <= endM) {
          return true; // Still inside yesterday's overnight shift!
        }
      }
    }
  }

  return false;
};

/**
 * Is the store currently open for online orders?
 * Supports overnight schedules and closeDay crossing into next day.
 * @returns {{isOpen:boolean, reason:string, nextOpen:{day:number,time:string}|null}}
 */
const isStoreOpen = (settings, timezone) => {
  if (!settings) return { isOpen: false, reason: "Store unavailable", nextOpen: null };

  if (isClosedForToday(settings, timezone)) {
    return { isOpen: false, reason: settings.closedForToday?.reason || "Store is Closed for Today", nextOpen: null };
  }

  // Stores that have not opted into hour enforcement are always orderable.
  if (!settings.useBusinessHours || !Array.isArray(settings.openingHours) || !settings.openingHours.length) {
    return { isOpen: true, reason: "", nextOpen: null };
  }

  const { day, minutes } = nowInTimezone(timezone);

  // Helper to check if an opening hour entry h is currently active
  const isEntryActive = (h, isToday) => {
    if (!h || !h.isOpen) return false;
    const startM = toMinutes(h.openTime);
    const endM = toMinutes(h.closeTime);
    const startDay = Number(h.day);
    const closeDay = (h.closeDay !== undefined && h.closeDay !== null)
      ? Number(h.closeDay)
      : (endM < startM ? (startDay + 1) % 7 : startDay);

    if (startDay === closeDay) {
      // Same-day shift
      if (!isToday) return false;
      return minutes >= startM && minutes <= endM;
    } else {
      // Overnight or multi-day shift
      if (isToday) {
        // Evening portion of shift started today
        return minutes >= startM;
      } else {
        // Morning portion of shift started yesterday extending into today
        return minutes <= endM;
      }
    }
  };

  // 1. Check today's shift
  const todayEntry = settings.openingHours.find((h) => Number(h.day) === day);
  if (isEntryActive(todayEntry, true)) {
    return { isOpen: true, reason: "", nextOpen: null };
  }

  // 2. Check yesterday's overnight shift
  const prevDay = (day + 6) % 7;
  const yesterdayEntry = settings.openingHours.find((h) => Number(h.day) === prevDay);
  if (isEntryActive(yesterdayEntry, false)) {
    return { isOpen: true, reason: "", nextOpen: null };
  }

  // Find next opening slot
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
/**
 * @param {string} [surface] "pos" | "website". When given, a product whose
 *   Display Status is OFF can still be available on that one surface via
 *   visibleOnPosWhenOff / visibleOnWebsiteWhenOff. Omit it for the old
 *   all-or-nothing behaviour.
 */
const isItemAvailableNow = (item, timezone, surface) => {
  if (!item) return false;
  if (item.isAvailable === false) {
    const rescued =
      (surface === "pos" && item.visibleOnPosWhenOff === true) ||
      (surface === "website" && item.visibleOnWebsiteWhenOff === true);
    if (!rescued) return false;
  }

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
/**
 * The item's list price for one selling channel.
 *
 * "Same price for all channels" OFF stores six figures on the product —
 * posCollection / posDelivery / posTable and the three website equivalents —
 * and until now NOTHING read them: every surface, and every bill, used
 * `item.price`. Turning the toggle off therefore appeared to do nothing.
 *
 * `environment` is "system" (POS) or "website"; `channel` is one of
 * collection | delivery | table. Falls back to `item.price` when the product
 * uses one price everywhere, when the channel figure is missing, or when it
 * is zero — a channel priced at 0 is far more likely to be an unset field
 * than a genuinely free product.
 */
const CHANNEL_PRICE_KEYS = {
  system: { collection: "posCollection", delivery: "posDelivery", table: "posTable" },
  website: { collection: "websiteCollection", delivery: "websiteDelivery", table: "websiteTable" },
};

const getChannelPrice = (item, environment, channel) => {
  const base = Number(item?.price) || 0;
  if (!item || item.samePrice !== false) return base;

  const keys = CHANNEL_PRICE_KEYS[environment === "system" ? "system" : "website"];
  const key = keys[channel] || keys.collection;
  const raw = item.channelPrices ? item.channelPrices[key] : undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : base;
};

/**
 * Effective unit price: the channel list price, then any active time-based
 * price rule (Happy Hour etc), which overrides it.
 */
const getEffectivePrice = (item, timezone, { environment, channel } = {}) => {
  const base = environment || channel
    ? getChannelPrice(item, environment, channel)
    : Number(item?.price) || 0;
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
  getChannelPrice,
  isStoreOpen,
  isClosedForToday,
  isItemAvailableNow,
  getEffectivePrice,
  isWithinWindow,
  nowInTimezone,
  toMinutes,
};
