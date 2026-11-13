/**
 * Popular Items on the tills (Settings > Device Configuration): how many are
 * shown, the dishes pinned first in the owner's order, and whether best
 * sellers fill the places the pinned ones leave. Stored in posSettings.
 */
const POPULAR_MIN = 2;
const POPULAR_MAX = 48;
const POPULAR_DEFAULT = 12;

/** Dish ids as sent by the screen: ObjectId-shaped, each once, at most POPULAR_MAX. */
const cleanPopularIds = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const v of value) {
    const id = String(v || "").trim();
    if (/^[a-f0-9]{24}$/i.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= POPULAR_MAX) break;
  }
  return out;
};

/** The settings with every field present, for a restaurant saved before they existed. */
const popularSettingsOf = (restaurant) => {
  const s = (restaurant && restaurant.posSettings) || {};
  const ids = cleanPopularIds(s.popularItemIds);
  const n = Math.round(Number(s.popularCount));
  const count = Number.isFinite(n) && n > 0 ? Math.min(POPULAR_MAX, Math.max(POPULAR_MIN, n)) : POPULAR_DEFAULT;
  return {
    // Every pinned dish is shown: the count never hides one of them.
    popularCount: Math.max(count, ids.length),
    popularItemIds: ids,
    popularFill: s.popularFill !== false,
  };
};

/**
 * The Popular Items list: the pinned dishes first, in their order (any no
 * longer on the menu skipped), then -- when filling is on -- `ranked` (best
 * sellers, then the menu's own fallbacks) up to `count`. `byId` maps a dish id
 * to the dish; `ranked` is a list of dishes, best first.
 */
const buildPopularList = ({ pinnedIds = [], byId, ranked = [], count, fill = true }) => {
  const seen = new Set();
  const out = [];
  for (const id of pinnedIds) {
    const dish = byId.get(String(id));
    if (!dish || seen.has(String(id))) continue;
    seen.add(String(id));
    out.push({ ...dish, pinned: true });
    if (out.length >= count) return out;
  }
  if (!fill && pinnedIds.length) return out;
  for (const dish of ranked) {
    const key = String(dish._id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dish);
    if (out.length >= count) break;
  }
  return out;
};

module.exports = { POPULAR_MIN, POPULAR_MAX, POPULAR_DEFAULT, cleanPopularIds, popularSettingsOf, buildPopularList };
