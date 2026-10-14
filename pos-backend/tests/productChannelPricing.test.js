/**
 * Per-channel product pricing and per-surface availability.
 *
 * Both features were stored on the model and read by NOTHING:
 *
 *   - "Same price for all channels" OFF wrote per-channel figures onto the
 *     product and every surface, and every bill, still used `item.price`.
 *   - Display Status OFF removed a product from both surfaces with no way to
 *     keep it live on one.
 *
 * One price source now (D1): the three POS channel prices bill on the till,
 * the table QR, the website and Knot Eats alike. The website* figures still
 * stored on old products are ignored.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { getChannelPrice, unitPriceNow, isItemAvailableNow } = require("../services/businessHours");
const { toPublicProduct } = require("../controllers/storefrontController");

const TZ = "Asia/Kolkata";
const menu = { _id: "m1", name: "Burgers" };

const channelPriced = () => ({
  _id: "i1",
  name: "Burger",
  price: 100,
  samePrice: false,
  channelPrices: {
    posCollection: 90,
    posDelivery: 110,
    posTable: 95,
    websiteCollection: 120,
    websiteDelivery: 150,
    websiteTable: 130,
  },
});

test("each POS channel bills its own price", () => {
  const item = channelPriced();
  assert.equal(getChannelPrice(item, "collection"), 90);
  assert.equal(getChannelPrice(item, "delivery"), 110);
  assert.equal(getChannelPrice(item, "table"), 95);
});

test("website and Knot Eats bill the POS channel prices; stored website* figures are ignored", () => {
  assert.deepEqual(toPublicProduct(channelPriced(), menu, TZ).prices, { collection: 90, delivery: 110 });
});

test("the till and the website charge the same figure for the same channel", () => {
  const item = channelPriced();
  assert.equal(getChannelPrice(item, "delivery"), 110);
  assert.equal(getChannelPrice(item, "delivery"), toPublicProduct(item, menu, TZ).prices.delivery);
});

test("'Same price for all channels' ON ignores the stored channel figures", () => {
  const item = { ...channelPriced(), samePrice: true };
  for (const ch of ["collection", "delivery", "table"]) {
    assert.equal(getChannelPrice(item, ch), 100);
  }
});

test("a missing or zero channel figure falls back to the base price", () => {
  const partial = { price: 100, samePrice: false, channelPrices: { posCollection: 0 } };
  assert.equal(getChannelPrice(partial, "collection"), 100, "0 means unset, not free");
  assert.equal(getChannelPrice(partial, "delivery"), 100);
});

test("BACKWARD COMPAT: a product with no channelPrices is unaffected", () => {
  assert.equal(getChannelPrice({ price: 250 }, "delivery"), 250);
  assert.equal(unitPriceNow({ price: 250 }, "collection", TZ), 250);
});

test("an active price rule still overrides the channel price", () => {
  // Happy Hour must beat the channel list price, not the other way round.
  const item = {
    ...channelPriced(),
    priceRules: [{ isActive: true, price: 55, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:59" }],
  };
  assert.equal(unitPriceNow(item, "delivery", TZ), 55);
});

test("an unknown channel prices as collection, never item.price", () => {
  // Pricing a channel-priced product at item.price is the exact trap behind
  // "the menu shows ₹4, the bill charges ₹6".
  assert.equal(unitPriceNow(channelPriced(), undefined, TZ), 90);
});

// --- per-surface availability -----------------------------------------------

test("Display Status OFF still hides the product from both surfaces by default", () => {
  const off = { isAvailable: false };
  assert.equal(isItemAvailableNow(off, TZ, "pos"), false);
  assert.equal(isItemAvailableNow(off, TZ, "website"), false);
});

test("Display OFF + POS Visibility keeps it selling on the tills only", () => {
  const item = { isAvailable: false, visibleOnPosWhenOff: true };
  assert.equal(isItemAvailableNow(item, TZ, "pos"), true);
  assert.equal(isItemAvailableNow(item, TZ, "website"), false);
});

test("Display OFF + Website Visibility keeps it selling online only", () => {
  const item = { isAvailable: false, visibleOnWebsiteWhenOff: true };
  assert.equal(isItemAvailableNow(item, TZ, "website"), true);
  assert.equal(isItemAvailableNow(item, TZ, "pos"), false);
});

test("BACKWARD COMPAT: omitting the surface keeps the old all-or-nothing rule", () => {
  assert.equal(isItemAvailableNow({ isAvailable: false, visibleOnWebsiteWhenOff: true }, TZ), false);
  assert.equal(isItemAvailableNow({ isAvailable: true }, TZ), true);
});

test("a rescued product is still subject to its schedule", () => {
  const outsideHours = {
    isAvailable: false,
    visibleOnWebsiteWhenOff: true,
    schedule: { enabled: true, startTime: "03:00", endTime: "03:01", daysOfWeek: [] },
  };
  assert.equal(isItemAvailableNow(outsideHours, TZ, "website"), false);
});
