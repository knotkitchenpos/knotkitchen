/**
 * Refunds and voids: the money rules, and that the routes asking for them
 * are guarded. The lifecycle itself is in refundLifecycle.test.js.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { refundableAmount, netAmount, refundedTotal, paidViaGateway, paymentKindOf, refundStatusOf } = require("../services/refunds");

test("how an order was paid decides whether the gateway is involved at all", () => {
  assert.equal(paidViaGateway({ payments: [{ method: "online" }] }), true);
  assert.equal(paidViaGateway({ paymentMethod: "Payment Gateway" }), true);
  assert.equal(paidViaGateway({ paymentData: { gatewayOrderId: "kk_123" }, paymentMethod: "Cash" }), true);
  assert.equal(paidViaGateway({ payments: [{ method: "cash" }] }), false);
  assert.equal(paidViaGateway({ paymentMethod: "UPI" }), false);
  assert.equal(paymentKindOf({ paymentMethod: "Cash" }), "cash");
  assert.equal(paymentKindOf({ paymentMethod: "UPI" }), "offline");
  assert.equal(paymentKindOf({ paymentMethod: "Card" }), "offline");
  assert.equal(paymentKindOf({ paymentMethod: "Split (Cash ₹100 + UPI ₹50)" }), "offline");
  assert.equal(paymentKindOf({}), "none");
  const cf = fs.readFileSync(path.join(__dirname, "..", "services", "gateways", "cashfree.js"), "utf8");
  assert.match(cf, /path: `\/orders\/\$\{encodeURIComponent\(orderId\)\}\/refunds`/);
  assert.match(cf, /refund_speed: "STANDARD"/);
});

const gateway = (extra = {}) => ({
  orderStatus: "Cancelled",
  bills: { totalWithTax: 500 },
  payments: [{ method: "online", amount: 500, status: "paid" }],
  paymentData: { gatewayOrderId: "kk_1" },
  refunds: [],
  ...extra,
});

test("a cancelled gateway order can refund up to what was paid, less what already went back", () => {
  assert.equal(refundableAmount(gateway()), 500);
  assert.equal(refundableAmount(gateway({ refunds: [{ amount: 120, status: "SUCCESS" }] })), 380);
  assert.equal(refundableAmount(gateway({ refunds: [{ amount: 500, status: "SUCCESS" }] })), 0);
  // A failed attempt returned nothing.
  assert.equal(refundableAmount(gateway({ refunds: [{ amount: 500, status: "FAILED" }] })), 500);
});

test("an order that is not cancelled, or not gateway-paid, has nothing to refund", () => {
  assert.equal(refundableAmount(gateway({ orderStatus: "Completed" })), 0);
  assert.equal(refundableAmount(gateway({ paymentData: {}, payments: [{ method: "cash", amount: 500, status: "paid" }] })), 0);
  assert.equal(refundStatusOf(gateway({ paymentData: {}, payments: [{ method: "upi", amount: 500, status: "paid" }] })), "NOT_APPLICABLE");
});

test("reports count takings net of refunds; a cancelled order counts nothing", () => {
  const paid = (extra = {}) => ({ orderStatus: "Completed", bills: { totalWithTax: 500 }, refunds: [], ...extra });
  assert.equal(netAmount(paid()), 500);
  assert.equal(netAmount(paid({ refunds: [{ amount: 120.5 }] })), 379.5);
  assert.equal(netAmount(paid({ orderStatus: "Cancelled" })), 0);
  assert.equal(netAmount(paid({ orderStatus: "Refunded", refunds: [{ amount: 500 }] })), 0);
  // Refunded before refunds[] existed: nothing on record, count nothing.
  assert.equal(netAmount(paid({ orderStatus: "Refunded" })), 0);
  assert.equal(refundedTotal(paid({ refunds: [{ amount: 1 }, { amount: 2 }] })), 3);
  // Only money Cashfree confirmed counts as returned.
  assert.equal(refundedTotal(paid({ refunds: [{ amount: 1, status: "SUCCESS" }, { amount: 2, status: "PENDING" }, { amount: 4, status: "FAILED" }] })), 1);
});

test("cancel needs the PIN guard; refund is for the owner only", () => {
  const { isManagerUser } = require("../middlewares/requirePermission");
  assert.equal(isManagerUser({ role: "Owner" }), true);
  assert.equal(isManagerUser({ role: "Manager" }), true);
  assert.equal(isManagerUser({ role: "Admin" }), true);
  assert.equal(isManagerUser({ role: "Cashier" }), false);
  assert.equal(isManagerUser({ role: "Staff" }), false);
  assert.equal(isManagerUser(null), false);
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "orderRoute.js"), "utf8");
  assert.match(routes, /"\/:id\/cancel"\)\.put\(isVerifiedUser, requireProtectedAction, cancelOrder\)/);
  assert.match(routes, /"\/:id\/refund"\)\.post\(isVerifiedUser, requireOwnerOnly, refundOrder\)/);
  const ctrl = fs.readFileSync(path.join(__dirname, "..", "controllers", "orderController.js"), "utf8");
  assert.match(ctrl, /A reason is required to cancel an order/);
  assert.match(ctrl, /const amount = netAmount\(o\)/, "report buckets are net of refunds");
});
