/**
 * Knot Eats listing (services/knotEats): who is listed, the in-process
 * snapshot, the list algorithm (candidates, filters, sorts, paging), the dish
 * index, offer badges, and what the public endpoints may never return.
 *
 * Models and the payment/plan checks are faked in memory; menuCache,
 * websiteAvailability, toPublicProduct, isRuleEligible and straight-line
 * distances are the real ones.
 */
process.env.GOOGLE_MAPS_SERVER_KEY = "";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const realDistance = require("../services/distanceService");
const { localDate } = require("../services/tableBookings");

const db = {};
const roadCalls = [];
let roadImpl = null;
const tick = () => new Promise((r) => setImmediate(r));

const reviewQuery = (filter) => {
  let rows = db.reviews
    .filter(
      (r) =>
        (filter.storeId === undefined || r.storeId === filter.storeId) &&
        (filter.hidden === undefined || r.hidden === filter.hidden) &&
        (!filter.text || Boolean(r.text)),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  const q = {
    sort: () => q,
    select: () => q,
    skip: (n) => ((rows = rows.slice(n)), q),
    limit: (n) => ((rows = rows.slice(0, n)), q),
    lean: async () => rows,
    then: (ok, ko) => Promise.resolve(rows).then(ok, ko),
  };
  return q;
};

const mocks = {
  "../config/config": { googleMapsBrowserKey: "browser-key-123", googleMapsServerKey: "" },
  "../models/websiteSettingsModel": {
    find: () => {
      db.findCalls += 1;
      // Rows are read at call time, like a query would see them.
      const rows = db.settings.filter((s) => s.knotEats?.enabled && !s.knotEats?.delisted);
      return {
        select: async () => {
          await tick();
          if (db.failFind) throw new Error("db down");
          return rows;
        },
      };
    },
  },
  "../models/storeModel": { find: () => ({ lean: async () => db.stores }) },
  "../models/restaurantModel": { find: () => ({ lean: async () => db.restaurants }) },
  "../models/menuModel": {
    find: (f) => ({ sort: async () => db.menus.filter((m) => m.restaurantId === String(f.restaurantId)) }),
  },
  "../models/knotEatsReviewModel": {
    find: reviewQuery,
    aggregate: async ([{ $match }]) => {
      const groups = new Map();
      for (const r of db.reviews) {
        if (r.hidden !== $match.hidden || !$match.storeId.$in.includes(r.storeId)) continue;
        const g = groups.get(r.storeId) || { _id: r.storeId, n: 0, s: 0 };
        g.n += 1;
        g.s += r.rating;
        groups.set(r.storeId, g);
      }
      return [...groups.values()];
    },
  },
  "./storefrontResolver": {
    unavailableReason: async ({ settings }) => ((db.resolverSaw = settings), db.unavailable[settings.storeId] || null),
  },
  "./paymentGateway": { isOnlinePaymentEnabled: async ({ storeId }) => !db.noGateway.has(storeId) },
  "./orderCharge": { quotePlatformFee: async () => ({ totalPaise: 1062 }) },
  "./distanceService": {
    ...realDistance,
    roadDistances: async (args) => {
      roadCalls.push(args.stores.map((s) => s.key));
      return (roadImpl || realDistance.roadDistances)(args);
    },
  },
};
const orig = Module._load;
Module._load = function (request, parent) {
  if (/services[\\/]knotEats\.js$/.test(parent?.filename || "") && request in mocks) return mocks[request];
  return orig.apply(this, arguments);
};
const ke = require("../services/knotEats");
const { toPublicProduct } = require("../controllers/storefrontController");

/* ---------------- fixtures ---------------- */

const ORIGIN = { lat: 22.5726, lng: 88.3639 };
const Q = (extra = {}) => ({ lat: String(ORIGIN.lat), lng: String(ORIGIN.lng), ...extra });
// ~km due north of the customer (1 deg of latitude ~ 111.2 km).
const north = (km) => ({ lat: ORIGIN.lat + km / 111.2, lng: ORIGIN.lng });
const week = (isOpen) => ({
  weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen, openTime: "00:00", closeTime: "00:00" })),
});
let seq = 0;
const oid = () => (++seq).toString(16).padStart(24, "0");

