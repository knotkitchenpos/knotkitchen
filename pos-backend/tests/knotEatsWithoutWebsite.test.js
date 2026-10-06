/**
 * Knot Eats sells without the website: a store with no Website add-on (or its
 * website switch off) can still be listed and checked out on Knot Eats, while
 * its own subdomain stays off. Store status and the account lock still apply.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");

const realConfig = require("../config/config");

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const STORE = "148379";

/** Load a module with some of its requires replaced; the fakes stay on while `run` runs. */
const withFakes = async (fakes, modulePath, run) => {
  const orig = Module._load;
  Module._load = function (r) {
    if (Object.prototype.hasOwnProperty.call(fakes, r)) return fakes[r];
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

/** The resolver for a store with the website switch off and no Website add-on. */
const resolver = ({ status = "active", locked = false } = {}) => ({
  "../models/websiteSettingsModel": { findOne: async () => ({ storeId: STORE, restaurantId: "r1", enabled: false }) },
  "./websitePublish": { applyPublishedSnapshot: () => {} },
  "../models/storeModel": { findOne: async () => ({ storeId: STORE, status }) },
  "../models/restaurantModel": { findById: async () => ({ _id: "r1", isActive: true }) },
  "./planFeatures": { hasWebsite: async () => false },
  "./accountLock": { isOrderingLocked: async () => locked },
});

test("resolver: the website stays off, Knot Eats gets past the website checks only", async () => {
  const run = (opts, args) =>
    withFakes(resolver(opts), "../services/storefrontResolver", ({ resolveStorefront }) => resolveStorefront(args));

  const site = await run({}, { identifier: STORE });
  assert.deepEqual([site.ok, site.status, site.reason], [false, 403, "WEBSITE_DISABLED"], "the subdomain stays disabled");

  const eats = await run({}, { identifier: STORE, knotEats: true });
  assert.equal(eats.ok, true);

  const locked = await run({ locked: true }, { identifier: STORE, knotEats: true });
  assert.deepEqual([locked.ok, locked.status, locked.reason, locked.locked], [false, 403, "STORE_UNAVAILABLE", true]);

  const suspended = await run({ status: "suspended" }, { identifier: STORE, knotEats: true });
  assert.deepEqual([suspended.ok, suspended.status, suspended.reason], [false, 403, "STORE_UNAVAILABLE"]);
});

test("route: GET /api/eats/stores/:slug/storefront goes through viaKnotEats", () => {
  const router = require("../routes/knotEatsRoute");
  const layer = router.stack.find((l) => l.route?.path === "/stores/:slug/storefront");
  assert.ok(layer?.route.methods.get, "the route exists");
  assert.ok(layer.route.stack.some((s) => s.handle === router.viaKnotEats), "the Knot Eats flag comes from the route");
});

test("source: only the Eats routes ask the resolver for knotEats", () => {
  for (const rel of ["controllers/publicStoreController.js", "services/storeHead.js", "controllers/tableBookingController.js"]) {
    assert.doesNotMatch(SRC(rel), /knotEats:/, rel);
  }
  const ctrl = SRC("controllers/storefrontController.js");
  assert.equal((ctrl.match(/knotEats: req\.knotEats === true/g) || []).length, 1);
  const get = ctrl.slice(ctrl.indexOf("const getStorefront ="), ctrl.indexOf("const buildStorefrontOrder"));
  assert.ok(get.indexOf("getListedStore(ctx.storeId)") > 0, "listing check");
  assert.ok(get.indexOf("getListedStore(ctx.storeId)") < get.indexOf("buildStorefrontPayload("), "before the payload is built");
});

test("source: FSSAI is 14 digits; receipts and CSD do not advertise a disabled website", () => {
  const rc = SRC("controllers/restaurantController.js");
  assert.ok(rc.includes("/^\\d{14}$/"));
  assert.ok(rc.includes("The FSSAI licence number has 14 digits."));
  assert.match(rc, /websiteUrl: \(await hasWebsite\(restaurant\._id, settings\?\.storeId\)\) \? buildStorefrontUrl\(settings\) : "",/);
  assert.match(
    SRC("controllers/csdRestaurantController.js"),
    /websiteEnabled: settings\?\.enabled !== false && \(await hasWebsite\(restaurant\?\._id, storeId\)\),/,
  );
});

/** getStorefront against an in-memory store; `listed` is the Knot Eats listing. */
const storefront = async ({ knotEats = false, listed = true, restaurant = {}, ordering = {} } = {}) => {
  const seen = {};
  const settings = { storeId: STORE, restaurantId: "r1", slug: STORE, enabled: false, ordering };
  const fakes = {
    "../services/storefrontResolver": {
      REASON_MESSAGES: {},
      resolveStorefront: async (opts) => {
        seen.opts = opts;
        return { ok: true, settings, store: { storeId: STORE }, restaurant, restaurantId: "r1", storeId: STORE, timezone: "Asia/Kolkata" };
      },
    },
    "../models/menuModel": { find: () => ({ sort: async () => [] }) },
    "../models/orderModel": { aggregate: async () => [] },
    "../services/orderCharge": { quotePlatformFee: async () => null },
    "../services/knotEats": { getListedStore: async () => (listed ? { storeId: STORE } : null) },
    "../config/config": { ...realConfig, knotEatsPublicUrl: "https://eats.example.com" },
  };
  return withFakes(fakes, "../controllers/storefrontController", async ({ getStorefront }) => {
    const res = { set: () => res, status: (c) => ((res.statusCode = c), res), json: (b) => ((res.body = b), res) };
    let error;
    await getStorefront({ params: { slug: STORE }, headers: { host: "api.example.com" }, ...(knotEats ? { knotEats: true } : {}) }, res, (e) => (error = e));
    return { res, error, seen };
  });
};

test("the Eats store page: listed stores only, and its policy pages name Knot Eats", async () => {
  const eats = await storefront({ knotEats: true });
  assert.equal(eats.error, undefined, eats.error?.message);
  assert.equal(eats.seen.opts.knotEats, true);
  assert.equal(eats.res.body.data.legal.websiteUrl, `https://eats.example.com/store/${STORE}`);

  const gone = await storefront({ knotEats: true, listed: false });
  assert.deepEqual([gone.error?.status, gone.error?.code], [404, "KNOT_EATS_UNAVAILABLE"]);

  const site = await storefront();
  assert.equal(site.seen.opts.knotEats, false, "the website route never skips the website checks");
});

test("the cart's GST is what checkout charges: none without a GST number or when set to System only", async () => {
  const gstin = { taxId: "19ABCDE1234F1Z5" };
  const tax = async (restaurant, ordering) => (await storefront({ restaurant, ordering })).res.body.data.ordering;

  assert.equal((await tax({ taxId: "" }, { taxPercent: 5 })).taxPercent, 0, "no GST number");
  assert.equal((await tax(gstin, { taxPercent: 5, gstApplyTo: "system" })).taxPercent, 0, "System only");
  const charged = await tax(gstin, { taxPercent: 5, taxInclusive: true, gstApplyTo: "both" });
  assert.deepEqual([charged.taxPercent, charged.taxInclusive], [5, true]);
});
