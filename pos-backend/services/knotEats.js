const createHttpError = require("http-errors");
const WebsiteSettings = require("../models/websiteSettingsModel");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const Menu = require("../models/menuModel");
const KnotEatsReview = require("../models/knotEatsReviewModel");
const { AUDIENCES, projectMenus } = require("./menuCache");
const { availabilityAt } = require("./websiteAvailability");
const { haversineKm, roadDistances, computeDeliveryFeeFromSlabs } = require("./distanceService");
const { unavailableReason } = require("./storefrontResolver");
const { isOnlinePaymentEnabled } = require("./paymentGateway");
const { toRupees } = require("./money");
const config = require("../config/config");
// Lazy: these load the order/billing stacks (and storefrontController lazily
// requires this module), so they are resolved per call.
const storefront = () => require("../controllers/storefrontController");
const pricingRules = () => require("./orderPricingService");
const orderCharge = () => require("./orderCharge");

/**
 * Knot Eats (eats.<base>): the marketplace read layer over KnotKitchen stores.
 *
 * One in-process snapshot holds every listed store with its published dishes
 * and rating aggregate. It is rebuilt at most every 5 minutes, single-flight,
 * and on any relevant write (invalidateListing), and a failed rebuild keeps
 * serving the previous one. There is deliberately no dish collection and no
 * rating counter to keep in step: the snapshot recomputes both from source.
 *
 * ponytail: per-process, all listed stores' dishes in memory (~200 B/dish);
 * move to a collection when listed stores > ~300 or pos-api scales out.
 *
 * Nothing here returns restaurantId, a store's own pin, owner details, gateway
 * fields or fee internals to the public; the projections below are whitelists.
 */

const BROWSE_KM = 15;
const SHORTLIST_MAX = 60;
const MIN_RATINGS_TO_SHOW = 3;
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const MAX_DISHES_PER_STORE = 500;
const CARD_DISHES = 5;
const REVIEWS_PAGE = 20;

const DISH_TAGS = Object.freeze(
  [
    ["biryani", "Biryani", "biryani|biriyani"],
    ["momo", "Momos", "momos?|dim ?sums?"],
    ["chicken", "Chicken", "chicken"],
    ["paneer", "Paneer", "paneer"],
    ["pizza", "Pizza", "pizzas?"],
    ["burger", "Burger", "burgers?"],
    ["roll", "Rolls", "rolls?|kathi|wraps?"],
    ["noodles", "Noodles", "noodles?|chow ?mein|hakka"],
    ["fried-rice", "Fried Rice", "fried ?rice"],
    ["thali", "Thali", "thalis?"],
    ["dosa", "Dosa", "dosas?|idlis?|uttapams?"],
    ["cake", "Cakes", "cakes?|pastr(?:y|ies)"],
    ["shake", "Shakes", "shakes?|smoothies?"],
    ["tea-coffee", "Tea & Coffee", "tea|chai|coffee"],
    ["ice-cream", "Ice Cream", "ice ?creams?"],
    ["sandwich", "Sandwich", "sandwich(?:es)?"],
    ["pasta", "Pasta", "pastas?"],
    ["kebab", "Kebab", "kebabs?|kababs?|tikka"],
    ["fish", "Fish", "fish|prawns?|crabs?"],
    ["mutton", "Mutton", "mutton|lamb"],
    ["egg", "Egg", "eggs?|omelettes?"],
  ].map(([tag, label, words]) => Object.freeze({ tag, label, re: new RegExp(`\\b(?:${words})\\b`, "i") })),
);

const COLLECTIONS = Object.freeze([Object.freeze({ key: "under-250", title: "Meals under ₹250", maxPrice: 250 })]);

const BLOCKER_MESSAGES = Object.freeze({
  NOT_OPTED_IN: "Turn on Knot Eats to list your restaurant.",
  DELISTED: "KnotKitchen has delisted your restaurant from Knot Eats. Contact support.",
  ACCOUNT_LOCKED: "Your account is locked. Recharge to list on Knot Eats.",
  STORE_STATUS: "Your store is closed or suspended.",
  NO_FSSAI: "Add your 14-digit FSSAI licence number in Settings > Store Properties.",
  NO_GATEWAY: "Set up online payment (Cashfree) in Settings > Store Properties.",
  NO_PIN: "Set your store's map pin in Store Properties.",
  NO_MENU: "Publish your menu: Settings > Manage Cache > Update Website Cache.",
  NO_ORDER_TYPE: "Turn on pickup or delivery in Order Toggles.",
});