const addStore = (storeId, o = {}) => {
  const restaurantId = oid();
  const pos = o.pos || north(o.km ?? 1);
  const name = o.name || `Store ${storeId}`;
  db.restaurants.push({
    _id: restaurantId,
    name,
    timezone: "Asia/Kolkata",
    address: { city: o.city ?? "Kolkata", postalCode: o.postalCode ?? "700091", lat: pos.lat, lng: pos.lng },
  });
  db.stores.push({ storeId, status: "active", restaurantId });
  const hours = week(!o.closed);
  db.settings.push({
    storeId,
    restaurantId,
    enabled: true,
    displayName: name,
    branding: { logo: { url: "/uploads/logo.png" }, coverImage: { url: "/uploads/cover.png" } },
    publishedSnapshot: null,
    ordering: {
      pickupEnabled: o.pickup ?? true,
      deliveryEnabled: o.delivery ?? true,
      prepTimeMinutes: o.prep ?? 20,
      deliveryFee: 30,
      freeDeliveryAbove: 500,
      deliverySlabsConfig: { maxDistanceKm: o.radius ?? 7, slabs: [] },
    },
    channelHours: { collection: hours, delivery: hours },
    holidays: [],
    closedForToday: {},
    couponsConfig: o.coupons || [],
    knotEats: { enabled: true, delisted: false, ...o.ke },
  });
  const items = (o.dishes || [["Veg Thali", 150]]).map(([dish, price, extra]) => ({
    _id: oid(),
    name: dish,
    price,
    isVegetarian: true,
    ...extra,
  }));
  db.menus.push({
    _id: oid(),
    restaurantId,
    name: "Mains",
    published: true,
    hasPublishedToWebsite: true,
    items: [...items, ...(o.draftOnly || []).map(([dish, price]) => ({ _id: oid(), name: dish, price }))],
    websiteSnapshot: { name: "Mains", published: true, items },
  });
  for (const rating of o.ratings || []) {
    db.reviews.push({ storeId, rating, hidden: false, text: `rated ${rating}`, authorName: "Asmit G.", createdAt: new Date(Date.now() - db.reviews.length * 1000) });
  }
};

const NONVEG = { isVegetarian: false };
const ACTIVE_COUPON = { code: "WELCOME50", type: "percent", value: 50, minOrderAmount: 199, isActive: true };

/** Three stores the filter and sort tests share. */
const seedThree = () => {
  addStore("100001", {
    name: "Spice Hub",
    km: 1,
    prep: 10,
    ratings: [4, 4, 5],
    coupons: [ACTIVE_COUPON],
    dishes: [["Chicken Biryani", 220, { ...NONVEG, imageUrl: "/uploads/biryani.jpg" }], ["Paneer Tikka", 180], ["Veg Thali", 150]],
  });
  addStore("100002", { name: "Green Leaf", km: 2, prep: 20, dishes: [["Veg Thali", 300], ["Masala Dosa", 120]] });
  addStore("100003", {
    name: "Fish Point",
    km: 2.8,
    prep: 25,
    ratings: [3, 3, 4],
    dishes: [["Fish Fry", 400, NONVEG], ["Chicken Curry", 350, NONVEG]],
  });
};

const ids = (res) => res.stores.map((s) => s.storeId);

beforeEach(() => {
  Object.assign(db, {
    settings: [], stores: [], restaurants: [], menus: [], reviews: [],
    unavailable: {}, noGateway: new Set(), findCalls: 0, failFind: false,
  });
  roadCalls.length = 0;
  roadImpl = null;
  ke.resetSnapshot();
  realDistance.resetRoadDistances();
});

/* ---------------- eligibility ---------------- */

