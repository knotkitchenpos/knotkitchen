/**
 * Website and Knot Eats rules (QA batch 8): a product's own Dispatch Type
 * (N037), sold-out dishes in Knot Eats search (N039), the delivery fee of a
 * store website with no customer location (PS2, D7), and "Open now" from the
 * order types the store offers (H1).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const Menu = require("../models/menuModel");
const { allowsOrderType } = require("../services/menuCache");
const { toPublicProduct, buildStorefrontPayload } = require("../controllers/storefrontController");
const { calculateOrderTotals } = require("../services/orderPricingService");

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const oid = () => new mongoose.Types.ObjectId();
const RID = oid();
const TZ = "Asia/Kolkata";

// A category as Publish leaves it: live doc and both snapshots agree.
const published = (cat, item) => {
  const it = { _id: oid(), name: item.name, price: 100, category: cat.name, isAvailable: true, ...item };
  const snap = { name: cat.name, items: [it], published: true, showOnPos: false, dispatchType: cat.dispatchType };
  return new Menu({ name: cat.name, createdBy: oid(), restaurantId: RID, ...cat, items: [it], hasPublishedToSystem: true, systemSnapshot: snap, hasPublishedToWebsite: true, websiteSnapshot: snap });
};

test("N037: a product's own Dispatch Type is shown and enforced on the website and Knot Eats", () => {
  const menu = published({ name: "Desserts" }, { name: "Ice cream tub", dispatchType: { collection: true, delivery: false, table: true } });
  const item = menu.websiteSnapshot.items[0].toObject();
  assert.equal(allowsOrderType(menu, "delivery", item), false);
  const p = toPublicProduct(item, menu, TZ);
  assert.equal(p.dispatchType.delivery, false);
  assert.equal(p.dispatchLabel, "Collection & Table Orders Only");
  assert.throws(
    () => calculateOrderTotals({
      items: [{ menuId: menu._id, itemId: item._id, quantity: 1 }],
      menus: [{ ...menu.toObject(), items: [item] }],
      settings: { ordering: { deliveryEnabled: true, deliveryFee: 0 } },
      orderType: "delivery",
      timezone: TZ,
      distanceKm: 1,
    }),
    /Ice cream tub is not available for delivery/,
  );
});

test("N039: Knot Eats search does not offer a sold-out dish", async (t) => {
  const knotEats = require("../services/knotEats");
  const menu = published({ name: "Mains" }, { name: "Gone biryani", isAvailable: false });
  menu.websiteSnapshot.items.push({ _id: oid(), name: "Dal", price: 90, category: "Mains" });
  t.mock.method(Menu, "find", () => ({ sort: () => [menu] }));
  const dishes = await knotEats.buildStoreDishes({ restaurantId: RID, timezone: TZ });
  assert.equal(dishes.length, 2, "the store still counts its whole menu");
  assert.deepEqual(dishes.filter((d) => d.available !== false).map((d) => d.name), ["Dal"]);
  assert.ok(SRC("services/knotEats.js").includes("const dishes = c.s.dishes.filter((d) => d.available !== false);"), "cards and dish search skip it");
});

test("PS2: a store website delivery (no customer location) is the flat fee the cart showed, with no radius refusal", () => {
  const menuId = oid();
  const itemId = oid();
  const menus = [{ _id: menuId, items: [{ _id: itemId, name: "Thali", price: 300, isAvailable: true }] }];
  const fee = (slabsConfig, line1, distanceKm) =>
    calculateOrderTotals({
      items: [{ menuId, itemId, quantity: 1 }],
      menus,
      settings: { ordering: { deliveryEnabled: true, deliveryFee: 30, deliverySlabsConfig: slabsConfig } },
      restaurant: {},
      orderType: "delivery",
      source: "WEBSITE",
      customerAddress: { line1 },
      storeAddress: { lat: 22.57, lng: 88.36 },
      timezone: TZ,
      distanceKm,
    }).bills.deliveryFee;
  const slabs = { maxDistanceKm: 7, slabs: [{ minKm: 0, maxKm: 2, fee: 20 }, { minKm: 2, maxKm: 5, fee: 40 }] };
  assert.equal(fee(slabs, "12 MG Road"), 30, "not a slab picked from a guessed 2.5 km");
  assert.equal(fee(slabs, "Plot 9, 3 km stone"), 30, "not a distance read from the address words");
  assert.equal(fee({ maxDistanceKm: 2, slabs: [] }, "12 MG Road"), 30, "a 2 km store still takes website delivery");
  // Knot Eats sends a measured km: slabs and radius still apply.
  assert.equal(fee(slabs, "x", 3), 40);
  assert.throws(() => fee(slabs, "x", 9), /exceeds maximum/);
  assert.ok(Number.isNaN(require("../services/distanceService").calculateDistanceKm({ storeAddress: { lat: 22.5, lng: 88.3 }, customerAddress: { line1: "4 km" } })));
});

test("H1: the website's Open now ignores an order type the store does not offer", async () => {
  const shut = { weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: false, openTime: "11:00", closeTime: "15:00" })) };
  const allDay = { weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, openTime: "00:00", closeTime: "00:00" })) };
  // Pickup only and pickup shut all week; delivery's hours would be open, but delivery is not offered.
  const settings = { storeId: "123456", slug: "s", ordering: { pickupEnabled: true, deliveryEnabled: false }, channelHours: { collection: shut, delivery: allDay } };
  const payload = await buildStorefrontPayload({ settings, restaurantId: null, storeId: "123456", timezone: TZ });
  assert.equal(payload.store.isOpen, false);
  assert.equal(payload.store.closedReason, "Pickup is not available today.");
  const offered = await buildStorefrontPayload({ settings: { ...settings, ordering: { pickupEnabled: false, deliveryEnabled: true } }, restaurantId: null, storeId: "123456", timezone: TZ });
  assert.equal(offered.store.isOpen, true, "a delivery-only store open for delivery");
});

test("H1: CSD and the Knot Eats store page use the same Open now rule", () => {
  assert.match(SRC("controllers/csdRestaurantController.js"), /const online = orderingOpen\(settings, channels\);/);
  assert.doesNotMatch(SRC("controllers/csdRestaurantController.js"), /channels\.collection\.open \|\| channels\.delivery\.open/);
  const ke = SRC("services/knotEats.js");
  const detail = ke.slice(ke.indexOf("const storeDetail"), ke.indexOf("const storeReviews"));
  assert.match(detail, /orderingOpen\(\{ ordering: s \}, \{ collection: at\("collection"\), delivery: at\("delivery"\) \}\)/);
  assert.doesNotMatch(detail, /pickup\.isOpen \|\| delivery\.isOpen/);
});
