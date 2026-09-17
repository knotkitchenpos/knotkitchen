/**
 * Refunds and voids: the money rules, and that the routes asking for them
 * are PIN-protected.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { refundableAmount, netAmount, validateRefund, refundedTotal } = require("../services/refunds");

const paid = (extra = {}) => ({ orderStatus: "Completed", bills: { totalWithTax: 500 }, refunds: [], ...extra });

test("a paid order can refund up to its total, less what was already refunded", () => {
  assert.equal(refundableAmount(paid()), 500);
  assert.equal(refundableAmount(paid({ refunds: [{ amount: 120 }] })), 380);
  assert.equal(refundableAmount(paid({ refunds: [{ amount: 500 }] })), 0);
});

test("a cancelled order has nothing to refund and counts nothing", () => {
  const o = paid({ orderStatus: "Cancelled" });
  assert.equal(refundableAmount(o), 0);
  assert.equal(netAmount(o), 0);
});

test("reports count takings net of refunds", () => {
  assert.equal(netAmount(paid()), 500);
  assert.equal(netAmount(paid({ refunds: [{ amount: 120.5 }] })), 379.5);
  assert.equal(netAmount(paid({ orderStatus: "Refunded", refunds: [{ amount: 500 }] })), 0);
  // Refunded before refunds[] existed: nothing on record, count nothing.
  assert.equal(netAmount(paid({ orderStatus: "Refunded" })), 0);
  assert.equal(refundedTotal(paid({ refunds: [{ amount: 1 }, { amount: 2 }] })), 3);
});

test("validateRefund: reason required, amount within what is left, blank = all", () => {
  assert.equal(validateRefund(paid(), { amount: 100, reason: "" }).ok, false);
  assert.equal(validateRefund(paid(), { amount: 600, reason: "late" }).ok, false);
  assert.equal(validateRefund(paid(), { amount: 0, reason: "late" }).ok, false);
  assert.deepEqual(validateRefund(paid(), { reason: "Order was late" }), { ok: true, amount: 500, reason: "Order was late", full: true });
  const part = validateRefund(paid(), { amount: "120.5", reason: "Overcharged" });
  assert.equal(part.ok, true);
  assert.equal(part.amount, 120.5);
  assert.equal(part.full, false);
  assert.equal(validateRefund(paid({ refunds: [{ amount: 500 }] }), { reason: "x" }).ok, false);
});

test("cancel and refund routes need a verified user and the protected-action guard", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "orderRoute.js"), "utf8");
  assert.match(routes, /"\/:id\/cancel"\)\.put\(isVerifiedUser, requireProtectedAction, cancelOrder\)/);
  assert.match(routes, /"\/:id\/refund"\)\.post\(isVerifiedUser, requireProtectedAction, refundOrder\)/);
  const ctrl = fs.readFileSync(path.join(__dirname, "..", "controllers", "orderController.js"), "utf8");
  assert.match(ctrl, /A reason is required to cancel an order/);
  assert.match(ctrl, /const amount = netAmount\(o\)/, "report buckets are net of refunds");
});