test("each blocker fires alone; all clear means listed", async () => {
  const good = () => ({
    settings: { storeId: "100001", enabled: true, knotEats: { enabled: true }, ordering: { pickupEnabled: true } },
    store: { storeId: "100001", status: "active" },
    restaurant: { address: { lat: 22.57, lng: 88.36 } },
    restaurantId: "r1",
    dishCount: 4,
  });
  assert.deepEqual(await ke.eligibility(good()), { listed: true, blockers: [] });

  const cases = {
    NOT_OPTED_IN: (a) => (a.settings.knotEats.enabled = false),
    DELISTED: (a) => (a.settings.knotEats.delisted = true),
    WEBSITE_OFF: (a) => (a.settings.enabled = false),
    NO_WEBSITE_ADDON: () => (db.unavailable["100001"] = { reason: "WEBSITE_DISABLED" }),
    ACCOUNT_LOCKED: () => (db.unavailable["100001"] = { reason: "STORE_UNAVAILABLE", locked: true }),
    STORE_STATUS: () => (db.unavailable["100001"] = { reason: "STORE_CLOSED" }),
    NO_GATEWAY: () => db.noGateway.add("100001"),
    NO_PIN: (a) => (a.restaurant.address = { lat: 0, lng: 0 }),
    NO_MENU: (a) => (a.dishCount = 0),
    NO_ORDER_TYPE: (a) => (a.settings.ordering = { pickupEnabled: false, deliveryEnabled: false }),
  };
  for (const [code, mutate] of Object.entries(cases)) {
    db.unavailable = {};
    db.noGateway = new Set();
    const args = good();
    mutate(args);
    const out = await ke.eligibility(args);
    assert.deepEqual(out.blockers.map((b) => b.code), [code], code);
    assert.equal(out.listed, false);
    assert.equal(out.blockers[0].message, ke.BLOCKER_MESSAGES[code]);
  }
});

test("blockers are not short-circuited: website off still reports the add-on and the gateway", async () => {
  db.unavailable["100001"] = { reason: "WEBSITE_DISABLED" };
  db.noGateway.add("100001");
  const out = await ke.eligibility({
    settings: { storeId: "100001", enabled: false, knotEats: {}, ordering: {} },
    store: { status: "active" },
    restaurant: { address: {} },
    restaurantId: "r1",
    dishCount: 0,
  });
  assert.deepEqual(out.blockers.map((b) => b.code), [
    "NOT_OPTED_IN", "WEBSITE_OFF", "NO_WEBSITE_ADDON", "NO_GATEWAY", "NO_PIN", "NO_MENU",
  ]);
  assert.equal(db.resolverSaw.enabled, true, "the add-on is checked past the owner's own switch");
});

test("closed by its hours is still listed, with isOpen false and sorted last", async () => {
  addStore("100001", { km: 0.5, closed: true });
  addStore("100002", { km: 3 });
  const res = await ke.listStores(Q());
  assert.deepEqual(ids(res), ["100002", "100001"]);
  const closed = res.stores[1];
  assert.equal(closed.isOpen, false);
  assert.match(closed.closedReason, /Delivery is not available today/);
});

test("isIndiaPoint rejects swapped coordinates, (0,0), blanks and junk", () => {
  assert.equal(ke.isIndiaPoint(22.5726, 88.3639), true);
  assert.equal(ke.isIndiaPoint("22.5726", "88.3639"), true);
  assert.equal(ke.isIndiaPoint(88.3639, 22.5726), false, "swapped");
  assert.equal(ke.isIndiaPoint(0, 0), false);
  for (const [a, b] of [["", ""], [null, null], [undefined, 88], [true, true], [NaN, 88], [[22], [88]], [51.5, -0.12]]) {
    assert.equal(ke.isIndiaPoint(a, b), false, `${a},${b}`);
  }
});

/* ---------------- snapshot ---------------- */