const UNAVAILABLE_MESSAGE = "This restaurant isn't on Knot Eats right now.";

const httpError = (status, message, code) => Object.assign(createHttpError(status, message), code ? { code } : {});
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

/** A number from a query/body value, NaN for blanks, booleans, arrays. */
const num = (v) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : NaN);

/**
 * Inside India's bounding box and not (0,0). Catches swapped lat/lng (88, 22)
 * and an unset pin, which is what a "radius" check is worthless without.
 */
const isIndiaPoint = (lat, lng) => {
  const a = num(lat);
  const b = num(lng);
  return Number.isFinite(a) && Number.isFinite(b) && a >= 6 && a <= 37.5 && b >= 68 && b <= 97.5 && !(a === 0 && b === 0);
};

const isNearFast = ({ distanceKm, etaMinutes } = {}) =>
  Number.isFinite(distanceKm) && distanceKm <= 3 && Boolean(etaMinutes) && etaMinutes.min <= 30;

/**
 * Why a store is not on Knot Eats. Every check runs (no short-circuit) so
 * the POS and CSD can show the owner the whole list at once.
 */
const eligibility = async ({ settings, store, restaurant, restaurantId, dishCount }) => {
  const ke = settings?.knotEats || {};
  const ordering = settings?.ordering || {};
  const codes = [];
  if (!ke.enabled) codes.push("NOT_OPTED_IN");
  if (ke.delisted) codes.push("DELISTED");

  // Knot Eats does not need the website: only the store's status and the
  // account lock are asked.
  const refusal = store
    ? await unavailableReason({
        settings: { enabled: true, storeId: settings?.storeId },
        store,
        restaurant,
        restaurantId,
        knotEats: true,
      })
    : { reason: "STORE_UNAVAILABLE" };
  if (refusal?.locked) codes.push("ACCOUNT_LOCKED");
  else if (refusal) codes.push("STORE_STATUS");

  if (!/^\d{14}$/.test(String(restaurant?.fssaiNumber || "").trim())) codes.push("NO_FSSAI");
  if (!(await isOnlinePaymentEnabled({ restaurantId, storeId: settings?.storeId }))) codes.push("NO_GATEWAY");
  if (!isIndiaPoint(restaurant?.address?.lat, restaurant?.address?.lng)) codes.push("NO_PIN");
  if (dishCount === 0) codes.push("NO_MENU");
  if (ordering.pickupEnabled === false && ordering.deliveryEnabled !== true) codes.push("NO_ORDER_TYPE");

  const blockers = codes.map((code) => ({ code, message: BLOCKER_MESSAGES[code] }));
  return { listed: blockers.length === 0, blockers };
};

const tagsFor = (text) => DISH_TAGS.filter((t) => t.re.test(text)).map((t) => t.tag);

