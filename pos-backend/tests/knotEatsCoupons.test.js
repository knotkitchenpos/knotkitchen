/**
 * Rules & Charges now saves (F1), coupons run on the store's clock (F3), and
 * veg means veg (F4). Coupon use at checkout -- the per-phone limit, the code
 * on the order and the use count -- is in knotEatsCheckout.test.js, which has
 * the checkout harness.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const WebsiteSettings = require("../models/websiteSettingsModel");
const { isRuleEligible, calculateOrderTotals } = require("../services/orderPricingService");
const { effectiveVeg } = require("../services/menuCache");
const { toPublicProduct } = require("../controllers/storefrontController");

/** PUT /api/website/settings against an in-memory settings document. */
const save = async (body, seed = {}, req = {}) => {
  const settings = new WebsiteSettings({ storeId: "231146", slug: "231146", ...seed });
  let saves = 0;
  settings.save = async () => { saves += 1; return settings; };
  let invalidations = 0;
  const fakes = {
    "../services/auditService": { logActivity: async () => {} },
    "../services/knotEats": { invalidateListing: () => { invalidations += 1; } },
  };
  const orig = Module._load;
  Module._load = function (r) {
    if (Object.prototype.hasOwnProperty.call(fakes, r)) return fakes[r];
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  let error;
  try {
    const { updateWebsiteSettings } = require("../controllers/websiteSettingsController");
    const res = { status: () => res, json: () => res };
    await updateWebsiteSettings(
      { user: { role: "Owner" }, websiteTarget: { tenant: { storeId: "231146" }, settings }, body, ...req },
      res,
      (err) => { error = err; },
    );
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  }
  return { error, settings, saves, invalidations };
};

test("coupons are saved, normalised and deduplicated; quantityUsed comes from the stored coupon, never the body", async () => {
  const { error, settings, saves, invalidations } = await save(
    {
      couponsConfig: [
        { code: " welcome50 ", type: "percent", value: 50, minOrderAmount: 199, quantityUsed: 0, usageLimitPerPhone: 1,
          channels: { collection: true, delivery: false }, daysOfWeek: [5, 6, 6], startTime: "16:00", endTime: "19:00",
          validFrom: "2026-10-01", validUntil: "2026-10-31" },
        { code: "FLAT40", type: "fixed", value: 40, quantityUsed: 999 },
      ],
    },
    { couponsConfig: [{ code: "WELCOME50", type: "percent", value: 10, quantityUsed: 7 }] },
  );
  assert.equal(error, undefined, error?.message);
  assert.equal(saves, 1);
  assert.equal(invalidations, 1, "Knot Eats re-reads the store");
  const [welcome, flat] = settings.couponsConfig;
  assert.deepEqual(
    [welcome.code, welcome.value, welcome.minOrderAmount, welcome.quantityUsed, welcome.usageLimitPerPhone],
    ["WELCOME50", 50, 199, 7, 1],
  );
  assert.deepEqual([welcome.channels.collection, welcome.channels.delivery], [true, false]);
  assert.deepEqual([...welcome.daysOfWeek], [5, 6]);
  assert.deepEqual([welcome.startTime, welcome.endTime], ["16:00", "19:00"]);
  assert.equal(welcome.validUntil.toISOString().slice(0, 10), "2026-10-31");
  assert.deepEqual([flat.code, flat.type, flat.quantityUsed, flat.quantityTotal], ["FLAT40", "fixed", 0, 100], "a new code starts at 0");
});

test("a bad coupon is refused with field errors and nothing is saved", async () => {
  const bad = [
    [{ code: "AB", value: 10 }, "couponsConfig.0.code"],
    [{ code: "SAVE-10", value: 10 }, "couponsConfig.0.code"],
    [{ code: "SAVE10", type: "bogo", value: 10 }, "couponsConfig.0.type"],
    [{ code: "SAVE10", value: 0 }, "couponsConfig.0.value"],
    [{ code: "SAVE10", value: 120 }, "couponsConfig.0.value"],
    [{ code: "SAVE10", value: 10, minOrderAmount: -1 }, "couponsConfig.0.minOrderAmount"],
    [{ code: "SAVE10", value: 10, quantityTotal: -1 }, "couponsConfig.0.quantityTotal"],
    [{ code: "SAVE10", value: 10, usageLimitPerPhone: 1.5 }, "couponsConfig.0.usageLimitPerPhone"],
    [{ code: "SAVE10", value: 10, validFrom: "2026-10-31", validUntil: "2026-10-01" }, "couponsConfig.0.validUntil"],
    [{ code: "SAVE10", value: 10, validFrom: "not a date" }, "couponsConfig.0.validFrom"],
    [{ code: "SAVE10", value: 10, daysOfWeek: [7] }, "couponsConfig.0.daysOfWeek"],
    [{ code: "SAVE10", value: 10, startTime: "4pm" }, "couponsConfig.0.startTime"],
    [{ code: "SAVE10", value: 10, channels: { delivery: "yes" } }, "couponsConfig.0.channels.delivery"],
  ];
  for (const [coupon, field] of bad) {
    const { error, saves } = await save({ couponsConfig: [coupon] });
    assert.equal(error?.status, 400, JSON.stringify(coupon));
    assert.ok(error.fieldErrors[field], `${field} for ${JSON.stringify(coupon)}`);
    assert.equal(saves, 0);
  }
  const dupe = await save({ couponsConfig: [{ code: "SAVE10", value: 10 }, { code: "save10", value: 5 }] });
  assert.match(dupe.error.fieldErrors["couponsConfig.1.code"], /already used/);
  const many = await save({ couponsConfig: Array.from({ length: 31 }, (_, i) => ({ code: `CODE${i}`, value: 5 })) });
  assert.ok(many.error.fieldErrors.couponsConfig);
});

test("the delivery radius and slabs are saved within range, sorted; out of range is refused", async () => {
  const { error, settings } = await save({
    ordering: { deliverySlabsConfig: { maxDistanceKm: 6, slabs: [{ minKm: 3, maxKm: 6, fee: 40 }, { minKm: 0, maxKm: 3, fee: 20 }] } },
  });
  assert.equal(error, undefined, error?.message);
  const cfg = settings.ordering.deliverySlabsConfig;
  assert.equal(cfg.maxDistanceKm, 6);
  assert.deepEqual(cfg.slabs.map((s) => [s.minKm, s.maxKm, s.fee]), [[0, 3, 20], [3, 6, 40]]);

  for (const [slabsConfig, field] of [
    [{ maxDistanceKm: 31 }, "ordering.deliverySlabsConfig.maxDistanceKm"],
    [{ maxDistanceKm: 0.2 }, "ordering.deliverySlabsConfig.maxDistanceKm"],
    [{ slabs: [{ minKm: 3, maxKm: 3, fee: 10 }] }, "ordering.deliverySlabsConfig.slabs.0"],
    [{ slabs: [{ minKm: 0, maxKm: 31, fee: 10 }] }, "ordering.deliverySlabsConfig.slabs.0"],
    [{ slabs: [{ minKm: 0, maxKm: 3, fee: 1001 }] }, "ordering.deliverySlabsConfig.slabs.0"],
    [{ slabs: Array.from({ length: 11 }, (_, i) => ({ minKm: i, maxKm: i + 1, fee: 0 })) }, "ordering.deliverySlabsConfig.slabs"],
  ]) {
    const out = await save({ ordering: { deliverySlabsConfig: slabsConfig } });
    assert.equal(out.error?.status, 400, JSON.stringify(slabsConfig));
    assert.ok(out.error.fieldErrors[field], field);
  }
});

test("free-item rules and minimum orders are saved too", async () => {
  const { error, settings } = await save({
    freeItemConfig: [{ itemName: "Gulab Jamun", minOrderAmount: 500, applyTo: "both", isActive: true }],
    ordering: { minOrderConfig: { delivery: { enabled: true, amount: 249, applyTo: "website" } } },
  });
  assert.equal(error, undefined, error?.message);
  assert.deepEqual(
    [settings.freeItemConfig[0].itemName, settings.freeItemConfig[0].minOrderAmount, settings.freeItemConfig[0].applyTo],
    ["Gulab Jamun", 500, "both"],
  );
  const d = settings.ordering.minOrderConfig.delivery;
  assert.deepEqual([d.enabled, d.amount, d.applyTo], [true, 249, "website"]);
  assert.equal(settings.ordering.minOrderConfig.collection.enabled, false, "other channels untouched");

  for (const [body, field] of [
    [{ freeItemConfig: [{ itemName: "  " }] }, "freeItemConfig.0.itemName"],
    [{ freeItemConfig: [{ itemName: "Lassi", applyTo: "everyone" }] }, "freeItemConfig.0.applyTo"],
    [{ freeItemConfig: [{ itemName: "Lassi", menuItemId: "nope" }] }, "freeItemConfig.0.menuItemId"],
    [{ ordering: { minOrderConfig: { table: { amount: -5 } } } }, "ordering.minOrderConfig.table.amount"],
    [{ ordering: { minOrderConfig: { table: { applyTo: "pos" } } } }, "ordering.minOrderConfig.table.applyTo"],
  ]) {
    const out = await save(body);
    assert.equal(out.error?.status, 400, JSON.stringify(body));
    assert.ok(out.error.fieldErrors[field], field);
  }
});

test("a 4-7 PM IST coupon runs 4-7 PM IST on a UTC server, and dates end at the store's midnight", (t) => {
  const rule = { startTime: "16:00", endTime: "19:00" };
  const at = (iso, r = rule) =>
    isRuleEligible({ rule: r, channel: "collection", environment: "website", date: new Date(iso), timezone: "Asia/Kolkata" });
  assert.equal(at("2026-10-04T11:00:00Z"), true, "16:30 IST");
  assert.equal(at("2026-10-04T14:00:00Z"), false, "19:30 IST");
  assert.equal(at("2026-10-04T17:00:00Z"), false, "22:30 IST, though 17:00 UTC is inside the window");

  // A date picked as "2026-10-04" (stored as UTC midnight) lasts to IST midnight.
  const until = { validUntil: new Date("2026-10-04T00:00:00Z") };
  assert.equal(at("2026-10-04T18:00:00Z", until), true, "23:30 IST on the 4th");
  assert.equal(at("2026-10-04T19:00:00Z", until), false, "00:30 IST on the 5th");
  const from = { validFrom: new Date("2026-10-05T00:00:00Z") };
  assert.equal(at("2026-10-04T19:00:00Z", from), true, "already the 5th in IST");

  // Weekdays too: 2026-10-04 is a Sunday; 00:30 IST on the 5th is Monday.
  assert.equal(at("2026-10-04T19:00:00Z", { daysOfWeek: [1] }), true);
  assert.equal(at("2026-10-04T19:00:00Z", { daysOfWeek: [0] }), false);

  // And checkout prices with it, on the store clock.
  const naan = { _id: "i1", name: "Naan", price: 100, showOnWebsite: true, isAvailable: true };
  const price = () =>
    calculateOrderTotals({
      items: [{ menuId: "m1", itemId: "i1", quantity: 1 }],
      menus: [{ _id: "m1", items: [naan] }],
      settings: { ordering: {}, couponsConfig: [{ code: "TEA", type: "fixed", value: 20, ...rule }] },
      couponCode: "TEA",
      timezone: "Asia/Kolkata",
    }).bills.discount;
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-04T11:00:00Z") });
  assert.equal(price(), 20);
  t.mock.timers.setTime(new Date("2026-10-04T17:00:00Z").getTime());
  assert.throws(price, /not applicable/);
});

test("effective veg: meat, fish or egg in the name or category takes the veg mark away", () => {
  assert.equal(effectiveVeg({ name: "Chicken Biryani", isVegetarian: true }, "Biryani"), false);
  assert.equal(effectiveVeg({ name: "Eggless Cake", isVegetarian: true }, "Desserts"), true);
  assert.equal(effectiveVeg({ name: "Dal Makhani", isVegetarian: true }, "Mains"), true);
  assert.equal(effectiveVeg({ name: "Masala Omelette" }, "Breakfast"), false);
  assert.equal(effectiveVeg({ name: "Platter", isVegetarian: true }, "Fish"), false, "the category counts");
  assert.equal(effectiveVeg({ name: "Paneer Tikka", isVegetarian: false }, "Starters"), false, "never adds the mark");

  const product = toPublicProduct({ _id: "i1", name: "Chicken Momos", price: 120, isVegetarian: true }, { _id: "m1", name: "Momos" }, "Asia/Kolkata");
  assert.equal(product.isVegetarian, false);
  const veg = toPublicProduct({ _id: "i2", name: "Veg Momos", price: 100, isVegetarian: true }, { _id: "m1", name: "Momos" }, "Asia/Kolkata");
  assert.equal(veg.isVegetarian, true);
});

test("a whole-document save (Manage Website) or a CSD website edit never writes the Rules & Charges keys", async () => {
  const seed = {
    couponsConfig: [{ code: "NEW10", type: "percent", value: 10, quantityUsed: 3 }],
    freeItemConfig: [{ itemName: "Raita", minOrderAmount: 300 }],
    ordering: { deliverySlabsConfig: { maxDistanceKm: 10, slabs: [{ minKm: 0, maxKm: 10, fee: 30 }] } },
  };
  // The copy an editor loaded before NEW10 existed, with a legacy code the
  // validator would refuse: neither may reach the stored rules.
  const stale = {
    displayName: "Spice Hub",
    couponsConfig: [{ code: "OLD-5", value: 5 }],
    freeItemConfig: [],
    ordering: { deliverySlabsConfig: { maxDistanceKm: 7, slabs: [] } },
  };
  for (const [body, req] of [[{ ...stale, version: 4 }, {}], [stale, { csdStaff: { staffId: "CSD001" } }]]) {
    const { error, settings, saves } = await save(body, seed, req);
    assert.equal(error, undefined, error?.message);
    assert.equal(saves, 1);
    assert.equal(settings.displayName, "Spice Hub", "the rest of the save still lands");
    assert.deepEqual(settings.couponsConfig.map((c) => [c.code, c.quantityUsed]), [["NEW10", 3]]);
    assert.deepEqual(settings.freeItemConfig.map((r) => r.itemName), ["Raita"]);
    assert.equal(settings.ordering.deliverySlabsConfig.maxDistanceKm, 10);
    assert.equal(settings.ordering.deliverySlabsConfig.slabs.length, 1);
  }
});