test("snapshot: one build for concurrent cold reads, stale on failure, rebuilt on invalidate", async () => {
  addStore("100001");
  const [a, b] = await Promise.all([ke.getSnapshot(), ke.getSnapshot()]);
  assert.equal(db.findCalls, 1);
  assert.equal(a, b);
  assert.equal(await ke.getSnapshot(), a, "fresh reads come from memory");
  assert.equal(db.findCalls, 1);

  ke.invalidateListing();
  db.failFind = true;
  assert.equal(await ke.getSnapshot(), a, "a failed rebuild keeps serving the last good one");
  assert.equal(db.findCalls, 2);

  db.failFind = false;
  assert.equal(await ke.getSnapshot(), a, "a failed rebuild backs off instead of retrying on every read");
  assert.equal(db.findCalls, 2);

  ke.invalidateListing();
  const c = await ke.getSnapshot();
  assert.notEqual(c, a);
  assert.equal(db.findCalls, 3);
  assert.ok(await ke.getListedStore("100001"));

  // Delisted while a rebuild is already running: the next read must not
  // return that in-flight (now stale) snapshot.
  ke.invalidateListing();
  const inflight = ke.getSnapshot();
  db.settings[0].knotEats.delisted = true;
  ke.invalidateListing();
  assert.equal(await ke.getListedStore("100001"), null);
  await inflight;
});

test("a cold build with nothing to fall back on rejects", async () => {
  db.failFind = true;
  await assert.rejects(ke.getSnapshot(), /db down/);
});

test("a store not opted in, or delisted, is never in the snapshot", async () => {
  addStore("100001", { ke: { enabled: false } });
  addStore("100002", { ke: { delisted: true } });
  addStore("100003");
  db.noGateway.add("100003");
  assert.equal((await ke.getSnapshot()).list.length, 0);
});

/* ---------------- candidates ---------------- */

test("delivery mode drops stores beyond their radius BEFORE any distance call", async () => {
  addStore("100001", { km: 2 });
  addStore("100002", { km: 9, radius: 7 });
  addStore("100003", { km: 6, radius: 5 });
  const res = await ke.listStores(Q());
  assert.deepEqual(ids(res), ["100001"]);
  assert.deepEqual(roadCalls, [["100001"]], "the road call only ever sees in-radius stores");
});

test("pickup mode browses 15 km regardless of the delivery radius", async () => {
  addStore("100001", { km: 12, radius: 3 });
  addStore("100002", { km: 16 });
  addStore("100003", { km: 2, pickup: false });
  assert.deepEqual(ids(await ke.listStores(Q({ mode: "pickup" }))), ["100001"]);
  assert.deepEqual(ids(await ke.listStores(Q())), ["100003"], "delivery mode ignores the 12 km store");
});

test("ids (Saved) skip the distance filter", async () => {
  addStore("100001", { km: 40 });
  addStore("100002", { km: 1 });
  const res = await ke.listStores(Q({ ids: "100001,999999,abc" }));
  assert.deepEqual(ids(res), ["100001"]);
  assert.equal(res.facets, undefined);
});

test("the shortlist caps at 60 nearest stores", async () => {
  for (let i = 0; i < 70; i += 1) addStore(String(200000 + i), { km: 0.1 + i * 0.08 });
  const pages = [];
  for (let page = 1; page <= 3; page += 1) pages.push(await ke.listStores(Q({ page: String(page), limit: "25" })));
  assert.deepEqual(pages.map((p) => p.stores.length), [25, 25, 10]);
  assert.deepEqual(pages.map((p) => p.hasMore), [true, true, false]);
  assert.equal(pages[2].stores.at(-1).storeId, "200059", "the 60th nearest, never the 61st");
  assert.ok(roadCalls.every((c) => c.length <= 25), "distances are fetched per page only");
});

test("no location: 400 LOCATION_REQUIRED", async () => {
  for (const q of [{}, { lat: "0", lng: "0" }, { lat: "88.36", lng: "22.57" }, { lat: "abc", lng: "1" }]) {
    await assert.rejects(ke.listStores(q), (e) => e.status === 400 && e.code === "LOCATION_REQUIRED");
  }
});

