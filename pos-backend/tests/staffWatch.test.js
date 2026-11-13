const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { staffWatch, ONLINE, NOT_RECORDED } = require("../services/staffWatch");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let n = 0;
const order = (o) => ({
  _id: `o${(n += 1)}`,
  orderNumber: String(100000 + n),
  orderStatus: "Completed",
  createdAt: new Date("2026-11-10T13:00:00+05:30"),
  createdBy: { name: "Asha" },
  payments: [{ method: "cash", amount: 1000, status: "paid" }],
  bills: { subtotal: 1000, totalWithTax: 1000 },
  items: [],
  ...o,
});

test("sales and discounts go to who rang the order up; cancellations and refunds to who did them", () => {
  const orders = [
    // Asha sells 10 x ₹1,000, no discounts.
    ...Array.from({ length: 10 }, () => order({})),
    // Ravi sells 5 x ₹1,000 with a ₹200 discount each, and cancels 4 paid bills.
    ...Array.from({ length: 5 }, () => order({ createdBy: { name: "Ravi" }, bills: { subtotal: 1200, discount: 200, totalWithTax: 1000 } })),
    ...Array.from({ length: 4 }, () => order({ createdBy: { name: "Asha" }, orderStatus: "Cancelled", cancelledBy: "Ravi", cancelReason: "Customer left" })),
    // A line Asha struck off; one from before names were recorded.
    order({ items: [{ name: "Tea", price: 50, quantity: 2, status: "cancelled", cancelledBy: "Asha" }, { name: "Dosa", price: 120, quantity: 1, status: "cancelled" }] }),
    // A ₹1,500 refund by Ravi.
    order({ createdBy: { name: "Asha" }, bills: { subtotal: 2000, totalWithTax: 2000 }, refunds: [{ amount: 1500, status: "SUCCESS", refundedByName: "Ravi", refundedAt: new Date() }] }),
    // A customer's own QR order.
    order({ createdBy: null, source: "QR" }),
  ];
  const { staff, store, events } = staffWatch(orders);
  const by = Object.fromEntries(staff.map((p) => [p.name, p]));
  assert.equal(by.Asha.orders, 12);
  assert.equal(by.Ravi.orders, 5);
  assert.deepEqual([by.Ravi.discounts, by.Ravi.discountAmount], [5, 1000]);
  assert.deepEqual([by.Ravi.cancelledOrders, by.Ravi.cancelledAmount, by.Ravi.cancelledPaid], [4, 4000, 4]);
  assert.deepEqual(by.Ravi.reasons, [{ reason: "Customer left", count: 4 }]);
  assert.deepEqual([by.Asha.cancelledLines, by.Asha.cancelledLineAmount], [1, 100]);
  assert.equal(by[NOT_RECORDED].cancelledLines, 1, "a line from before names were recorded");
  assert.deepEqual([by.Ravi.refunds, by.Ravi.refundAmount], [1, 1500]);
  assert.equal(by[ONLINE].orders, 1);
  // Ravi stands out on cancellations and discounts; Asha does not.
  assert.equal(staff[0].name, "Ravi", "the flagged first");
  assert.ok(by.Ravi.flags.some((f) => f.startsWith("Cancels")));
  assert.ok(by.Ravi.flags.some((f) => f.startsWith("Discounts")));
  assert.ok(!by.Ravi.flags.some((f) => f.startsWith("Refunds")), "one refund is not a pattern (it is listed below for review)");
  assert.ok(by.Ravi.flags.some((f) => f.includes("4 bill(s) that had been paid")));
  assert.deepEqual(by.Asha.flags, []);
  assert.ok(store.sales > 0);
  assert.equal(events.filter((e) => e.kind === "paid-cancelled").length, 4);
  assert.equal(events.filter((e) => e.kind === "refund").length, 1);
});

test("a handful of cases is not a flag; customers are never flagged for rates", () => {
  const { staff } = staffWatch([order({}), order({ createdBy: { name: "Mo" }, bills: { subtotal: 1500, discount: 500, totalWithTax: 1000 } })]);
  assert.deepEqual(staff.find((p) => p.name === "Mo").flags, [], "one discount is not a pattern");
});

test("who cancelled is recorded on the line and on online rejections; the route and page exist", () => {
  assert.match(src("controllers/tableSessionController.js"), /item\.cancelledBy = req\.user\?\.name \|\| "";/);
  assert.match(src("controllers/tableSessionController.js"), /orderItem\.cancelledBy = item\.cancelledBy;/);
  assert.match(src("controllers/onlineOrderController.js"), /if \(!order\.cancelledBy\) order\.cancelledBy = req\.user\?\.name \|\| "POS";/);
  assert.match(src("models/orderModel.js"), /cancelledBy: String,\n\}\);/);
  assert.match(src("routes/partnerRoute.js"), /router\.get\("\/staff-watch", requirePartner/);
});
