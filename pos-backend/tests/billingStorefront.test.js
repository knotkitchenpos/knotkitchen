/**
 * The ₹199 Billing plan on the public side: the website (when the store holds
 * the Website add-on) takes pickup only and no table bookings, Knot Eats does
 * not list the store, and CSD shows a store's URL only while its Website
 * add-on is live. The plan check (planFeatures) is faked; the masks are real.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const STORE = "148379";

/** Require `modulePath` with `fakes` answering the requires made from `parentFile`. */
const withFakes = async (parentFile, fakes, modulePath, run) => {
  const orig = Module._load;
  Module._load = function (request, parent) {
    if (path.basename(parent?.filename || "") === parentFile && Object.prototype.hasOwnProperty.call(fakes, request)) {
      return fakes[request];
    }
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve(modulePath)];
  try {
    return await run(require(modulePath));
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve(modulePath)];
  }
};

/* ---------------- storefront resolver ---------------- */

const resolve = async ({ pos, ordering, args = {} }) => {
  const calls = [];
  let saved = false;
  const settings = {
    storeId: STORE,
    restaurantId: "r1",
    enabled: true,
    ordering,
    save: async () => {
      saved = true;
    },
  };
  const fakes = {
    "../models/websiteSettingsModel": { findOne: async () => settings },
    "./websitePublish": { applyPublishedSnapshot: () => {} },
    "../models/storeModel": { findOne: async () => ({ storeId: STORE, status: "active" }) },
    "../models/restaurantModel": { findById: async () => ({ _id: "r1", isActive: true }) },
    "./planFeatures": {
      hasWebsite: async () => true,
      hasFeature: async (...a) => (calls.push(a), a[1] === "pos" ? pos : true),
    },
    "./accountLock": { isOrderingLocked: async () => false },
  };
  const ctx = await withFakes("storefrontResolver.js", fakes, "../services/storefrontResolver", ({ resolveStorefront }) =>
    resolveStorefront({ identifier: STORE, ...args }),
  );
  return { ctx, calls, saved };
};

const fullOrdering = () => ({
  pickupEnabled: true,
  deliveryEnabled: true,
  tableBooking: { enabled: true, maxPartySize: 8 },
});

test("resolver: on the Billing plan the website takes pickup only and no table bookings, in memory", async () => {
  const { ctx, calls, saved } = await resolve({ pos: false, ordering: fullOrdering() });
  assert.equal(ctx.ok, true);
  const o = ctx.settings.ordering;
  assert.deepEqual(
    [o.pickupEnabled, o.deliveryEnabled, o.tableBooking.enabled, o.tableBooking.maxPartySize],
    [true, false, false, 8],
  );
  assert.deepEqual(calls, [["r1", "pos", STORE]], "asked once, for this store");
  assert.equal(saved, false, "never written back, so an upgrade restores the store's own switches");

  const bare = await resolve({ pos: false, ordering: { pickupEnabled: true, deliveryEnabled: true } });
  assert.deepEqual(bare.ctx.settings.ordering.tableBooking, { enabled: false }, "no tableBooking yet: added off");

  // REGRESSION: a delivery-only store moved to the Billing plan still takes pickup (its Order Toggles are locked).
  const deliveryOnly = await resolve({ pos: false, ordering: { ...fullOrdering(), pickupEnabled: false } });
  assert.deepEqual([deliveryOnly.ctx.settings.ordering.pickupEnabled, deliveryOnly.ctx.settings.ordering.deliveryEnabled], [true, false]);
  assert.equal(deliveryOnly.saved, false);
  const posStore = await resolve({ pos: true, ordering: { ...fullOrdering(), pickupEnabled: false } });
  assert.equal(posStore.ctx.settings.ordering.pickupEnabled, false, "the POS plan keeps the store's own switch");
});

test("resolver: untouched on the POS plan, for Knot Eats and for a paid checkout", async () => {
  const pos = await resolve({ pos: true, ordering: fullOrdering() });
  assert.deepEqual(pos.ctx.settings.ordering, fullOrdering());

  for (const args of [{ knotEats: true }, { honourPaid: true }]) {
    const out = await resolve({ pos: false, ordering: fullOrdering(), args });
    assert.equal(out.ctx.ok, true);
    assert.deepEqual(out.ctx.settings.ordering, fullOrdering(), JSON.stringify(args));
    assert.deepEqual(out.calls, [], `${JSON.stringify(args)}: no plan read`);
  }
});

test("source: the Website add-on refusal line is unchanged", () => {
  assert.match(
    SRC("services/storefrontResolver.js"),
    /if \(!\(await hasWebsite\(restaurantId, settings\.storeId\)\)\) return \{ reason: "WEBSITE_DISABLED" \};/,
  );
});

/* ---------------- Knot Eats ---------------- */

test("Knot Eats: a Billing-plan store is not listed (PLAN)", async () => {
  const calls = [];
  let pos = false;
  const fakes = {
    "./planFeatures": { hasFeature: async (...a) => (calls.push(a), a[1] === "pos" ? pos : true) },
    "./storefrontResolver": { unavailableReason: async () => null },
    "./paymentGateway": { isOnlinePaymentEnabled: async () => true },
  };
  const args = () => ({
    settings: { storeId: STORE, knotEats: { enabled: true }, ordering: { pickupEnabled: true } },
    store: { storeId: STORE, status: "active" },
    restaurant: { fssaiNumber: "12345678901234", address: { lat: 22.57, lng: 88.36 } },
    restaurantId: "r1",
    dishCount: 4,
  });
  await withFakes("knotEats.js", fakes, "../services/knotEats", async (ke) => {
    const out = await ke.eligibility(args());
    assert.equal(out.listed, false);
    assert.deepEqual(out.blockers, [{ code: "PLAN", message: ke.BLOCKER_MESSAGES.PLAN }]);
    assert.match(ke.BLOCKER_MESSAGES.PLAN, /POS plan.*Billing & Subscription/);
    assert.deepEqual(calls, [["r1", "pos", STORE]]);

    pos = true;
    assert.deepEqual(await ke.eligibility(args()), { listed: true, blockers: [] });
  });
});