/* ---------------- filters ---------------- */

test("filters: veg, pureVeg, minRating, offers, cost, fast", async () => {
  seedThree();
  const veg = await ke.listStores(Q({ veg: "1" }));
  assert.deepEqual(ids(veg), ["100001", "100002"]);
  assert.ok(veg.stores[0].dishes.every((d) => d.isVeg) && veg.stores[0].dishes.length === 2);

  assert.deepEqual(ids(await ke.listStores(Q({ pureVeg: "1" }))), ["100002"]);
  assert.deepEqual(ids(await ke.listStores(Q({ minRating: "4" }))), ["100001"]);
  assert.deepEqual(ids(await ke.listStores(Q({ minRating: "3.5" }))), ["100001"], "3.3 and unrated drop out");
  assert.deepEqual(ids(await ke.listStores(Q({ offers: "1" }))), ["100001"]);
  // priceForTwo: 350 (median 180), 400 (median 210), 750 (median 375).
  assert.deepEqual(ids(await ke.listStores(Q({ costMax: "400" }))), ["100001", "100002"]);
  assert.deepEqual(ids(await ke.listStores(Q({ costMin: "500" }))), ["100003"]);
  const fast = await ke.listStores(Q({ fast: "1" }));
  assert.deepEqual(ids(fast), ["100001", "100002"], "25 min prep + 2.8 km is not fast");
  assert.ok(fast.stores.every((s) => s.nearFast));
});

test("filters: tag, maxPrice and q (store name, dish, and regex characters)", async () => {
  seedThree();
  const biryani = await ke.listStores(Q({ tag: "biryani" }));
  assert.deepEqual(ids(biryani), ["100001"]);
  assert.deepEqual(biryani.stores[0].dishes.map((d) => d.name), ["Chicken Biryani"]);

  const cheap = await ke.listStores(Q({ maxPrice: "200" }));
  assert.deepEqual(ids(cheap), ["100001", "100002"]);
  assert.ok(cheap.stores.every((s) => s.dishes.every((d) => d.price <= 200)));

  const byName = await ke.listStores(Q({ q: "GREEN" }));
  assert.deepEqual(ids(byName), ["100002"]);
  assert.equal(byName.stores[0].dishes.length, 2, "a name match shows the store's dishes");
  assert.deepEqual(ids(await ke.listStores(Q({ q: "biry" }))), ["100001"]);
  assert.deepEqual(ids(await ke.listStores(Q({ q: "dosa" }))), ["100002"]);
  assert.deepEqual(ids(await ke.listStores(Q({ q: "(biry" }))), [], "a literal substring, never a regex");
  assert.deepEqual(ids(await ke.listStores(Q({ q: "x" }))).length, 3, "under 2 characters is ignored");
  assert.equal((await ke.listStores(Q({ q: "biry" }))).facets, undefined);
});

test("facets on page 1: tags ranked by store count, and the under-250 collection", async () => {
  seedThree();
  const { facets } = await ke.listStores(Q());
  const thali = facets.tags.find((t) => t.tag === "thali");
  assert.deepEqual([thali.label, thali.storeCount], ["Thali", 2]);
  assert.equal(facets.tags[0].storeCount >= facets.tags.at(-1).storeCount, true);
  assert.equal(facets.tags.find((t) => t.tag === "biryani").image, "/uploads/biryani.jpg");
  assert.deepEqual(facets.collections, [{ key: "under-250", title: "Meals under ₹250", maxPrice: 250, storeCount: 2 }]);
  assert.equal((await ke.listStores(Q({ page: "2" }))).facets, undefined);
});

/* ---------------- sorts and paging ---------------- */

