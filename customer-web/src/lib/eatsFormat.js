// Display strings for Knot Eats lists and cards. Pure (no React, no storage),
// so `node --test` covers it: eatsFormat.test.mjs.

const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** "₹1,250" in Indian digit grouping. */
export const inr = (n) => `₹${num.format(Number(n) || 0)}`;

// The server shows an average only from this many visible reviews (§6.4); a
// stray lower count is still "New" here so one 1-star review never paints red.
const MIN_RATINGS = 3;

/** { min: 35, max: 45 } -> "35-45 mins". */
export function etaLabel(eta) {
  if (!eta || !Number.isFinite(eta.min)) return "";
  return Number.isFinite(eta.max) && eta.max > eta.min ? `${eta.min}-${eta.max} mins` : `${eta.min} mins`;
}

/**
 * "850 m", "2.1 km", or "~2.1 km" when the server fell back to a straight
 * line (no Maps key, no route, budget spent): the ~ says it is a guess.
 */
export function distanceLabel(km, source) {
  if (km === null || km === undefined || km === "" || !Number.isFinite(Number(km))) return "";
  const n = Number(km);
  const m = Math.round(n * 100) * 10;
  const text = m < 1000 ? `${m} m` : n >= 10 ? `${Math.round(n)} km` : `${n.toFixed(1)} km`;
  return source === "straight_line" ? `~${text}` : text;
}

/** What the rating badge shows and what a screen reader hears. */
export function ratingView(rating, count) {
  const n = Number(count) || 0;
  const r = Number(rating);
  if (rating === null || rating === undefined || !Number.isFinite(r) || n < MIN_RATINGS) {
    return { text: "New", label: "New on Knot Eats", tone: "new" };
  }
  return {
    text: r.toFixed(1),
    label: `Rated ${r.toFixed(1)} out of 5 from ${num.format(n)} ratings`,
    tone: r >= 4 ? "good" : r >= 3 ? "ok" : "bad",
  };
}

/** "₹400 for two"; nothing when the store has no priced dishes. */
export const costLabel = (n) => (Number(n) > 0 ? `${inr(n)} for two` : "");

/** "Biryani, Rolls, Chicken": the card's top dish tags, with config labels. */
export function tagText(tags, dishTags = []) {
  const labels = new Map((dishTags || []).map((t) => [t.tag, t.label]));
  const human = (t) => (t.charAt(0).toUpperCase() + t.slice(1)).replace(/-/g, " ");
  return (tags || []).slice(0, 3).map((t) => labels.get(t) || human(String(t))).join(", ");
}

/**
 * Why delivery is off on a store page, or "" when it is allowed. An area chip
 * is a centroid, fine for browsing but not a door to deliver to (§3.3).
 */
export function deliveryBlockReason(delivery, location) {
  if (!location) return "Set your delivery location to get delivery";
  if (location.source === "area") return "Set your exact location to get delivery";
  if (delivery && delivery.deliverable === false) return delivery.reason || "This restaurant can't deliver to you.";
  return "";
}
