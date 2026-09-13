/**
 * Table booking time rules, kept free of Express and Mongoose so they can be
 * tested directly.
 *
 * All wall-clock values ("17:00", "2026-09-14") are in the restaurant's own
 * timezone. The server runs in UTC, so every conversion goes through the IANA
 * zone rather than the process clock -- a 5 PM booking in Kolkata is 11:30 UTC.
 */

const DEFAULT_TZ = "Asia/Kolkata";
const BOOKING_DAYS_AHEAD = 7;

const DEFAULTS = Object.freeze({
  enabled: true,
  openTime: "16:00",
  closeTime: "22:00",
  slotMinutes: 30,
  holdBeforeMinutes: 30,
  releaseAfterMinutes: 60,
});

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const toMinutes = (hhmm) => {
  const m = HHMM.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const toHHMM = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const clampInt = (value, min, max, fallback) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** The store's booking settings, with every missing or bad value defaulted. */
const bookingConfig = (settings) => {
  const raw = settings?.ordering?.tableBooking || {};
  const openTime = toMinutes(raw.openTime) != null ? raw.openTime : DEFAULTS.openTime;
  let closeTime = toMinutes(raw.closeTime) != null ? raw.closeTime : DEFAULTS.closeTime;
  if (toMinutes(closeTime) < toMinutes(openTime)) closeTime = openTime;
  return {
    enabled: raw.enabled !== false,
    openTime,
    closeTime,
    slotMinutes: clampInt(raw.slotMinutes, 5, 240, DEFAULTS.slotMinutes),
    holdBeforeMinutes: clampInt(raw.holdBeforeMinutes, 0, 24 * 60, DEFAULTS.holdBeforeMinutes),
    releaseAfterMinutes: clampInt(raw.releaseAfterMinutes, 0, 24 * 60, DEFAULTS.releaseAfterMinutes),
  };
};

/** Milliseconds `timeZone` is ahead of UTC at instant `date`. */
const zoneOffsetMs = (date, timeZone) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/** The instant a restaurant-local date and time happens. */
const zonedInstant = (ymd, hhmm, timeZone = DEFAULT_TZ) => {
  if (!YMD.test(String(ymd)) || toMinutes(hhmm) == null) return null;
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(guess)) return null;
  // Twice, so a guess that lands across a DST change settles on the right side.
  let t = guess - zoneOffsetMs(new Date(guess), timeZone);
  t = guess - zoneOffsetMs(new Date(t), timeZone);
  return new Date(t);
};

/** "2026-09-14" for `date` as seen in `timeZone`. */
const localDate = (date, timeZone = DEFAULT_TZ) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/** The dates a customer may book: today and the next six days. */
const bookableDates = (now = new Date(), timeZone = DEFAULT_TZ) => {
  const out = [];
  for (let i = 0; i < BOOKING_DAYS_AHEAD; i += 1) {
    out.push(localDate(new Date(now.getTime() + i * 86400000), timeZone));
  }
  return [...new Set(out)];
};

/** Times offered on `ymd`, from opening to closing inclusive, future ones only. */
const slotsFor = (config, ymd, { now = new Date(), timeZone = DEFAULT_TZ } = {}) => {
  const open = toMinutes(config.openTime);
  const close = toMinutes(config.closeTime);
  const slots = [];
  for (let m = open; m <= close; m += config.slotMinutes) {
    const hhmm = toHHMM(m);
    const at = zonedInstant(ymd, hhmm, timeZone);
    if (at && at.getTime() > now.getTime()) slots.push(hhmm);
  }
  return slots;
};

/** When the table stops taking new orders for a booking, and when it is let go. */
const blockWindow = (startAt, config) => ({
  blockFrom: new Date(startAt.getTime() - config.holdBeforeMinutes * 60000),
  blockUntil: new Date(startAt.getTime() + config.releaseAfterMinutes * 60000),
});

/** Mongo filter: confirmed bookings on a table whose block overlaps [from, until). */
const overlappingBlockQuery = ({ tableId, from, until }) => ({
  tableId,
  status: "CONFIRMED",
  isDeleted: { $ne: true },
  blockFrom: { $lt: until },
  blockUntil: { $gt: from },
});

/** "5:00 PM" for a restaurant-local "17:00". */
const formatTime = (hhmm) => {
  const minutes = toMinutes(hhmm);
  if (minutes == null) return String(hhmm || "");
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

module.exports = {
  DEFAULT_TZ,
  DEFAULTS,
  bookingConfig,
  zonedInstant,
  localDate,
  bookableDates,
  slotsFor,
  blockWindow,
  overlappingBlockQuery,
  formatTime,
  toMinutes,
};
