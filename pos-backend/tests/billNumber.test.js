const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { financialYearOf, formatBillNumber, parseBillNumber } = require("../services/billNumber");
const { billRows, gstr1 } = require("../services/accountantExports");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const store = { storeId: "893146", name: "Spice Route Kitchen", gstin: "19ABCDE1234F1Z5", state: "West Bengal" };
const methodOf = (o) => o.payments?.[0]?.method || "cash";
const order = (o) => ({
  _id: o.id,
  orderNumber: o.id,
  orderStatus: "Completed",
  source: "POS",
  createdAt: new Date("2026-11-05T13:00:00+05:30"),
  customerDetails: {},
  payments: [{ method: "cash", amount: 105, status: "paid" }],
  bills: { subtotal: 100, tax: 5, taxPercent: 5, totalWithTax: 105 },
  ...o,
});
const serial = (n, extra = {}) => order({ id: `9${n}`, billNumber: formatBillNumber("2627", n), ...extra });

test("a bill number per store and financial year, at most 16 characters", () => {
  // The year turns at midnight on 1 April, India time.
  assert.equal(financialYearOf(new Date("2026-03-31T18:29:00Z")), "2526");
  assert.equal(financialYearOf(new Date("2026-03-31T18:30:00Z")), "2627");
  assert.equal(financialYearOf(new Date("2027-01-15T10:00:00Z")), "2627");
  assert.equal(formatBillNumber("2627", 7), "2627/000007");
  assert.ok(formatBillNumber("2627", 999999).length <= 16, "CGST Rule 46: at most 16 characters");
  assert.deepEqual(parseBillNumber("2627/000123"), { fy: "2627", seq: 123 });
  assert.equal(parseBillNumber("583721"), null, "an order number is not a bill serial");
});

test("exports use the bill serial; the documents table is the series, void numbers cancelled, gaps called out", () => {
  const rows = billRows([serial(1), serial(2, { orderStatus: "Cancelled", payments: [] }), serial(3), serial(6), order({ id: "583721" })], { methodOf });
  assert.equal(rows[0].number, "2627/000001", "the bill serial, not the order number");
  assert.equal(rows[4].number, "583721", "a bill from before keeps its printed number");
  // 4 was a save that failed (void); 5 is not in the period.
  const g = gstr1({ rows, store, from: "2026-11-01", to: "2026-11-30", voids: ["2627/000004", "2627/000001"] });
  assert.deepEqual(g.docs[0], { nature: "Invoices for outward supply", from: "2627/000001", to: "2627/000006", total: 5, cancelled: 2 });
  assert.deepEqual(g.docs[1], { nature: "Invoices for outward supply (earlier numbering)", from: "583721", to: "583721", total: 1, cancelled: 0 });
  assert.ok(g.warnings.some((w) => w.includes("1 bill number(s) between 2627/000001 and 2627/000006")), g.warnings.join(" | "));
  assert.ok(g.warnings.some((w) => w.includes("before consecutive bill numbers")));
  // A void number an order did get after all (a retried save) is not counted twice.
  const g2 = gstr1({ rows: billRows([serial(1), serial(2)], { methodOf }), store, from: "2026-11-01", to: "2026-11-30", voids: ["2627/000002"] });
  assert.deepEqual([g2.docs[0].total, g2.docs[0].cancelled], [2, 0]);
  assert.equal(g2.docs.length, 1);
});

test("every channel gets its number on the first save; a failed save voids it; offline sales keep their year", () => {
  const model = src("models/orderModel.js");
  assert.match(model, /orderSchema\.pre\("validate", async function stampBillNumber\(\) \{\n  if \(!this\.isNew \|\| this\.billNumber/);
  assert.match(model, /nextBillNumber\(this\.restaurantId, this\.orderDate \|\| this\.createdAt \|\| new Date\(\)\)/);
  assert.match(model, /orderSchema\.post\("save", function voidUnsavedBillNumber\(error, doc, next\)/);
  assert.match(model, /\{ restaurantId: 1, billNumber: 1 \},\n  \{ unique: true, partialFilterExpression: \{ billNumber: \{ \$gt: "" \} \} \}/);
  assert.match(src("routes/offlineRoute.js"), /fakeReq\.offlinePlacedAt = sanePlacedAt\(placedAt\);/);
  assert.match(src("controllers/orderController.js"), /\.\.\.\(offlineSync && req\.offlinePlacedAt \? \{ orderDate: req\.offlinePlacedAt \} : \{\}\)/);
  // The bill carries it: e-bill, CSV, Partners orders search.
  assert.match(src("controllers/publicReceiptController.js"), /r\.billNumber \? line\("Bill No\.", esc\(r\.billNumber\)\)/);
  assert.match(src("services/receiptService.js"), /billNumber: order\?\.billNumber \|\| "",/);
  assert.match(src("services/orderExport.js"), /"Order no", "Bill no"/);
  assert.match(src("routes/partnerRoute.js"), /row\.billNumber/);
});

test("the counter is atomic and the old offline backdate still applies", () => {
  const svc = src("services/billNumber.js");
  assert.match(svc, /findOneAndUpdate\(\n\s+\{ key: `bill:\$\{restaurantId\}:\$\{fy\}` \},\n\s+\{ \$inc: \{ seq: 1 \}/);
  const { backdate } = require("../routes/offlineRoute");
  const placed = new Date(Date.now() - 3600000);
  const set = backdate({ createdAt: new Date() }, placed.toISOString());
  assert.equal(set.orderDate.getTime(), placed.getTime());
  assert.deepEqual(backdate({ createdAt: new Date() }, "2020-01-01"), { isOffline: true, syncStatus: "synced" }, "too old: not trusted");
});
