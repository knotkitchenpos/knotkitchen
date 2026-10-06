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

test("REGRESSION: a cancelled order is in no card; an unpaid one is in no paid card", () => {
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
  // A diner ordering at a till-opened table used to create a QR order. The QR
  // route now adds its round through the same helper (live-orders/N3), so the
  // line above covers it too.
  assert.match(SRC("controllers", "qrController.js"), /await addRoundToKitchenOrder\(\{ session, validatedItems,/);
});

test("REGRESSION: card, split and unpaid orders each land in one payment card, the cards sum to Total, tips are reported", () => {
  // Card and split settles were in no card, unpaid orders could not be, and
  // tips were never summed, so the payment cards never added up to Total.
  const s = buildReportBuckets([
    order({ payments: [{ method: "card", status: "paid" }], bills: { totalWithTax: 278, tip: 22 }, tips: 22 }),
    order({ isSplit: true, payments: [{ method: "cash", status: "paid" }, { method: "upi", status: "paid" }] }),
    // A split written before parts kept their own method.
    order({ payments: [{ method: "split", status: "paid" }, { method: "split", status: "paid" }] }),
    order({ paymentMethod: "Cash" }),
    order({ orderStatus: "Preparing" }),
    // Pay-by-link, rewritten to the instrument once paid: still gateway money.
    order({ paymentMethod: "upi", payments: [{ method: "upi", status: "paid" }], paymentData: { gatewayPaymentId: "cf_1" } }),
  ]);
  assert.deepEqual(s.card, { count: 1, amount: 278 });
  assert.deepEqual(s.split, { count: 2, amount: 200 });
  assert.deepEqual(s.cash, { count: 1, amount: 100 });
  assert.deepEqual(s.gateway, { count: 1, amount: 100 });
  assert.deepEqual(s.other, { count: 1, amount: 100 });
  assert.deepEqual(s.upi, { count: 0, amount: 0 });
  const methods = ["cash", "upi", "card", "gateway", "split", "other"];
  assert.equal(methods.reduce((n, k) => n + s[k].count, 0), s.total.count);
  assert.equal(methods.reduce((n, k) => n + s[k].amount, 0), s.total.amount);
  // Tips are not sales: reported on their own, outside Total.
  assert.deepEqual(s.tips, { count: 1, amount: 22 });
  assert.equal(s.total.amount, 778);
});

test("REGRESSION: the report totals every order in the period, not the newest 1,000", () => {
  const ctrl = SRC("controllers", "orderController.js");
  const fn = ctrl.slice(ctrl.indexOf("const getOrdersReport"), ctrl.indexOf("const getPopularItems"));
  assert.ok(!/\.limit\(1000\)/.test(fn.slice(0, fn.indexOf("buildReportBuckets"))), "totals come from a capped list");
  assert.match(fn, /orders: projected\.slice\(0, 1000\),\s*\n\s*truncated: projected\.length > 1000/);
});

test("each report row names its payment the way its card does", () => {
  const { reportOrderView } = require("../controllers/orderController");
  const label = (o) => reportOrderView(order(o)).paymentLabel;
  assert.equal(label({ paymentMethod: "cash" }), "Cash");
  assert.equal(label({ paymentMethod: "CARD", payments: [{ method: "card" }] }), "Card");
  assert.equal(label({ paymentMethod: "PaymentLink" }), "Payment Gateway");
  assert.equal(label({ isSplit: true, paymentMethod: "Split (Cash ₹50.00 + UPI ₹50.00)" }), "Split (Cash ₹50.00 + UPI ₹50.00)");
  assert.equal(label({}), "—");
});
