/**
 * services/orderExport: the owner's CSV copy of their order history.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { headerLine, orderRow, cell, HEADER } = require("../services/orderExport");

const helpers = {
  localDate: () => "2026-11-12",
  localTime: () => "13:05",
  orderTotal: (o) => o.bills.totalWithTax,
  refundedTotal: (o) => (o.refunds || []).reduce((s, r) => s + r.amount, 0),
  netAmount: (o) => o.bills.totalWithTax - (o.refunds || []).reduce((s, r) => s + r.amount, 0),
};
const order = (over = {}) => ({
  createdAt: new Date(), orderNumber: "A-101", source: "pos", orderType: "dine-in", orderStatus: "Completed",
  customerDetails: { name: "Asha", phone: "98XXXXX210", company: "Asha Foods", gstin: "19ABCDE1234F1Z5" },
  items: [{ name: "Dosa", quantity: 2, variant: { name: "Large" } }, { name: "Tea", quantity: 1 }, { quantity: 1 }],
  bills: { subtotal: 200, tax: 10, taxPercent: 5, totalWithTax: 210, discount: 0 },
  paymentLabel: "UPI", paymentStatus: "paid",
  ...over,
});
const parse = (line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));

test("one row per order, one column per header", () => {
  const row = parse(orderRow(order(), helpers));
  assert.equal(row.length, HEADER.length);
  assert.equal(parse(headerLine()).length, HEADER.length);
  const at = (name) => row[HEADER.indexOf(name)];
  assert.equal(at("Order no"), "A-101");
  assert.equal(at("Items"), "Dosa (Large) x2; Tea x1", "nameless lines left out");
  assert.equal(at("Total"), "210.00");
  assert.equal(at("GSTIN"), "19ABCDE1234F1Z5");
  assert.equal(at("Phone"), "98XXXXX210");
});

test("refunds show, and net is what was kept", () => {
  const row = parse(orderRow(order({ refunds: [{ amount: 60 }] }), helpers));
  assert.equal(row[HEADER.indexOf("Refunded")], "60.00");
  assert.equal(row[HEADER.indexOf("Net")], "150.00");
});

test("a value a spreadsheet would run as a formula is made plain text", () => {
  for (const evil of ["=HYPERLINK(\"x\")", "+1", "-2+3", "@SUM(A1)"]) assert.equal(cell(evil).startsWith(`"'`), true, evil);
  assert.equal(cell('say "hi"'), '"say ""hi"""');
  const row = parse(orderRow(order({ customerDetails: { name: "=cmd|calc" } }), helpers));
  assert.equal(row[HEADER.indexOf("Customer")], "'=cmd|calc");
});

test("the export route sits beside the report, with the same protection", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../routes/orderRoute.js"), "utf8");
  assert.match(routes, /"\/report\/export"\)\.get\(isVerifiedUser, requireProtectedAction, exportOrdersCsv\)/);
  assert.ok(routes.indexOf('router.route("/report/export")') < routes.indexOf('router.route("/:id")'), "declared before /:id");
});
