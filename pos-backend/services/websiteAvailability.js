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
 *                      A channel with no hours saved uses DEFAULT_HOURS, the
 *                      times the POS Website Timing screen shows for it.
 *
 * Everything is evaluated in the restaurant's timezone; the server is UTC.
 */
const { localDate, formatTime } = require("./tableBookings");

const DEFAULT_TZ = "Asia/Kolkata";

// Customer-facing (website checkout and the store page): the website calls
// collection "Pickup".
const LABELS = {
  collection: "Pickup",
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
 * The hours a channel with nothing saved runs on: exactly what the POS Website
 * Timing & Holidays screen shows for it (pos-frontend TimingsHolidaysView).
 * Treating "nothing saved" as open all day made the website say "Pickup open
 * all day" while the POS showed the store 4:00 PM - 11:50 PM.
 */
const DEFAULT_HOURS = Object.freeze({ openTime: "16:00", closeTime: "23:50" });
const DEFAULT_WEEK = Object.freeze(
  [0, 1, 2, 3, 4, 5, 6].map((day) => Object.freeze({ day, isOpen: true, ...DEFAULT_HOURS })),
);

/** The week a channel runs on: what the store saved, else DEFAULT_WEEK. */
const weeklyFor = (settings, channel) => {
  const weekly = settings?.channelHours?.[channel]?.weekly;
  return Array.isArray(weekly) && weekly.length ? weekly : DEFAULT_WEEK;
};

/**
 * A day's time slots: its main hours, then any extra slots added with "Add
 * Hour" in the POS (`periods`). Empty when the day is closed.
 */
const slotsOf = (entry) =>
  entry?.isOpen
    ? [entry, ...(Array.isArray(entry.periods) ? entry.periods : [])]
        .filter((s) => toMinutes(s?.openTime) != null && toMinutes(s?.closeTime) != null)
        .map((s) => ({ openTime: s.openTime, closeTime: s.closeTime }))
    : [];

/** "4:00 PM – 1:50 AM": a day's hours as the store set them, never split at midnight. */
const dayRange = (entry) =>
  slotsOf(entry)
    .map((s) => `${formatTime(s.openTime)} – ${formatTime(s.closeTime)}`)
    .join(", ");

/**
 * The open windows on a local date, in minutes, including the tail of the
 * previous day's overnight shift.
 */
const windowsOn = (settings, channel, ymd) => {
  const weekly = weeklyFor(settings, channel);
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  const windows = [];

  for (const slot of slotsOf(entryFor(weekly, day))) {
    const open = toMinutes(slot.openTime);
    const close = toMinutes(slot.closeTime);
    if (close > open) windows.push({ from: open, to: close });
    else if (close === open) windows.push({ from: 0, to: 24 * 60 });
    else windows.push({ from: open, to: 24 * 60 }); // runs past midnight
  }

  for (const slot of slotsOf(entryFor(weekly, (day + 6) % 7))) {
    const open = toMinutes(slot.openTime);
    const close = toMinutes(slot.closeTime);
    if (close < open) windows.push({ from: 0, to: close });
  }

  return windows.sort((a, b) => a.from - b.from);
};

const dayBefore = (ymd) => new Date(Date.parse(`${ymd}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** Is minute-of-day `minutes` inside the after-midnight tail of a slot that opened on `prevYmd`? */
const inTailOf = (settings, channel, prevYmd, minutes) =>
  slotsOf(entryFor(weeklyFor(settings, channel), new Date(`${prevYmd}T00:00:00Z`).getUTCDay())).some(
    (s) => toMinutes(s.closeTime) < toMinutes(s.openTime) && minutes < toMinutes(s.closeTime),
  );

const shut = (kind, label) => ({
  open: false,
  kind,
  reason:
    kind === "holiday"
      ? `The restaurant is closed for a holiday. ${label} is unavailable.`
      : `The restaurant is closed for today. ${label} is unavailable.`,
  windows: [],
});

/**
 * @returns {{ open: boolean, kind: ""|"holiday"|"closedToday"|"hours", reason: string, windows: {from,to}[]|null }}
 */
const availabilityAt = (settings, channel, at = new Date(), timeZone = DEFAULT_TZ) => {
  const { ymd, minutes } = localClock(at, timeZone || DEFAULT_TZ);
  const label = LABELS[channel] || "Ordering";

  if (holidayOn(settings, ymd)) return shut("holiday", label);
  if (closedForTodayOn(settings, ymd)) return shut("closedToday", label);
  // H2: after midnight, last night's shift is still yesterday's, so yesterday's holiday or Close for Today shuts its tail too.
  const prev = dayBefore(ymd);
  const prevKind = holidayOn(settings, prev) ? "holiday" : closedForTodayOn(settings, prev) ? "closedToday" : "";
  if (prevKind && inTailOf(settings, channel, prev, minutes)) return shut(prevKind, label);

  const windows = windowsOn(settings, channel, ymd);
  if (windows.some((w) => minutes >= w.from && minutes < w.to)) {
    return { open: true, kind: "", reason: "", windows };
  }

  // Today's hours as the store set them ("4:00 PM – 1:50 AM"), not the
  // midnight-split windows ("12:00 AM – 1:50 AM, 4:00 PM – 12:00 AM").
  const hoursText = dayRange(entryFor(weeklyFor(settings, channel), localClock(at, timeZone || DEFAULT_TZ).day));
  return {
    open: false,
    kind: "hours",
    reason: hoursText ? `${label} is available ${hoursText} today.` : `${label} is not available today.`,
    windows,
  };
};

/** A channel's week, Sunday first: what the store saved in Website Timing, else DEFAULT_WEEK. */
const weekOf = (settings, channel) => {
  const weekly = weeklyFor(settings, channel);
  return [0, 1, 2, 3, 4, 5, 6].map((day) => {
    const [main, ...periods] = slotsOf(entryFor(weekly, day));
    return main
      ? { day, isOpen: true, openTime: main.openTime, closeTime: main.closeTime, periods }
      : { day, isOpen: false, openTime: "", closeTime: "", periods: [] };
  });
};

/**
 * Website Timing & Holidays as the website shows them: the week of every
 * channel the restaurant offers online, and the holidays still ahead. The
 * same saved hours availabilityAt enforces, so what the page says is what
 * checkout allows.
 */
const publicHours = (settings, timeZone = DEFAULT_TZ, at = new Date()) => {
  const clock = localClock(at, timeZone || DEFAULT_TZ);
  const today = clock.ymd;
  const ordering = settings?.ordering || {};
  const channels = [];
  if (ordering.pickupEnabled !== false) channels.push("collection");
  if (ordering.deliveryEnabled === true) channels.push("delivery");
  if (ordering.tableBooking?.enabled !== false) channels.push("table");
  const holidays = (settings?.holidays || [])
    .map((h) => {
      const start = isoDay(h.startDate);
      return { start, end: isoDay(h.endDate) || start, reason: String(h.reason || "").slice(0, 120) };
    })
    .filter((h) => h.start && h.end >= today)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .slice(0, 5);
  const weekly = settings?.channelHours || {};
  const holidayToday = holidayOn(settings, today);
  return {
    // saved: false while the store has not saved this channel's hours in the
    // POS (DEFAULT_WEEK applies).
    channels: channels.map((key) => ({
      key,
      week: weekOf(settings, key),
      saved: Array.isArray(weekly[key]?.weekly) && weekly[key].weekly.length > 0,
    })),
    // The store's weekday today, so "today's hours" never depend on the
    // visitor's clock, and why everything is shut today if it is.
    today: clock.day,
    closedToday: holidayToday
      ? holidayToday.reason || "Closed for a holiday"
      : closedForTodayOn(settings, today)
        ? settings.closedForToday.reason || "Closed for today"
        : "",
    holidays,
  };
};

/** A channel's hours on a local date as the store set them: "4:00 PM – 1:50 AM", or "Closed". */
const hoursOnLabel = (settings, channel, ymd) => {
  if (holidayOn(settings, ymd) || closedForTodayOn(settings, ymd)) return "Closed";
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return dayRange(entryFor(weeklyFor(settings, channel), day)) || "Closed";
};

/** All three channels right now, for the storefront payload. */
const websiteAvailability = (settings, timeZone = DEFAULT_TZ, at = new Date()) => ({
  collection: availabilityAt(settings, "collection", at, timeZone),
  delivery: availabilityAt(settings, "delivery", at, timeZone),
  table: availabilityAt(settings, "table", at, timeZone),
});

/**
 * H1: open for online orders when a channel the store offers is open. An
 * unoffered channel still has (default) hours, so it must not count.
 * `a` is websiteAvailability()'s answer.
 */
const orderingOpen = (settings, a) => {
  const offered = [
    settings?.ordering?.pickupEnabled !== false && a.collection,
    settings?.ordering?.deliveryEnabled === true && a.delivery,
  ].filter(Boolean);
  if (!offered.length) return { open: false, reason: "This store is not taking online orders." };
  const open = offered.some((c) => c.open);
  return { open, reason: open ? "" : offered[0].reason };
};

/**
 * The trading day a moment belongs to, "YYYY-MM-DD": yesterday's local date
 * while a shift that opened yesterday (any channel) runs past midnight, else
 * today's. Close for Today stores this (D14).
 */
const businessDate = (settings, at = new Date(), timeZone = DEFAULT_TZ) => {
  const { ymd, minutes } = localClock(at, timeZone || DEFAULT_TZ);
  const prev = dayBefore(ymd);
  return ["collection", "delivery", "table"].some((c) => inTailOf(settings, c, prev, minutes)) ? prev : ymd;
};

module.exports = {
  availabilityAt,
  websiteAvailability,
  orderingOpen,
  businessDate,
  publicHours,
  hoursOnLabel,
  windowsOn,
  holidayOn,
  closedForTodayOn,
  localClock,
  DEFAULT_HOURS,
};
