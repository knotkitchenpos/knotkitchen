// Knot Eats list filters: the URL query <-> a filters object <-> the
// GET /api/eats/stores params (contract §3.4). Filters live in the URL so a
// filtered list can be shared and survives Back; the location never does.
// Pure, so `node --test` covers it: eatsFilters.test.mjs.

export const SORTS = [
  { key: "relevance", label: "Relevance" },
  { key: "distance", label: "Distance" },
  { key: "eta", label: "Delivery time" },
  { key: "rating", label: "Rating: high to low" },
  { key: "cost_asc", label: "Cost: low to high" },
  { key: "cost_desc", label: "Cost: high to low" },
];

export const RATINGS = [3.5, 4];

// Cost for two. priceForTwo is rounded to ₹50, so the edges are made
// exclusive here: ₹300 is in the middle bucket only.
export const COST_BUCKETS = [
  { key: "lt300", label: "< ₹300", costMax: 299 },
  { key: "300-600", label: "₹300–600", costMin: 300, costMax: 600 },
  { key: "gt600", label: "> ₹600", costMin: 601 },
];

export const DEFAULT_FILTERS = Object.freeze({
  q: "",
  tag: "",
  maxPrice: 0,
  sort: "relevance",
  fast: false,
  minRating: 0,
  offers: false,
  pureVeg: false,
  cost: "",
});

/** What the search box puts in ?q=: trimmed, at most 40 characters. */
export const searchQuery = (text) => text.trim().slice(0, 40);

/**
 * The search box once ?q= changes. Its own debounced write leaves it alone (a
 * trailing space survives); a dish chip, Back or a link puts the URL's query
 * in it, so the debounce cannot write the old text back over them.
 */
export const syncSearchText = (text, q) => (searchQuery(text) === q ? text : q);

/** Anything unknown or malformed falls back to its default, as the server does. */
export function readFilters(sp) {
  const get = (k) => (sp && sp.get(k)) || "";
  const maxPrice = Math.round(Number(get("maxPrice")));
  const minRating = Number(get("minRating"));
  return {
    q: searchQuery(get("q")),
    tag: /^[a-z0-9-]{1,30}$/.test(get("tag")) ? get("tag") : "",
    maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : 0,
    sort: SORTS.some((s) => s.key === get("sort")) ? get("sort") : "relevance",
    fast: get("fast") === "1",
    minRating: RATINGS.includes(minRating) ? minRating : 0,
    offers: get("offers") === "1",
    pureVeg: get("pureVeg") === "1",
    cost: COST_BUCKETS.some((b) => b.key === get("cost")) ? get("cost") : "",
  };
}

/** The query string for a filters object; defaults are left out. */
export function filtersToSearch(f) {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.tag) sp.set("tag", f.tag);
  if (f.maxPrice) sp.set("maxPrice", String(f.maxPrice));
  if (f.sort && f.sort !== "relevance") sp.set("sort", f.sort);
  if (f.fast) sp.set("fast", "1");
  if (f.minRating) sp.set("minRating", String(f.minRating));
  if (f.offers) sp.set("offers", "1");
  if (f.pureVeg) sp.set("pureVeg", "1");
  if (f.cost) sp.set("cost", f.cost);
  return sp.toString();
}

const r3 = (x) => Math.round(Number(x) * 1000) / 1000;

/**
 * GET /api/eats/stores params, or null with no location (nothing is fetched
 * until there is one, §10.7). lat/lng go out rounded to 3 dp (~110 m): the
 * server rounds again, and a browse point never needs to be exact.
 */
export function toApiParams({ filters = DEFAULT_FILTERS, location, mode, veg, page = 1 }) {
  if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) return null;
  const f = { ...DEFAULT_FILTERS, ...filters };
  const p = { lat: r3(location.lat), lng: r3(location.lng), mode: mode === "pickup" ? "pickup" : "delivery" };
  if (f.sort !== "relevance") p.sort = f.sort;
  if (veg) p.veg = 1;
  if (f.pureVeg) p.pureVeg = 1;
  if (f.minRating) p.minRating = f.minRating;
  if (f.offers) p.offers = 1;
  const bucket = COST_BUCKETS.find((b) => b.key === f.cost);
  if (bucket?.costMin !== undefined) p.costMin = bucket.costMin;
  if (bucket?.costMax !== undefined) p.costMax = bucket.costMax;
  if (f.fast) p.fast = 1;
  if (f.tag) p.tag = f.tag;
  if (f.maxPrice) p.maxPrice = f.maxPrice;
  if (f.q.length >= 2) p.q = f.q;
  if (page > 1) p.page = page;
  return p;
}

/** The badge on the Filters chip: what narrows the list, not what names it. */
export const activeFilterCount = (f) =>
  [f.sort && f.sort !== "relevance", f.fast, f.minRating, f.offers, f.pureVeg, f.cost].filter(Boolean).length;
