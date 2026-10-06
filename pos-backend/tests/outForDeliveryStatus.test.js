const test = require("node:test");
const assert = require("node:assert/strict");

const S = require("../constants/orderStatus");

/**
 * Delivery orders: Ready -> Out for delivery -> Delivered.
 *
 * The vocabulary had no dispatched state, so the update endpoint refused it
 * ("Invalid order status") and a delivery jumped straight from Ready to
 * Complete. It is a live state: the order can still be cancelled or completed.
 */

test("Out for delivery is a live status the update endpoint accepts", () => {
  assert.equal(S.OUT_FOR_DELIVERY, "Out for delivery");
  assert.ok(S.ALLOWED_STATUS_TRANSITIONS.has(S.OUT_FOR_DELIVERY));
  assert.ok(S.ALLOWED_STATUS_TRANSITIONS.has(S.DELIVERED), "and the step after it");
  assert.ok(S.ACTIVE_STATUSES.includes(S.OUT_FOR_DELIVERY));
  assert.ok(!S.isFinished(S.OUT_FOR_DELIVERY), "it can still be cancelled or completed");
  assert.ok(!S.isSettled(S.OUT_FOR_DELIVERY), "the money is not counted until it is delivered");
});

test("its other spellings read as the same status", () => {
  for (const s of ["out for delivery", "Dispatched", "dispatched"]) {
    assert.equal(S.canonicalStatus(s), S.OUT_FOR_DELIVERY, s);
    assert.ok(S.OUT_FOR_DELIVERY_STATUSES.includes(s), s);
  }
});

test("an accepted customer order has its own constant", () => {
  // Written instead of Preparing so the till does not read an accepted QR
  // order as a new, undecided one.
  assert.equal(S.ACCEPTED, "In Progress");
  assert.equal(S.canonicalStatus(S.ACCEPTED), S.PREPARING, "the order list still shows it as cooking");
});
