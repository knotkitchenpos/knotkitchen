const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { shiftSummary, closeFigures, methodOf } = require("../services/shifts");

const order = (status, total, method, refunds = []) => ({
  orderStatus: status,
  bills: { totalWithTax: total },
  paymentMethod: method,
  refunds,
});

test("a shift sums sales by payment method, net of refunds, and skips cancelled orders", () => {
  const s = shiftSummary(
    [
      order("Completed", 500, "cash"),
      order("Completed", 300, "upi"),
      order("Completed", 200, "online"),
      order("Completed", 100, "cash", [{ amount: 40 }]),
      order("Cancelled", 999, "cash"),
    ],
    1000,
  );
  assert.equal(s.orders, 4);
  assert.equal(s.cancelled, 1);
  assert.equal(s.sales, 1060);
  assert.equal(s.refunds, 40);
  assert.equal(s.cash, 560);
  assert.equal(s.upi, 300);
  assert.equal(s.gateway, 200);
  assert.equal(s.cashRefunds, 40);
  assert.equal(s.expectedCash, 1560, "float + cash takings (already net of cash refunds)");
});

test("closing records the difference between counted and expected cash", () => {
  const s = shiftSummary([order("Completed", 500, "cash")], 200);
  assert.equal(closeFigures(s, 690).difference, -10);
  assert.equal(closeFigures(s, 700).difference, 0);
  assert.equal(closeFigures(s, 712.5).difference, 12.5);
});

test("payment methods map to the four drawer buckets", () => {
  assert.equal(methodOf({ payments: [{ method: "cash" }] }), "cash");
  assert.equal(methodOf({ paymentMethod: "UPI" }), "upi");
  assert.equal(methodOf({ paymentMethod: "card" }), "gateway");
  assert.equal(methodOf({}), "other");
});

test("open and close are PIN-protected and the route is mounted", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "shiftRoute.js"), "utf8");
  assert.match(routes, /"\/open"\)\.post\(isVerifiedUser, requireProtectedAction, openShift\)/);
  assert.match(routes, /"\/close"\)\.post\(isVerifiedUser, requireProtectedAction, closeShift\)/);
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.ok(app.includes('app.use("/api/shift", require("./routes/shiftRoute"))'));
});
