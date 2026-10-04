import test from "node:test";
import assert from "node:assert/strict";
import { bestCoupon, couponApplies, couponDiscount, couponNote } from "./eatsOffers.js";

const half = { code: "WELCOME50", type: "percent", value: 50, minOrderAmount: 199, channels: { collection: true, delivery: true } };
const flat = { code: "FLAT100", type: "fixed", value: 100, minOrderAmount: 0, channels: { collection: true, delivery: true } };
const pickupOnly = { code: "PICKUP20", type: "percent", value: 20, minOrderAmount: 0, channels: { collection: true, delivery: false } };

test("percent and fixed discounts, never more than the subtotal", () => {
  assert.equal(couponDiscount(half, 250), 125);
  assert.equal(couponDiscount({ ...half, value: 15 }, 199), 29.85);
  assert.equal(couponDiscount(flat, 400), 100);
  assert.equal(couponDiscount(flat, 60), 60);
  assert.equal(couponDiscount(null, 100), 0);
});

test("minimum order and channel decide whether a coupon applies", () => {
  assert.equal(couponApplies(half, { subtotal: 198, orderType: "pickup" }), false);
  assert.equal(couponApplies(half, { subtotal: 199, orderType: "pickup" }), true);
  assert.equal(couponApplies(pickupOnly, { subtotal: 500, orderType: "delivery" }), false);
  assert.equal(couponApplies(pickupOnly, { subtotal: 500, orderType: "pickup" }), true);
  // No channels block on the server = open to both.
  assert.equal(couponApplies({ ...flat, channels: undefined }, { subtotal: 1, orderType: "delivery" }), true);
});

test("bestCoupon picks the biggest saving that applies", () => {
  const offers = [half, flat, pickupOnly];
  assert.equal(bestCoupon(offers, { subtotal: 150, orderType: "pickup" }).code, "FLAT100"); // 50% needs 199
  assert.equal(bestCoupon(offers, { subtotal: 400, orderType: "pickup" }).code, "WELCOME50"); // 200 > 100 > 80
  assert.equal(bestCoupon([pickupOnly], { subtotal: 400, orderType: "delivery" }), null);
  assert.equal(bestCoupon([], { subtotal: 400, orderType: "pickup" }), null);
});

test("a chosen coupon that stops applying says why", () => {
  assert.equal(couponNote(half, { subtotal: 120, orderType: "pickup" }), "WELCOME50 needs ₹199+");
  assert.equal(couponNote(pickupOnly, { subtotal: 120, orderType: "delivery" }), "PICKUP20 is for pickup orders only");
  assert.equal(couponNote(half, { subtotal: 300, orderType: "pickup" }), "");
});