/* ---------------- CSD: the URL only with the Website add-on ---------------- */

test("CSD store search: the URL is shown only for stores with the Website add-on (or demo stores)", async () => {
  const rows = (ids) => ids.map((storeId) => ({ storeId, storeName: `Store ${storeId}`, status: "active" }));
  const stores = rows(["100001", "100002", "100003"]);
  const restaurants = [
    { _id: "r1", storeId: "100001", name: "With website" },
    { _id: "r2", storeId: "100002", name: "Without website" },
    { _id: "r3", storeId: "100003", name: "Demo" },
  ];
  const websites = stores.map((s) => ({ storeId: s.storeId, slug: s.storeId, customDomain: `s${s.storeId}.example.com` }));
  const subscriptions = [
    { restaurantId: "r1", planCode: "BILLING", addons: [{ code: "WEBSITE", feature: "website" }] },
    { restaurantId: "r2", planCode: "POS", addons: [{ code: "GMB", feature: "" }] },
  ];
  const q = (out) => ({ sort: () => q(out), limit: () => q(out), select: () => q(out), lean: async () => out });
  const fakes = {
    "../models/storeModel": { find: () => q(stores) },
    "../models/restaurantModel": { find: () => q(restaurants) },
    "../models/websiteSettingsModel": { find: () => q(websites) },
    "../models/csdStoreChargesModel": { find: () => q([{ storeId: "100003", billingExempt: true }, { storeId: "100002" }]) },
    "../models/platformSubscriptionModel": {
      PlatformSubscription: {
        find: (filter) => {
          assert.deepEqual(filter, { restaurantId: { $in: ["r1", "r2", "r3"] } }, "one read for the page");
          return q(subscriptions);
        },
      },
    },
  };
  await withFakes("csdStoreController.js", fakes, "../controllers/csdStoreController", async ({ searchStores }) => {
    const res = { status: (c) => ((res.statusCode = c), res), json: (b) => ((res.body = b), res) };
    let error;
    await searchStores({ query: {} }, res, (e) => (error = e));
    assert.equal(error, undefined, error?.message);
    const site = Object.fromEntries(res.body.data.results.map((r) => [r.storeId, r.website]));
    assert.deepEqual(site, {
      100001: "https://s100001.example.com",
      100002: "",
      100003: "https://s100003.example.com",
    });
  });
});

test("source: CSD store detail hides the URL and the switch without the Website add-on", () => {
  const ctrl = SRC("controllers/csdRestaurantController.js");
  assert.match(ctrl, /const features = await featuresOf\(restaurant\?\._id, storeId\);\s*const siteLive = features\.website;/);
  assert.equal(ctrl.split('website: settings && siteLive ? buildStorefrontUrl(settings) : "",').length - 1, 2, "basic and quickAccess");
  assert.doesNotMatch(ctrl, /website: settings \? buildStorefrontUrl/);
  assert.match(ctrl, /websiteEnabled: settings\?\.enabled !== false && siteLive,/);
});

test("REGRESSION: the CSD store page shows the order methods the store can take: Collection only on the Billing plan", async () => {
  const { effectiveOrderToggles } = require("../services/planFeatures");
  const lean = (v) => ({ lean: async () => v });
  const page = (pos) =>
    withFakes(
      "csdRestaurantController.js",
      {
        "../models/storeModel": { findOne: () => lean({ storeId: STORE, storeName: "Store", status: "active" }) },
        // A delivery-and-table store: Collection switched off on the POS plan.
        "../models/restaurantModel": { findOne: () => lean({ _id: "r1", name: "Store", orderTypeToggles: { collection: false, delivery: true, table: true } }) },
        "../models/websiteSettingsModel": { findOne: () => lean({ storeId: STORE, slug: STORE, enabled: true, ordering: { pickupEnabled: false, deliveryEnabled: true } }) },
        "../models/csdStoreChargesModel": { findOne: () => lean(null), DEFAULTS: {} },
        "../services/subscription": { statusFor: async () => null },
        "../services/planFeatures": { featuresOf: async () => ({ pos, website: true }), effectiveOrderToggles },
      },
      "../controllers/csdRestaurantController",
      async ({ getRestaurant }) => {
        const res = { status: (c) => ((res.statusCode = c), res), json: (b) => ((res.body = b), res) };
        let error;
        await getRestaurant({ params: { storeId: STORE }, csdStaff: { role: "admin" } }, res, (e) => (error = e));
        assert.equal(error, undefined, error?.message);
        const { websiteSettings: w, storeProperties: sp } = res.body.data;
        return [[w.collection, w.delivery, w.tableOrders], [sp.orderMethods.collection, sp.orderMethods.delivery, sp.orderMethods.tableOrders]];
      },
    );
  assert.deepEqual(await page(false), [[true, false, false], [true, false, false]], "Billing plan: what the till and website take");
  assert.deepEqual(await page(true), [[false, true, true], [false, true, true]], "POS plan: the store's own switches");
});
