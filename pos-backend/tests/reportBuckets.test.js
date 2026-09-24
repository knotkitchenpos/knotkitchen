const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildReportBuckets } = require("../controllers/orderController");

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

const order = (o) => ({ orderStatus: "Completed", bills: { totalWithTax: 100 }, ...o });

/**
 * Reports: where an order was started and how it was paid are separate
 * questions, and every card is a count and a value.
 */
test("source buckets follow where the order started, not how it was paid", () => {
  const s = buildReportBuckets([
    // Till order later paid through the table QR gateway: still System.
    order({ source: "POS", orderType: "dine-in", payments: [{ method: "online", status: "paid" }] }),
    order({ source: "PHONE", orderType: "delivery", paymentMethod: "Cash" }),
    order({ source: "WEBSITE", orderType: "collection", paymentMethod: "online" }),
    order({ source: "WEBSITE", orderType: "delivery", paymentMethod: "cash" }),
    // QR table settled in cash at the counter: still Table QR.
    order({ source: "QR", orderType: "dine-in", payments: [{ method: "cash", status: "paid" }] }),
    order({ source: "QR", orderType: "dine-in", payments: [{ method: "qr_code", status: "paid" }] }),
    order({ source: "MARKETPLACE", orderType: "delivery" }),
  ]);

  assert.deepEqual(s.total, { count: 7, amount: 700 });
  assert.deepEqual(s.system, { count: 2, amount: 200 });
  assert.deepEqual(s.website, { count: 2, amount: 200 });
  assert.deepEqual(s.tableQr, { count: 2, amount: 200 });
  assert.deepEqual(s.outside, { count: 1, amount: 100 });

  assert.deepEqual(s.cash, { count: 3, amount: 300 });
  assert.deepEqual(s.upi, { count: 1, amount: 100 });
  assert.deepEqual(s.gateway, { count: 2, amount: 200 });

  assert.deepEqual(s.delivery, { count: 3, amount: 300 });
  assert.deepEqual(s.collection, { count: 1, amount: 100 });
});

test("REGRESSION: a cancelled order is in no card; an unpaid one has no method", () => {
  // A cancelled website order read as "Website Orders 1 · Rs 0" and
  // "Gateway Orders 1 · Rs 0", and made Total Orders one too high.
  const s = buildReportBuckets([
    order({ source: "POS", orderStatus: "Cancelled", paymentMethod: "Cash" }),
    order({ source: "WEBSITE", orderStatus: "Cancelled", paymentMethod: "online" }),
    order({ source: "POS", orderStatus: "Preparing" }),
  ]);
  assert.deepEqual(s.total, { count: 1, amount: 100 });
  assert.deepEqual(s.website, { count: 0, amount: 0 });
  assert.deepEqual(s.cash, { count: 0, amount: 0 });
  assert.deepEqual(s.upi, { count: 0, amount: 0 });
  assert.deepEqual(s.gateway, { count: 0, amount: 0 });
});

test("REGRESSION: a table keeps the source of whoever opened it", () => {
  // The till adding a round to a QR-opened table used to create a POS order.
  assert.match(SRC("controllers", "tableSessionController.js"), /source: session\.source === "QR" \? "QR" : "POS"/);
  // A diner ordering at a till-opened table used to create a QR order.
  assert.match(SRC("controllers", "qrController.js"), /source: session\.source === "POS" \? "POS" : "QR"/);
});