test("each sort, with closed stores last", async () => {
  addStore("100001", { km: 1, prep: 40, dishes: [["Veg Thali", 100]] });
  addStore("100002", { km: 2, prep: 10, ratings: [5, 4, 5], dishes: [["Veg Thali", 300]] });
  addStore("100003", { km: 3, prep: 15, ratings: [4, 4, 3], dishes: [["Veg Thali", 200]] });
  addStore("100004", { km: 0.5, closed: true, ratings: [5, 5, 5] });
  const order = async (sort) => ids(await ke.listStores(Q({ sort })));
  assert.deepEqual(await order("relevance"), ["100001", "100002", "100003", "100004"]);
  assert.deepEqual(await order("distance"), ["100001", "100002", "100003", "100004"]);
  assert.deepEqual(await order("eta"), ["100002", "100003", "100001", "100004"]);
  assert.deepEqual(await order("rating"), ["100002", "100003", "100001", "100004"]);
  assert.deepEqual(await order("cost_asc"), ["100001", "100003", "100002", "100004"]);
  assert.deepEqual(await order("cost_desc"), ["100002", "100003", "100001", "100004"]);
  assert.deepEqual(await order("nonsense"), await order("relevance"));
});

test("hasMore pages, and a road distance beyond the radius drops the store", async () => {
  addStore("100001", { km: 1 });
  addStore("100002", { km: 5, radius: 7 });
  addStore("100003", { km: 6 });
  const p1 = await ke.listStores(Q({ limit: "2" }));
  assert.deepEqual([ids(p1), p1.hasMore], [["100001", "100002"], true]);
  const p2 = await ke.listStores(Q({ limit: "2", page: "2" }));
  assert.deepEqual([ids(p2), p2.hasMore], [["100003"], false]);

  // 5 km as the crow flies, 9 km by road: not deliverable, so not listed.
  roadImpl = async ({ stores }) =>
    new Map(stores.map((s) => [s.key, { km: s.key === "100002" ? 9 : 2, minutes: 10, source: "road" }]));
  const res = await ke.listStores(Q());
  assert.deepEqual(ids(res), ["100001", "100003"], "a page may come back short");
  assert.deepEqual([res.stores[0].distanceSource, res.stores[0].deliverable], ["road", true]);
});

test("the card: ETA, near-and-fast, best offer and at most 5 dishes, photos first", async () => {
  addStore("100001", {
    km: 1,
    prep: 10,
    coupons: [ACTIVE_COUPON, { code: "FLAT20", type: "fixed", value: 20 }],
    dishes: [
      ["Dal", 90], ["Rice", 60], ["Roti", 20], ["Paneer Butter Masala", 240, { imageUrl: "/uploads/p.jpg" }],
      ["Raita", 40], ["Salad", 50], ["Kheer", 80],
    ],
  });
  const [card] = (await ke.listStores(Q())).stores;
  assert.equal(card.distanceSource, "straight_line");
  assert.deepEqual(card.etaMinutes, { min: 10 + Math.round(card.distanceKm * 3), max: 20 + Math.round(card.distanceKm * 3) });
  assert.equal(card.nearFast, true);
  assert.deepEqual(card.offer, { code: "WELCOME50", title: "50% OFF", subtitle: "above ₹199" });
  assert.equal(card.offerCount, 2);
  assert.deepEqual(card.dishes.map((d) => d.name), ["Paneer Butter Masala", "Roti", "Raita", "Salad", "Rice"]);
  assert.deepEqual(Object.keys(card.dishes[0]).sort(), ["image", "isVeg", "itemId", "menuId", "name", "price"]);
});

/* ---------------- dish index ---------------- */