const median = (sorted) => {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The store's published website dishes, flattened for search and cards.
 * Same filter as the storefront payload, and toPublicProduct for the price
 * and the veg mark, so search and the store page never disagree.
 *
 * ponytail: menu schedules are ignored here, so search may show a breakfast
 * dish at night; the store page shows live availability.
 */
const buildStoreDishes = async ({ restaurantId, timezone }) => {
  const { toPublicProduct } = storefront();
  const menus = restaurantId
    ? projectMenus(await Menu.find({ restaurantId, isDeleted: { $ne: true } }).sort({ createdAt: 1 }), AUDIENCES.WEBSITE)
    : [];

  const dishes = [];
  outer: for (const menu of menus) {
    for (const item of menu.items || []) {
      if (item.showOnWebsite === false || item.displayTarget === "system") continue;
      const p = toPublicProduct(item, menu, timezone);
      const price = p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : Number(p.price) || 0;
      const text = `${p.name || ""} ${p.category || ""}`;
      dishes.push({
        menuId: String(p.menuId),
        itemId: String(p.id),
        name: p.name || "",
        price,
        isVeg: Boolean(p.isVegetarian),
        image: p.thumbnail || "",
        tags: tagsFor(text),
        hay: text.toLowerCase(),
      });
      if (dishes.length >= MAX_DISHES_PER_STORE) break outer;
    }
  }

  const prices = dishes.map((d) => d.price).sort((a, b) => a - b);
  const vegCount = dishes.filter((d) => d.isVeg).length;
  const tagCounts = new Map();
  for (const d of dishes) for (const t of d.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const order = DISH_TAGS.map((t) => t.tag);
  return Object.assign(dishes, {
    summary: {
      dishCount: dishes.length,
      vegCount,
      minPrice: prices.length ? prices[0] : 0,
      priceForTwo: Math.round((median(prices) * 2) / 50) * 50,
      pureVeg: dishes.length > 0 && vegCount === dishes.length,
      tags: [...tagCounts.keys()]
        .sort((a, b) => tagCounts.get(b) - tagCounts.get(a) || order.indexOf(a) - order.indexOf(b))
        .slice(0, 8),
    },
  });
};

/**
 * The store's live website coupons as public badges. Exhausted, inactive and
 * not-valid-right-now (date, weekday, time in the store's timezone) coupons
 * are dropped; checkout applies the same isRuleEligible, so badge and
 * checkout agree.
 */
const offerBadges = (coupons, { timezone, now = new Date() } = {}) => {
  const { isRuleEligible } = pricingRules();
  const eligibleOn = (rule, channel) =>
    isRuleEligible({ rule, channel, environment: "website", subtotal: Infinity, date: now, timezone });
  return (coupons || [])
    .filter((c) => c?.code && c.isActive !== false && !(c.quantityTotal > 0 && (c.quantityUsed || 0) >= c.quantityTotal))
    .map((c) => {
      const channels = { collection: eligibleOn(c, "collection"), delivery: eligibleOn(c, "delivery") };
      if (!channels.collection && !channels.delivery) return null;
      const value = Number(c.value) || 0;
      const min = Number(c.minOrderAmount) || 0;
      return {
        code: c.code,
        type: c.type === "fixed" ? "fixed" : "percent",
        value,
        minOrderAmount: min,
        channels,
        title: c.type === "fixed" ? `₹${value} OFF` : `${value}% OFF`,
        subtitle: min > 0 ? `above ₹${min}` : "on any order",
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.type === b.type ? b.value - a.value : a.type === "percent" ? -1 : 1));
};

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

const plain = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** The public face of a store is the PUBLISHED copy (Publish System). */
const published = (s, key) =>
  s.publishedSnapshot && s.publishedSnapshot[key] !== undefined ? s.publishedSnapshot[key] : s[key];

const buildAreas = (stores) => {
  const groups = new Map();
  for (const s of stores) {
    const city = String(s.area || "").trim();
    if (!city) continue;
    const label = [city, String(s.postalCode || "").trim()].filter(Boolean).join(", ");
    const g = groups.get(label) || { label, lat: 0, lng: 0, storeCount: 0 };
    g.lat += s.lat;
    g.lng += s.lng;
    g.storeCount += 1;
    groups.set(label, g);
  }
  // Centroids at 2 dp (~1 km): good enough to browse, too coarse to locate a
  // store's kitchen. Never used for delivery.
  return [...groups.values()]
    .map((g) => ({ label: g.label, lat: round2(g.lat / g.storeCount), lng: round2(g.lng / g.storeCount), storeCount: g.storeCount }))
    .sort((a, b) => b.storeCount - a.storeCount || a.label.localeCompare(b.label))
    .slice(0, 30);
};

const buildSnapshot = async () => {
  const rows = await WebsiteSettings.find({
    "knotEats.enabled": true,
    "knotEats.delisted": { $ne: true },
    isDeleted: { $ne: true },
  })
    // paymentGateways is never read into memory here; the gateway check
    // loads it on its own. Hydrated, not lean: schema defaults matter for
    // fields older rows never wrote (`enabled`).
    .select("-draft -landing -banners -analytics -paymentGateways -publishedSnapshot.landing -publishedSnapshot.banners");

  const storeIds = rows.map((r) => r.storeId);
  const stores = new Map(
    (await Store.find({ storeId: { $in: storeIds }, isDeleted: { $ne: true } }).lean()).map((s) => [s.storeId, s]),
  );
  const rid = (r) => r.restaurantId || stores.get(r.storeId)?.restaurantId || null;
  const restaurants = new Map(
    (await Restaurant.find({ _id: { $in: rows.map(rid).filter(Boolean) } }).lean()).map((r) => [String(r._id), r]),
  );

  const list = [];
  for (const s of rows) {
    const store = stores.get(s.storeId);
    if (!store) continue;
    const restaurantId = rid(s);
    const restaurant = restaurantId ? restaurants.get(String(restaurantId)) : null;
    const timezone = restaurant?.timezone || "Asia/Kolkata";
    try {
      const dishes = await buildStoreDishes({ restaurantId, timezone });
      const { listed } = await eligibility({ settings: s, store, restaurant, restaurantId, dishCount: dishes.length });
      if (!listed) continue;
      const ordering = s.ordering || {};
      const branding = published(s, "branding") || {};
      list.push({
        storeId: s.storeId,
        restaurantId: String(restaurantId),
        name: published(s, "displayName") || restaurant?.name || "",
        logo: branding.logo?.url || "",
        cover: branding.coverImage?.url || "",
        area: restaurant?.address?.city || "",
        postalCode: restaurant?.address?.postalCode || "",
        lat: Number(restaurant.address.lat),
        lng: Number(restaurant.address.lng),
        timezone,
        pickupEnabled: ordering.pickupEnabled !== false,
        deliveryEnabled: ordering.deliveryEnabled === true,
        radiusKm: Number(ordering.deliverySlabsConfig?.maxDistanceKm || 7),
        prepTimeMinutes: Number(ordering.prepTimeMinutes) || 30,
        deliveryFee: Number(ordering.deliveryFee) || 0,
        freeDeliveryAbove: Number(ordering.freeDeliveryAbove) || 0,
        slabsConfig: plain(ordering.deliverySlabsConfig) || {},
        // Exactly what availabilityAt reads.
        hours: plain({ holidays: s.holidays || [], closedForToday: s.closedForToday || {}, channelHours: s.channelHours || {} }),
        coupons: plain(s.couponsConfig || []),
        dishes,
        summary: dishes.summary,
        rating: null,
        ratingCount: 0,
      });
    } catch (err) {
      // One broken store must not take the whole marketplace down.
      console.warn(`[knotEats] skipped store ${s.storeId} in snapshot:`, err.message);
    }
  }

  const ratings = await ratingsFor(list.map((s) => s.storeId));
  for (const s of list) Object.assign(s, ratings.get(s.storeId));

  return { stores: new Map(list.map((s) => [s.storeId, s])), list, areas: buildAreas(list) };
};

/**
 * Public rating per store from VISIBLE reviews only: null until there are
 * MIN_RATINGS_TO_SHOW of them, so two early reviews can't brand a store.
 * @returns {Promise<Map<storeId, { rating: number|null, ratingCount: number }>>}
 */
const ratingsFor = async (storeIds) => {
  const out = new Map(storeIds.map((id) => [id, { rating: null, ratingCount: 0 }]));
  if (!storeIds.length) return out;
  const agg = await KnotEatsReview.aggregate([
    { $match: { hidden: false, storeId: { $in: storeIds } } },
    { $group: { _id: "$storeId", n: { $sum: 1 }, s: { $sum: "$rating" } } },
  ]);
  for (const a of agg) {
    out.set(a._id, { rating: a.n >= MIN_RATINGS_TO_SHOW ? round1(a.s / a.n) : null, ratingCount: a.n });
  }
  return out;
};

const state = { snapshot: null, builtAt: 0, builtGen: -1, gen: 0, building: null, buildingGen: -1 };

/** Mark the snapshot stale; the next read rebuilds it. Sync and cheap. */
const invalidateListing = () => {
  state.gen += 1;
};

const getSnapshot = async () => {
  const fresh = state.snapshot && state.builtGen === state.gen && Date.now() - state.builtAt < SNAPSHOT_TTL_MS;
  if (fresh) return state.snapshot;
  if (state.building && state.buildingGen !== state.gen) {
    // A write (say a CSD delist) landed after this build started; its result
    // may still list the store, so wait it out and build again.
    await state.building.catch(() => null);
    return getSnapshot();
  }
  if (!state.building) {
    const gen = state.gen;
    state.buildingGen = gen;
    state.building = buildSnapshot()
      .then((snapshot) => {
        Object.assign(state, { snapshot, builtAt: Date.now(), builtGen: gen });
        return snapshot;
      })
      .catch((err) => {
        console.warn("[knotEats] snapshot rebuild failed:", err.message);
        if (!state.snapshot) throw err;
        // Stale beats down, and is served for ~30 s before the next try, so a
        // struggling database is not hit with back-to-back rebuilds. A later
        // invalidateListing() bumps gen past builtGen and still rebuilds.
        Object.assign(state, { builtAt: Date.now() - SNAPSHOT_TTL_MS + 30_000, builtGen: gen });
        return state.snapshot;
      })
      .finally(() => {
        state.building = null;
      });
  }
  return state.building;
};

const getListedStore = async (storeId) => (await getSnapshot()).stores.get(String(storeId || "")) || null;

/** Tests only. */
const resetSnapshot = () =>
  Object.assign(state, { snapshot: null, builtAt: 0, builtGen: -1, gen: 0, building: null, buildingGen: -1 });

/* ------------------------------------------------------------------ */
/* Public projections                                                  */
/* ------------------------------------------------------------------ */

const etaFor = (s, minutes) => ({ min: s.prepTimeMinutes + minutes, max: s.prepTimeMinutes + minutes + 10 });

const openState = (s, channel, now) => {
  const a = availabilityAt(s.hours, channel, now, s.timezone);
  return { isOpen: a.open, closedReason: a.open ? "" : a.reason };
};

/** StoreCard minus dishes. `road` is a roadDistances entry or null. */
const storeCard = (s, { road, open, badges }) => {
  const etaMinutes = road ? etaFor(s, road.minutes) : null;
  return {
    storeId: s.storeId,
    name: s.name,
    logo: s.logo,
    cover: s.cover,
    area: s.area,
    tags: s.summary.tags,
    rating: s.rating,
    ratingCount: s.ratingCount,
    priceForTwo: s.summary.priceForTwo,
    pureVeg: s.summary.pureVeg,
    isOpen: open.isOpen,
    closedReason: open.closedReason,
    pickup: s.pickupEnabled,
    delivery: s.deliveryEnabled,
    prepTimeMinutes: s.prepTimeMinutes,
    deliverable: Boolean(road) && s.deliveryEnabled && road.km <= s.radiusKm,
    distanceKm: road ? road.km : null,
    distanceSource: road ? road.source : null,
    etaMinutes,
    nearFast: road ? isNearFast({ distanceKm: road.km, etaMinutes }) : false,
    offer: badges[0] ? { code: badges[0].code, title: badges[0].title, subtitle: badges[0].subtitle } : null,
    offerCount: badges.length,
  };
};

const publicDish = ({ menuId, itemId, name, price, isVeg, image }) => ({ menuId, itemId, name, price, isVeg, image });

const SORTS = ["relevance", "distance", "eta", "rating", "cost_asc", "cost_desc"];

const parseListQuery = (q = {}) => {
  const lat = num(q.lat);
  const lng = num(q.lng);
  if (!isIndiaPoint(lat, lng)) throw httpError(400, "Set your location to see restaurants near you.", "LOCATION_REQUIRED");
  const str = (v) => (typeof v === "string" ? v : "");
  const pos = (v) => (Number.isFinite(num(v)) && num(v) >= 0 ? num(v) : null);
  const int = (v, dflt, max) => {
    const n = Math.floor(num(v));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : dflt;
  };
  const text = str(q.q).trim().toLowerCase();
  const maxPrice = pos(q.maxPrice);
  return {
    origin: { lat: round3(lat), lng: round3(lng) },
    mode: q.mode === "pickup" ? "pickup" : "delivery",
    sort: SORTS.includes(q.sort) ? q.sort : "relevance",
    veg: q.veg === "1",
    pureVeg: q.pureVeg === "1",
    minRating: q.minRating === "3.5" || q.minRating === "4" ? Number(q.minRating) : 0,
    offers: q.offers === "1",
    costMin: pos(q.costMin),
    costMax: pos(q.costMax),
    fast: q.fast === "1",
    tag: DISH_TAGS.some((t) => t.tag === q.tag) ? q.tag : "",
    maxPrice: maxPrice > 0 ? maxPrice : null,
    text: text.length >= 2 && text.length <= 40 ? text : "",
    ids: [...new Set(str(q.ids).split(",").map((s) => s.trim()).filter((s) => /^\d{6}$/.test(s)))].slice(0, 30),
    page: int(q.page, 1, 10_000),
    limit: int(q.limit, 20, 25),
  };
};

const facetsFor = (cands) => {
  const tagStores = new Map();
  for (const { s } of cands) for (const t of s.summary.tags) tagStores.set(t, (tagStores.get(t) || 0) + 1);
  const labels = new Map(DISH_TAGS.map((t) => [t.tag, t.label]));
  const tags = [...tagStores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag, storeCount]) => {
      let image = "";
      for (const { s } of cands) {
        image = s.dishes.find((d) => d.image && d.tags.includes(tag))?.image || "";
        if (image) break;
      }
      return { tag, label: labels.get(tag), image, storeCount };
    });
  const collections = COLLECTIONS.map((c) => ({
    ...c,
    storeCount: cands.filter(({ s }) => s.summary.dishCount > 0 && s.summary.minPrice <= c.maxPrice).length,
  }));
  return { tags, collections };
};

/** GET /api/eats/stores (§3.4). */
const listStores = async (query, { now = new Date() } = {}) => {
  const f = parseListQuery(query);
  const { origin, mode } = f;
  const snapshot = await getSnapshot();
  const hav = (s) => haversineKm(s.lat, s.lng, origin.lat, origin.lng);

  // 1-3. Candidates by straight-line distance, which is never more than the
  // road distance, so nothing deliverable is dropped here.
  let cands;
  if (f.ids.length) {
    const want = new Set(f.ids);
    cands = snapshot.list.filter((s) => want.has(s.storeId)).map((s) => ({ s, hav: hav(s) }));
  } else {
    cands = snapshot.list
      .filter((s) => (mode === "delivery" ? s.deliveryEnabled : s.pickupEnabled))
      .map((s) => ({ s, hav: hav(s) }))
      .filter((c) => c.hav <= (mode === "delivery" ? c.s.radiusKm : BROWSE_KM));
  }
  const facets = f.page === 1 && !f.text && !f.tag && f.maxPrice == null && !f.ids.length ? facetsFor(cands) : undefined;
  if (!f.ids.length) {
    // ponytail: dense cities need geo paging (2dsphere) past SHORTLIST_MAX.
    cands = cands.sort((a, b) => a.hav - b.hav).slice(0, SHORTLIST_MAX);
  }

  // 5. Dish filters.
  const dishFilter = Boolean(f.text || f.tag || f.maxPrice != null || f.veg);
  const byPhotoThenPrice = (a, b) => Boolean(b.image) - Boolean(a.image) || a.price - b.price;
  cands = cands.filter((c) => {
    const dishes = c.s.dishes;
    const matched = dishFilter
      ? dishes.filter(
          (d) =>
            (!f.veg || d.isVeg) &&
            (!f.tag || d.tags.includes(f.tag)) &&
            (f.maxPrice == null || d.price <= f.maxPrice) &&
            (!f.text || d.hay.includes(f.text)),
        )
      : dishes;
    const nameHit = Boolean(f.text) && c.s.name.toLowerCase().includes(f.text);
    if (dishFilter && !matched.length && !nameHit) return false;
    const pool = matched.length ? matched : dishes.filter((d) => !f.veg || d.isVeg);
    c.dishes = [...pool].sort(byPhotoThenPrice).slice(0, CARD_DISHES).map(publicDish);
    return true;
  });

  // 6. Store filters.
  for (const c of cands) c.badges = offerBadges(c.s.coupons, { timezone: c.s.timezone, now });
  cands = cands.filter(({ s, hav: km, badges }) => {
    if (f.pureVeg && !s.summary.pureVeg) return false;
    if (f.minRating && !(s.rating != null && s.rating >= f.minRating)) return false;
    if (f.offers && !badges.length) return false;
    if (f.costMin != null && s.summary.priceForTwo < f.costMin) return false;
    if (f.costMax != null && s.summary.priceForTwo > f.costMax) return false;
    if (f.fast && !(km <= 3 && s.prepTimeMinutes + km * 3 <= 30)) return false;
    return true;
  });

  // 7-8. Open state, then a pre-sort on straight-line figures.
  const channel = mode === "delivery" ? "delivery" : "collection";
  for (const c of cands) c.open = openState(c.s, channel, now);
  const closedLast = (a, b) => Number(!a.open.isOpen) - Number(!b.open.isOpen);
  const keyed = {
    relevance: (a, b) => a.hav - b.hav,
    distance: (a, b) => a.hav - b.hav,
    eta: (a, b) => a.s.prepTimeMinutes + a.hav * 3 - (b.s.prepTimeMinutes + b.hav * 3),
    rating: (a, b) => (b.s.rating ?? -1) - (a.s.rating ?? -1) || a.hav - b.hav,
    cost_asc: (a, b) => a.s.summary.priceForTwo - b.s.summary.priceForTwo || a.hav - b.hav,
    cost_desc: (a, b) => b.s.summary.priceForTwo - a.s.summary.priceForTwo || a.hav - b.hav,
  }[f.sort];
  cands.sort((a, b) => closedLast(a, b) || keyed(a, b));

  // 9. Page, then road distances for the page only: the whole cost surface.
  const count = cands.length;
  const offset = (f.page - 1) * f.limit;
  let page = cands.slice(offset, offset + f.limit);
  const roads = page.length
    ? await roadDistances({ origin, stores: page.map(({ s }) => ({ key: s.storeId, lat: s.lat, lng: s.lng })) })
    : new Map();

  // 10. Post-road: a page may come back shorter than `limit`.
  let cards = page.map((c) => ({
    c,
    card: { ...storeCard(c.s, { road: roads.get(c.s.storeId), open: c.open, badges: c.badges }), dishes: c.dishes },
  }));
  if (mode === "delivery" && !f.ids.length) cards = cards.filter(({ c, card }) => card.distanceKm <= c.s.radiusKm);
  if (f.fast) cards = cards.filter(({ card }) => card.nearFast);
  if (f.sort === "distance" || f.sort === "eta") {
    const k = f.sort === "distance" ? (x) => x.card.distanceKm : (x) => x.card.etaMinutes.min;
    cards.sort((a, b) => closedLast(a.c, b.c) || k(a) - k(b));
  }

  return {
    page: f.page,
    hasMore: offset + f.limit < count,
    ...(facets ? { facets } : {}),
    stores: cards.map(({ card }) => card),
  };
};

/** The rupee fee a diner sees; a failed lookup shows 0 (checkout quotes again). */
const platformFeeFor = async (restaurantId) => {
  try {
    return toRupees((await orderCharge().quotePlatformFee({ restaurantId, source: "KNOT_EATS" }))?.totalPaise);
  } catch (err) {
    console.warn("[knotEats] platform fee unavailable:", err.message);
    return 0;
  }
};

const publicReview = (r) => ({ rating: r.rating, text: r.text || "", authorName: r.authorName || "", createdAt: r.createdAt });

/** GET /api/eats/stores/:storeId (§3.5), or null when not listed. */
const storeDetail = async (storeId, { lat, lng } = {}, { now = new Date() } = {}) => {
  if (!/^\d{6}$/.test(String(storeId || ""))) return null;
  const s = await getListedStore(storeId);
  if (!s) return null;

  const hasPoint = isIndiaPoint(lat, lng);
  const origin = hasPoint ? { lat: round3(num(lat)), lng: round3(num(lng)) } : null;
  const [road, platformFee, reviews] = await Promise.all([
    origin
      ? roadDistances({ origin, stores: [{ key: s.storeId, lat: s.lat, lng: s.lng }] }).then((m) => m.get(s.storeId))
      : null,
    platformFeeFor(s.restaurantId),
    KnotEatsReview.find({ storeId: s.storeId, hidden: false, text: { $nin: ["", null] } })
      .sort({ createdAt: -1 })
      .limit(3)
      .select("rating text authorName createdAt")
      .lean(),
  ]);

  // The page takes both order types, so it is open when either is.
  const pickup = openState(s, "collection", now);
  const delivery = openState(s, "delivery", now);
  const open = {
    isOpen: pickup.isOpen || delivery.isOpen,
    closedReason: pickup.isOpen || delivery.isOpen ? "" : pickup.closedReason || delivery.closedReason,
  };
  const offers = offerBadges(s.coupons, { timezone: s.timezone, now });

  let deliveryQuote = null;
  if (road) {
    const deliverable = s.deliveryEnabled && road.km <= s.radiusKm;
    deliveryQuote = {
      enabled: s.deliveryEnabled,
      radiusKm: s.radiusKm,
      deliverable,
      reason: !s.deliveryEnabled
        ? "This restaurant does not deliver."
        : deliverable
          ? ""
          : `Delivers within ${s.radiusKm} km; you are ${road.km} km away.`,
      distanceKm: road.km,
      distanceSource: road.source,
      etaMinutes: etaFor(s, road.minutes),
      fee: deliverable
        ? computeDeliveryFeeFromSlabs({ distanceKm: road.km, slabsConfig: s.slabsConfig, defaultFee: s.deliveryFee })
        : 0,
      freeAbove: s.freeDeliveryAbove,
    };
  }

  return {
    store: storeCard(s, { road, open, badges: offers }),
    platformFee,
    offers,
    delivery: deliveryQuote,
    reviews: reviews.map(publicReview),
  };
};

/** GET /api/eats/stores/:storeId/reviews (§3.6), or null when not listed. */
const storeReviews = async (storeId, { page } = {}) => {
  if (!/^\d{6}$/.test(String(storeId || ""))) return null;
  const s = await getListedStore(storeId);
  if (!s) return null;
  const p = Math.max(1, Math.min(10_000, Math.floor(num(page)) || 1));
  const rows = await KnotEatsReview.find({ storeId: s.storeId, hidden: false })
    .sort({ createdAt: -1 })
    .skip((p - 1) * REVIEWS_PAGE)
    .limit(REVIEWS_PAGE + 1)
    .select("rating text authorName createdAt")
    .lean();
  return {
    page: p,
    hasMore: rows.length > REVIEWS_PAGE,
    rating: s.rating,
    ratingCount: s.ratingCount,
    reviews: rows.slice(0, REVIEWS_PAGE).map(publicReview),
  };
};

/** The listing-wide part of GET /api/eats/config. */
const publicConfig = async () => {
  let areas = [];
  try {
    areas = (await getSnapshot()).areas;
  } catch {
    // The picker still has GPS and Places; an empty area list is not an outage.
  }
  return {
    maps: { browserKey: config.googleMapsBrowserKey || "" },
    roadDistance: Boolean(config.googleMapsServerKey),
    dishTags: DISH_TAGS.map(({ tag, label }) => ({ tag, label })),
    collections: COLLECTIONS.map((c) => ({ ...c })),
    areas,
  };
};

module.exports = {
  eligibility,
  BLOCKER_MESSAGES,
  UNAVAILABLE_MESSAGE,
  getSnapshot,
  invalidateListing,
  getListedStore,
  listStores,
  storeDetail,
  storeReviews,
  publicConfig,
  ratingsFor,
  buildStoreDishes,
  offerBadges,
  isIndiaPoint,
  isNearFast,
  DISH_TAGS,
  COLLECTIONS,
  BROWSE_KM,
  SHORTLIST_MAX,
  MIN_RATINGS_TO_SHOW,
  resetSnapshot,
};
