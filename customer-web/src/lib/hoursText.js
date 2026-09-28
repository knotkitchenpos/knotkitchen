/**
 * Website Timing & Holidays, worded for the store page.
 *
 * The storefront sends `hours` (each channel the restaurant offers online,
 * with its saved week, and the holidays still ahead) and `availability`
 * (whether each channel is open right now and today's windows). Both come
 * from the hours checkout enforces (pos-backend/services/websiteAvailability),
 * so the page never shows times the restaurant will refuse an order in.
 */

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** What the customer calls each channel. "Collection" in the POS is "Pickup" here, as on the chips. */
export const CHANNEL_LABEL = { collection: "Pickup", delivery: "Delivery", table: "Table booking" };

/** "21:30" -> "9:30 pm". Locale-free, so every browser prints the same. */
export const time12 = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return String(hhmm || "");
  const h = Number(m[1]) % 24;
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
};

const fromMinutes = (minutes) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const range = (from, to) => `${time12(from)} – ${time12(to)}`;

/** An open day's slots: "11:00 am – 3:00 pm, 6:00 pm – 11:00 pm" (extra slots come from Add Hour in the POS). */
const dayText = (d) => [d, ...(d.periods || [])].map((s) => range(s.openTime, s.closeTime)).join(", ");

/** "Pickup", "Pickup & Delivery", "Pickup, Delivery & Table booking". */
const joinLabels = (labels) =>
  labels.length <= 1 ? labels[0] || "" : `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}`;

/**
 * Today's hours for the channels that take orders (table booking is a
 * booking, not an order): [{ key, label, text }].
 *
 * Read from today's saved day, so 4 pm – 2 am reads as one range rather than
 * the midnight-split windows. Older payloads without `hours.today` fall back
 * to those windows.
 */
export const todayLines = (hours, availability) =>
  (hours?.channels || [])
    .filter((c) => c.key !== "table")
    .map((c) => {
      let text;
      if (hours.today != null && c.week) {
        const d = c.week[hours.today];
        text = hours.closedToday || !d?.isOpen ? "closed today" : dayText(d);
      } else {
        const windows = availability?.[c.key]?.windows;
        text =
          windows == null
            ? "open all day"
            : windows.length === 0
              ? "closed today"
              : windows.map((w) => range(fromMinutes(w.from), fromMinutes(w.to))).join(", ");
      }
      return { key: c.key, label: CHANNEL_LABEL[c.key] || c.key, text };
    });

/**
 * One weekly list per channel, channels with the same week merged into one:
 * [{ title, days: [{ day, text }] | null }]. A channel with no hours saved
 * comes with the POS default week, so `days` is null only on older payloads.
 */
export const weekGroups = (hours) => {
  const groups = [];
  for (const c of hours?.channels || []) {
    const sig = JSON.stringify(c.week);
    const same = groups.find((g) => g.sig === sig);
    if (same) same.labels.push(CHANNEL_LABEL[c.key] || c.key);
    else groups.push({ sig, labels: [CHANNEL_LABEL[c.key] || c.key], week: c.week });
  }
  return groups.map((g) => ({
    title: `${joinLabels(g.labels)} hours`,
    days: g.week
      ? g.week.map((d) => ({ day: DAYS[d.day], text: d.isOpen ? dayText(d) : "Closed" }))
      : null,
  }));
};

const shortDate = (ymd) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
};

/** "20 Oct – 22 Oct · Durga Puja" */
export const holidayText = (h) =>
  [h.start === h.end ? shortDate(h.start) : `${shortDate(h.start)} – ${shortDate(h.end)}`, h.reason]
    .filter(Boolean)
    .join(" · ");
