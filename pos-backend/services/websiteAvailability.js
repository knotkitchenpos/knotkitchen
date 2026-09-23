/**
 * Is the restaurant website open for a channel at a moment?
 *
 * One rule for all three website channels, in this order:
 *
 *   1. Holiday      -- a date inside any Holiday Calendar range closes all.
 *   2. Close for Today -- closes everything for that date only. It stores the
 *                      date it was switched on, so the next day it no longer
 *                      matches and the website opens by itself.
 *   3. Timing       -- the channel's own weekly hours from Website Timing:
 *                        collection  Collection Time
 *                        delivery    Delivery Time
 *                        table       Restaurant Time (table bookings)
 *                      A channel with no hours saved is open all day.
 *
 * Everything is evaluated in the restaurant's timezone; the server is UTC.
 */
const { localDate, formatTime } = require("./tableBookings");

const DEFAULT_TZ = "Asia/Kolkata";

const LABELS = {
  collection: "Collection",
  delivery: "Delivery",
  table: "Table booking",
};

const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Restaurant-local date, weekday and minute-of-day for an instant. */
const localClock = (date, timeZone = DEFAULT_TZ) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const ymd = localDate(date, timeZone);
  return {
    ymd,
    day: new Date(`${ymd}T00:00:00Z`).getUTCDay(),
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
};

/** Holidays are saved from a date picker, i.e. UTC midnight of the chosen day. */
const isoDay = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

const holidayOn = (settings, ymd) =>
  (settings?.holidays || []).find((h) => {
    const start = isoDay(h.startDate);
    const end = isoDay(h.endDate) || start;
    return start && ymd >= start && ymd <= end;
  }) || null;

const closedForTodayOn = (settings, ymd) =>
  Boolean(settings?.closedForToday?.enabled && settings.closedForToday.date === ymd);

const entryFor = (weekly, day) => (weekly || []).find((w) => Number(w.day) === day) || null;

/**
 * The open windows on a local date, in minutes, including the tail of the
 * previous day's overnight shift. `null` when the channel has no hours saved.
 */
const windowsOn = (settings, channel, ymd) => {
  const weekly = settings?.channelHours?.[channel]?.weekly;
  if (!Array.isArray(weekly) || weekly.length === 0) return null;

  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  const windows = [];

  const today = entryFor(weekly, day);
  if (today?.isOpen) {
    const open = toMinutes(today.openTime);
    const close = toMinutes(today.closeTime);
    if (open != null && close != null) {
      if (close > open) windows.push({ from: open, to: close });
      else if (close === open) windows.push({ from: 0, to: 24 * 60 });
      else windows.push({ from: open, to: 24 * 60 }); // runs past midnight
    }
  }

  const yesterday = entryFor(weekly, (day + 6) % 7);
  if (yesterday?.isOpen) {
    const open = toMinutes(yesterday.openTime);
    const close = toMinutes(yesterday.closeTime);
    if (open != null && close != null && close < open) windows.push({ from: 0, to: close });
  }

  return windows.sort((a, b) => a.from - b.from);
};

const hhmm = (minutes) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * @returns {{ open: boolean, kind: ""|"holiday"|"closedToday"|"hours", reason: string, windows: {from,to}[]|null }}
 */
const availabilityAt = (settings, channel, at = new Date(), timeZone = DEFAULT_TZ) => {
  const { ymd, minutes } = localClock(at, timeZone || DEFAULT_TZ);
  const label = LABELS[channel] || "Ordering";

  const holiday = holidayOn(settings, ymd);
  if (holiday) {
    return { open: false, kind: "holiday", reason: `The restaurant is closed for a holiday. ${label} is unavailable.`, windows: [] };
  }
  if (closedForTodayOn(settings, ymd)) {
    return { open: false, kind: "closedToday", reason: `The restaurant is closed for today. ${label} is unavailable.`, windows: [] };
  }

  const windows = windowsOn(settings, channel, ymd);
  if (windows === null) return { open: true, kind: "", reason: "", windows: null };

  if (windows.some((w) => minutes >= w.from && minutes < w.to)) {
    return { open: true, kind: "", reason: "", windows };
  }

  const hoursText = windows.length
    ? windows.map((w) => `${formatTime(hhmm(w.from))} – ${formatTime(hhmm(w.to))}`).join(", ")
    : "";
  return {
    open: false,
    kind: "hours",
    reason: hoursText ? `${label} is available ${hoursText} today.` : `${label} is not available today.`,
    windows,
  };
};

/** All three channels right now, for the storefront payload. */
const websiteAvailability = (settings, timeZone = DEFAULT_TZ, at = new Date()) => ({
  collection: availabilityAt(settings, "collection", at, timeZone),
  delivery: availabilityAt(settings, "delivery", at, timeZone),
  table: availabilityAt(settings, "table", at, timeZone),
});

module.exports = {
  availabilityAt,
  websiteAvailability,
  windowsOn,
  holidayOn,
  closedForTodayOn,
  localClock,
};
