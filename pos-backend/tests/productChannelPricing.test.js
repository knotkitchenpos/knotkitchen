/**
 * Per-channel product pricing and per-surface availability.
 *
 * Both features were stored on the model and read by NOTHING:
 *
 *   - "Same price for all channels" OFF wrote six figures onto the product
 *     (posCollection/posDelivery/posTable + the website trio) and every
 *     surface, and every bill, still used `item.price`.
 *   - Display Status OFF removed a product from both surfaces with no way to
 *     keep it live on one.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { getChannelPrice, getEffectivePrice, isItemAvailableNow } = require("../services/businessHours");

const TZ = "Asia/Kolkata";

const channelPriced = () => ({
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
  assert.equal(getChannelPrice(item, "system", "collection"), 90);
  assert.equal(getChannelPrice(item, "system", "delivery"), 110);
  assert.equal(getChannelPrice(item, "system", "table"), 95);
});

test("each website channel bills its own price", () => {
  const item = channelPriced();
  assert.equal(getChannelPrice(item, "website", "collection"), 120);
  assert.equal(getChannelPrice(item, "website", "delivery"), 150);
  assert.equal(getChannelPrice(item, "website", "table"), 130);
});

test("POS and website prices for the same channel are independent", () => {
  const item = channelPriced();
  assert.notEqual(
    getChannelPrice(item, "system", "delivery"),
    getChannelPrice(item, "website", "delivery"),
  );
});

test("'Same price for all channels' ON ignores the stored channel figures", () => {
  const item = { ...channelPriced(), samePrice: true };
  for (const env of ["system", "website"]) {
    for (const ch of ["collection", "delivery", "table"]) {
      assert.equal(getChannelPrice(item, env, ch), 100);
    }
  }
});

test("a missing or zero channel figure falls back to the base price", () => {
  const partial = { price: 100, samePrice: false, channelPrices: { posCollection: 0 } };
  assert.equal(getChannelPrice(partial, "system", "collection"), 100, "0 means unset, not free");
  assert.equal(getChannelPrice(partial, "website", "delivery"), 100);
});

test("BACKWARD COMPAT: a product with no channelPrices is unaffected", () => {
  assert.equal(getChannelPrice({ price: 250 }, "website", "delivery"), 250);
  assert.equal(getEffectivePrice({ price: 250 }, TZ), 250);
});

test("an active price rule still overrides the channel price", () => {
  // Happy Hour must beat the channel list price, not the other way round.
  const item = {
    ...channelPriced(),
    priceRules: [{ isActive: true, price: 55, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:59" }],
  };
  assert.equal(getEffectivePrice(item, TZ, { environment: "website", channel: "delivery" }), 55);
});

test("getEffectivePrice without a channel keeps its old meaning", () => {
  assert.equal(getEffectivePrice(channelPriced(), TZ), 100);
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
