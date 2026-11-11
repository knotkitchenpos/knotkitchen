/**
 * Mongoose 8.24.7+ (the fix for GHSA-gg4r-jv3p-qx3c and friends) silently
 * drops a dotted-path set that runs through an embedded document, then a
 * plain nested object, then another embedded document. Nothing errors; the
 * value is just not saved.
 *
 * Every dotted write the backend does is checked here on the real models, so
 * a future upgrade that breaks one fails a test instead of losing settings.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const WebsiteSettings = require("../models/websiteSettingsModel");
const Menu = require("../models/menuModel");
const billing = require("../models/platformBillingModel");

const fresh = () => WebsiteSettings.hydrate({ _id: new mongoose.Types.ObjectId(), ordering: { currency: "INR" } });

test("minimum order per channel saves (the write websiteSettingsController does)", () => {
  const s = fresh();
  if (!s.ordering.minOrderConfig.delivery) s.ordering.minOrderConfig.delivery = {};
  Object.assign(s.ordering.minOrderConfig.delivery, { enabled: true, amount: 249, applyTo: "website" });
  assert.deepEqual(s.toObject().ordering.minOrderConfig.delivery, { enabled: true, amount: 249, applyTo: "website" });
  assert.match(JSON.stringify(s.getChanges()), /249/, "and it is in what would be saved");
});

test("the controller does not use the dotted form for minimum orders", () => {
  const src = require("node:fs").readFileSync(require.resolve("../controllers/websiteSettingsController"), "utf8");
  assert.doesNotMatch(src, /\.set\(`ordering\.minOrderConfig\./);
});

test("delivery slabs save by dotted path", () => {
  const s = fresh();
  s.set("ordering.deliverySlabsConfig.maxDistanceKm", 12);
  s.set("ordering.deliverySlabsConfig.slabs", [{ minKm: 0, maxKm: 3, fee: 20 }]);
  const d = s.toObject().ordering.deliverySlabsConfig;
  assert.equal(d.maxDistanceKm, 12);
  assert.equal(d.slabs.length, 1);
});

test("channel hours save by dotted path (CSD website editor)", () => {
  const s = fresh();
  s.set("channelHours.delivery.weekly", [{ day: "monday", isOpen: true, openTime: "09:00", closeTime: "17:00" }]);
  assert.equal(s.toObject().channelHours.delivery.weekly.length, 1);
});

test("a menu item's channel prices save by dotted path", () => {
  const menu = new Menu({ name: "Main" });
  menu.items.push({ name: "Dosa", price: 10 });
  menu.items[0].set("channelPrices.posCollection", 55);
  assert.equal(menu.items[0].toObject().channelPrices.posCollection, 55);
});

test("the platform plan price saves by dotted path", () => {
  const Platform = Object.values(billing).find((m) => m?.schema?.path?.("basePlan.pricePaise"));
  const p = new Platform({});
  p.set("basePlan.pricePaise", 12345);
  assert.equal(p.toObject().basePlan.pricePaise, 12345);
});
