const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { computeTotals, calculateBill } = require("../services/price");
const { buildReportBreakdown } = require("../services/reportBreakdown");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

// ---------------------------------------------------------------------------
// One totals rule for every channel (services/price.computeTotals)
// ---------------------------------------------------------------------------

test("a discount reduces the tax base", () => {
  const t = computeTotals({ subtotal: 200, discount: 50, taxRate: 0.18 });
  assert.equal(t.taxableBase, 150);
  assert.equal(t.tax, 27, "was 36: tax on the undiscounted 200");
  assert.equal(t.totalWithTax, 177);
});

test("a service charge goes on top of the taxed bill and is not taxed", () => {
  const t = computeTotals({ subtotal: 200, serviceChargePercent: 10, taxRate: 0.18 });
  assert.equal(t.taxableBase, 200);
  assert.equal(t.tax, 36, "the charge is outside the tax base");
  assert.equal(t.serviceCharge, 23.6, "10% of 236, the bill after tax");
  assert.equal(t.totalWithTax, 259.6);
});

test("with inclusive prices the service charge is on the bill as it stands", () => {
  const t = computeTotals({ subtotal: 1183, serviceChargePercent: 1, taxRate: 0.05, taxInclusive: true });
  assert.equal(t.serviceCharge, 11.83);
  assert.equal(t.totalWithTax, 1194.83);
});

test("a service charge already struck is added as it is", () => {
  const t = computeTotals({ subtotal: 200, serviceCharge: 20, taxRate: 0.18 });
  assert.equal(t.tax, 36);
  assert.equal(t.totalWithTax, 256);
});

test("packaging is taxed, delivery is not", () => {
  const t = computeTotals({ subtotal: 99, packagingFee: 10, deliveryFee: 40, taxRate: 0.05 });
  assert.equal(t.taxableBase, 109);
  assert.equal(t.tax, 5.45);
  assert.equal(t.totalWithTax, 154.45);
});

test("inclusive tax is extracted, not added", () => {
  const t = computeTotals({ subtotal: 99, taxRate: 0.05, taxInclusive: true });
  assert.equal(t.totalWithTax, 99);
  assert.equal(t.tax, 4.71);
  assert.equal(t.taxInclusive, true);
});

test("no rate means no tax and no inclusive flag", () => {
  const t = computeTotals({ subtotal: 99, taxRate: 0, taxInclusive: true });
  assert.equal(t.tax, 0);
  assert.equal(t.taxInclusive, false);
  assert.equal(t.totalWithTax, 99);
});

test("a discount larger than the bill is clamped, and the total never goes negative", () => {
  const t = computeTotals({ subtotal: 200, discount: 500, taxRate: 0.18 });
  assert.equal(t.discount, 200);
  assert.equal(t.tax, 0);
  assert.equal(t.totalWithTax, 0);
});

test("every figure is rounded to the paisa once", () => {
  const t = computeTotals({ subtotal: 33.333, discount: 0.005, serviceCharge: 1.111, taxRate: 0.05 });
  for (const v of Object.values(t)) {
    if (typeof v === "number") assert.equal(v, Math.round(v * 100) / 100, `${v} carries sub-paisa noise`);
  }
});

test("the table bill is the same rule", () => {
  const bill = calculateBill({
    items: [{ price: 100, quantity: 2 }],
    discount: 50,
    additionalCharges: 15,
    taxRate: 0.18,
  });
  const t = computeTotals({ subtotal: 200, discount: 50, serviceCharge: 15, taxRate: 0.18 });
  assert.equal(bill.tax, t.tax);
  assert.equal(bill.totalWithTax, 192, "150 + 27 tax + 15 charge");
  assert.equal(bill.serviceCharge, 15);
  assert.equal(bill.charges, 15);
  assert.equal(bill.taxPercent, 18);
});

test("SOURCE: the website engine, the table bill and order edits all use computeTotals", () => {
  assert.match(read("services", "orderPricingService.js"), /computeTotals\(\{/);
  assert.match(read("controllers", "onlineOrderController.js"), /computeTotals\(\{/);
  const session = read("controllers", "tableSessionController.js");
  assert.equal((session.match(/taxInclusive: (gst|billGst)\.inclusive/g) || []).length, 2, "both table bill sites pass the flag");
  assert.match(read("controllers", "qrController.js"), /taxInclusive: qrGst\.inclusive/);
});

// ---------------------------------------------------------------------------
// One reading of a stored line
// ---------------------------------------------------------------------------

test("REGRESSION: the report reads a legacy POS line the way the receipt does", () => {
  // A legacy POS line keeps the LINE total in `price` and `total` at 0.
  const orders = [
    {
      orderStatus: "Completed",
      createdAt: new Date("2026-09-17T10:00:00Z"),
      items: [{ name: "Thali", price: 200, quantity: 2, total: 0 }],
    },
  ];
  const out = buildReportBreakdown(orders);
  const thali = out.byItem.find((r) => r.name === "Thali");
  assert.ok(thali);
  assert.equal(thali.amount, 200, "was 400: quantity multiplied back in");
});