test("dish index: published website dishes only, variant minimum, tags, price for two", async () => {
  addStore("100001", {
    dishes: [
      ["Chicken Momos", 150, NONVEG],
      ["Veg Thali", 250, { variants: [{ _id: oid(), name: "Half", price: 180 }, { _id: oid(), name: "Full", price: 260 }] }],
      ["Staff Meal", 50, { displayTarget: "system" }],
      ["Hidden Dish", 70, { showOnWebsite: false }],
      ["Chicken Biryani", 300, { isVegetarian: true }],
    ],
    draftOnly: [["Draft Pizza", 400]],
  });
  const { restaurantId } = db.settings[0];
  const dishes = await ke.buildStoreDishes({ restaurantId, timezone: "Asia/Kolkata" });
  assert.deepEqual(dishes.map((d) => d.name), ["Chicken Momos", "Veg Thali", "Chicken Biryani"]);
  const byName = Object.fromEntries(dishes.map((d) => [d.name, d]));
  assert.deepEqual(byName["Chicken Momos"].tags, ["momo", "chicken"]);
  assert.equal(byName["Veg Thali"].price, 180, "the cheapest variant");
  // The veg mark is whatever the store page shows (toPublicProduct).
  const menu = db.menus[0];
  const biryani = menu.websiteSnapshot.items.find((i) => i.name === "Chicken Biryani");
  assert.equal(byName["Chicken Biryani"].isVeg, toPublicProduct(biryani, menu, "Asia/Kolkata").isVegetarian);
  // Median of [150, 180, 300] = 180 -> x2 = 360 -> nearest 50 = 350.
  assert.deepEqual(
    { ...dishes.summary, tags: undefined },
    { dishCount: 3, vegCount: dishes.filter((d) => d.isVeg).length, minPrice: 150, priceForTwo: 350, pureVeg: false, tags: undefined },
  );
  assert.ok(dishes.summary.tags.includes("chicken"));
});

/* ---------------- offers ---------------- */

test("badges drop inactive, exhausted, expired and wrong-day coupons, and are ordered", () => {
  const now = new Date();
  const todayIst = new Date(`${localDate(now, "Asia/Kolkata")}T00:00:00Z`).getUTCDay();
  const coupons = [
    { code: "FIX50", type: "fixed", value: 50 },
    { code: "P10", type: "percent", value: 10 },
    { code: "P20", type: "percent", value: 20, minOrderAmount: 199 },
    { code: "FIX100", type: "fixed", value: 100, channels: { collection: false, delivery: true } },
    { code: "OFF", type: "percent", value: 90, isActive: false },
    { code: "GONE", type: "percent", value: 80, quantityTotal: 5, quantityUsed: 5 },
    { code: "OLD", type: "percent", value: 70, validUntil: new Date(now.getTime() - 3 * 86400000) },
    { code: "TMRW", type: "percent", value: 60, daysOfWeek: [(todayIst + 1) % 7] },
  ];
  const badges = ke.offerBadges(coupons, { timezone: "Asia/Kolkata", now });
  assert.deepEqual(badges.map((b) => b.code), ["P20", "P10", "FIX100", "FIX50"]);
  assert.deepEqual(badges[0], {
    code: "P20", type: "percent", value: 20, minOrderAmount: 199,
    channels: { collection: true, delivery: true }, title: "20% OFF", subtitle: "above ₹199",
  });
  assert.deepEqual([badges[2].title, badges[2].subtitle, badges[2].channels.collection], ["₹100 OFF", "on any order", false]);
});

/* ---------------- store page ---------------- */

test("store page: quote with a location, none without, and 404 when not listed", async () => {
  seedThree();
  const near = await ke.storeDetail("100001", Q());
  assert.equal(near.platformFee, 10.62);
  assert.equal(near.delivery.deliverable, true);
  assert.equal(near.delivery.reason, "");
  assert.equal(near.delivery.fee, 30);
  assert.equal(near.delivery.freeAbove, 500);
  assert.equal(near.store.distanceKm, near.delivery.distanceKm);
  assert.equal(near.store.dishes, undefined);
  assert.equal(near.offers[0].code, "WELCOME50");
  assert.equal(near.reviews.length, 3);

  const blind = await ke.storeDetail("100001", { lat: "abc", lng: "" });
  assert.equal(blind.delivery, null);
  assert.deepEqual([blind.store.distanceKm, blind.store.etaMinutes, blind.store.deliverable], [null, null, false]);

  addStore("100009", { km: 9, radius: 7 });
  ke.invalidateListing();
  const far = await ke.storeDetail("100009", Q());
  assert.equal(far.delivery.deliverable, false);
  assert.equal(far.delivery.reason, `Delivers within 7 km; you are ${far.delivery.distanceKm} km away.`);

  assert.equal(await ke.storeDetail("12345", Q()), null);
  assert.equal(await ke.storeDetail("555555", Q()), null);
});

