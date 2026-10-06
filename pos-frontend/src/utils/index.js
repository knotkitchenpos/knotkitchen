export const getAvatarName = (name) => {
  if(!name) return "";

  return name.split(" ").map(word => word[0]).join("").toUpperCase();

}

/*
 * Money and dates, one definition each. Two money shapes exist on purpose:
 * the till screens print "₹1234.50" (no grouping), receipts and cash
 * reports print "₹1,234.50" (Indian grouping); the receipt test pins the
 * second. Pick by screen, never re-declare.
 */

/** "₹1234.50" -- two decimals, no grouping. `symbol` for the QR/online pages that carry their own. */
export const money = (n, symbol = "₹") => `${symbol}${(Number(n) || 0).toFixed(2)}`;

/** "₹1,234.50" -- Indian grouping, two decimals. */
export const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The store's time zone. Every helper below that formats an INSTANT passes
 * it, so a till whose device clock is set to London still shows the store's
 * clock, order times and "today". Browsers, Capacitor and Electron on Windows
 * have no process-wide TZ switch, so the zone has to travel with each call.
 *
 * ponytail: one zone for every store (all are in India today). If a store
 * outside India signs up, read Restaurant.timezone (already on the model,
 * default Asia/Kolkata) here instead.
 */
export const STORE_TZ = "Asia/Kolkata";

/** "17 Sep 2026" */
export const dateGB = (d) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: STORE_TZ });

/** "02:45 PM" */
export const time12 = (d) =>
  new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: STORE_TZ });

/** "2:45 pm", or "" when there is no date. */
export const timeIN = (d) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: STORE_TZ }) : "";

/** "17 Sep, 02:45 pm", or "" when there is no date. */
export const dateTimeIN = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: STORE_TZ }) : "";

// Assembled from parts: a locale's own short-date pattern (en-CA's has
// changed between ICU releases) is not a format to rely on.
const storeParts = new Intl.DateTimeFormat("en-US", {
  timeZone: STORE_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const partsOf = (d) => Object.fromEntries(storeParts.formatToParts(new Date(d)).map((p) => [p.type, p.value]));

/** The STORE's YYYY-MM-DD for an instant (default now): "today" for reports, filters and bookings. */
export const localDay = (d = new Date()) => {
  const p = partsOf(d);
  return `${p.year}-${p.month}-${p.day}`;
};

/**
 * YYYY-MM-DD of a Date built from year/month/day on this device (a calendar
 * cell, a date-strip chip). Those are device-local midnights, so reading them
 * in the store's zone would shift the day on devices east of India.
 */
export const cellDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The store's weekday (0 = Sunday, like getDay) and minutes past midnight,
 * for dish schedules and timed prices. Mirrors the backend's
 * services/websiteAvailability.localClock.
 */
export const storeClock = (d = new Date()) => {
  const p = partsOf(d);
  return {
    day: new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`).getUTCDay(),
    minutes: (Number(p.hour) % 24) * 60 + Number(p.minute),
  };
};

/**
 * A small copy of an uploaded photo for grids and thumbnails: the backend
 * makes `?w=160|320|640` versions (pos-backend/middlewares/imageThumbnail.js).
 * Full-size 1254px photos in the product grid ran a low-end tablet out of
 * image memory. Other URLs are returned unchanged.
 */
export const thumbUrl = (url, w) =>
  typeof url === "string" && /\/uploads\/[^?#]+\.(webp|png|jpe?g)$/i.test(url) ? `${url}?w=${w}` : url;