/* ---------------- forbidden keys ---------------- */

const FORBIDDEN = new Set([
  "restaurantId", "lat", "lng", "ownerName", "ownerPhone", "phone", "paymentGateways", "clientSecret",
  "orderChargeFrom", "billingExempt", "startsAt", "source", "orderId", "orderNumber",
  "googleMapsServerKey", "hay", "coupons", "slabsConfig", "hours", "summary",
]);
const scan = (value, where, allow = () => false, path = "") => {
  if (Array.isArray(value)) return value.forEach((v, i) => scan(v, where, allow, `${path}[${i}]`));
  if (!value || typeof value !== "object" || value instanceof Date) return;
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN.has(k) && !allow(`${path}.${k}`)) assert.fail(`${where} leaks ${path}.${k}`);
    scan(v, where, allow, `${path}.${k}`);
  }
};
const respond = async (handler, req) => {
  let body;
  let err;
  const res = { set: () => res, status: () => res, json: (b) => ((body = b), res) };
  await handler({ query: {}, params: {}, headers: {}, ...req }, res, (e) => (err = e));
  if (err) throw err;
  return body.data;
};

test("SECURITY: public responses carry none of the forbidden keys; /config has the browser key only", async () => {
  seedThree();
  const ctrl = require("../controllers/knotEatsController");
  const config = await respond(ctrl.getConfig, {});
  // Area centroids (2 dp) are the one place lat/lng may appear.
  scan(config, "/config", (p) => /^\.areas\[\d+\]\.(lat|lng)$/.test(p));
  assert.equal(config.maps.browserKey, "browser-key-123");
  assert.equal(config.roadDistance, false);
  assert.deepEqual(config.areas, [{ label: "Kolkata, 700091", lat: 22.59, lng: 88.36, storeCount: 3 }]);

  scan(await respond(ctrl.listStores, { query: Q() }), "/stores");
  scan(await respond(ctrl.listStores, { query: Q({ q: "thali", mode: "pickup" }) }), "/stores?q");
  scan(await respond(ctrl.getStore, { params: { storeId: "100001" }, query: Q() }), "/stores/:id");
  const reviews = await respond(ctrl.getStoreReviews, { params: { storeId: "100001" }, query: { page: "1" } });
  scan(reviews, "/stores/:id/reviews");
  assert.deepEqual([reviews.rating, reviews.ratingCount, reviews.hasMore, reviews.reviews.length], [4.3, 3, false, 3]);
  await assert.rejects(
    respond(ctrl.getStore, { params: { storeId: "999999" } }),
    (e) => e.status === 404 && e.code === "KNOT_EATS_UNAVAILABLE",
  );
});

/* ---------------- ratings ---------------- */

test("rating is null below 3 visible reviews; hidden reviews count nowhere", async () => {
  addStore("100001", { km: 1, ratings: [5, 5] });
  addStore("100002", { km: 2, ratings: [5, 5, 4] });
  db.reviews.push({ storeId: "100002", rating: 1, hidden: true, text: "abusive", authorName: "X", createdAt: new Date() });
  const cards = Object.fromEntries((await ke.listStores(Q())).stores.map((s) => [s.storeId, s]));
  assert.deepEqual([cards["100001"].rating, cards["100001"].ratingCount], [null, 2]);
  assert.deepEqual([cards["100002"].rating, cards["100002"].ratingCount], [4.7, 3], "the hidden 1-star is not averaged");

  const page = await ke.storeReviews("100002", { page: "1" });
  assert.ok(page.reviews.every((r) => r.text !== "abusive"));
  assert.equal(page.reviews.length, 3);
  assert.ok((await ke.storeDetail("100002", {})).reviews.every((r) => r.text !== "abusive"));
});
