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

test("REGRESSION N012: a paid order that was cancelled is a refund in Reports, not a vanished sale", () => {
  const { buildReportBreakdown } = require("../services/reportBreakdown");
  const voided = order({
    source: "POS",
    orderStatus: "Cancelled",
    createdAt: "2026-10-12T08:00:00.000Z",
    payments: [{ method: "cash", amount: 100, status: "paid" }],
    refunds: [{ amount: 100, status: "SUCCESS", channel: "cash" }],
    items: [{ name: "Thali", quantity: 1, total: 100 }],
  });
  assert.deepEqual(buildReportBuckets([voided]).total, { count: 1, amount: 0 });
  assert.deepEqual(buildReportBreakdown([voided]).adjustments, [{ name: "Refunds", amount: -100 }]);
  const src = SRC("controllers", "orderController.js");
  assert.match(src, /if \(cancelling && paid\) await refundOnCancel\(order/, "the void records the refund");
});

test("REGRESSION N014: a nameless line left by a failed add is no dish in Reports", () => {
  const { buildReportBreakdown } = require("../services/reportBreakdown");
  const o = order({ createdAt: "2026-10-12T08:00:00.000Z", items: [{ name: "Thali", quantity: 1, total: 100 }, { quantity: 1, total: 0 }] });
  assert.deepEqual(buildReportBreakdown([o]).byItem.map((r) => r.name), ["Thali"]);
});

test("REGRESSION N012: a refunded cancel's tip went back too, so Tips do not count it", () => {
  // Settled ₹500 + ₹50 tip, then voided: the cash refund of ₹550 includes the tip.
  const voided = order({
    orderStatus: "Cancelled",
    bills: { totalWithTax: 500, tip: 50 },
    tips: 50,
    payments: [{ method: "cash", amount: 550, status: "paid" }],
    refunds: [{ amount: 550, status: "SUCCESS", channel: "cash" }],
  });
  const s = buildReportBuckets([voided]);
  assert.deepEqual(s.total, { count: 1, amount: 0 });
  assert.deepEqual(s.tips, { count: 0, amount: 0 });
});

test("REGRESSION N012: a rejected prepaid order keeps its dishes, with no phantom Other adjustments", () => {
  const { buildReportBreakdown } = require("../services/reportBreakdown");
  // Rejecting strikes every line (updateOnlineOrderStatus); the refund gives back the whole ₹450.
  const rejected = order({
    source: "WEBSITE",
    orderStatus: "Cancelled",
    createdAt: "2026-10-12T08:00:00.000Z",
    bills: { totalWithTax: 450, tax: 20, deliveryFee: 30 },
    payments: [{ method: "online", amount: 450, status: "paid" }],
    refunds: [{ amount: 450, status: "SUCCESS" }],
    items: [{ name: "Biryani", quantity: 1, total: 400, status: "cancelled" }],
  });
  const b = buildReportBreakdown([rejected]);
  assert.deepEqual(b.byItem.map((r) => [r.name, r.amount]), [["Biryani", 400]]);
  assert.deepEqual(b.adjustments, [{ name: "Tax & charges", amount: 50 }, { name: "Refunds", amount: -450 }]);
  // A dish struck before a paid table was voided was never in the bill: still not a dish.
  const voided = order({
    orderStatus: "Cancelled",
    createdAt: "2026-10-12T08:00:00.000Z",
    payments: [{ method: "cash", amount: 100, status: "paid" }],
    refunds: [{ amount: 100, status: "SUCCESS", channel: "cash" }],
    items: [{ name: "Thali", quantity: 1, total: 100 }, { name: "Lassi", quantity: 1, total: 60, status: "cancelled" }],
  });
  assert.deepEqual(buildReportBreakdown([voided]).byItem.map((r) => r.name), ["Thali"]);
});

test("REGRESSION N014: the Reports order list and drawer drop a nameless line (lean read, no model hook)", () => {
  const { reportOrderView } = require("../controllers/orderController");
  const row = reportOrderView(order({ items: [{ name: "Thali", quantity: 1, total: 100 }, { quantity: 1, total: 0 }] }));
  assert.deepEqual(row.items.map((i) => i.name), ["Thali"]);
});

test("REGRESSION R1: an unpaid order is Unpaid / Other, not Cash or Gateway, and its row says pending", () => {
  const { reportOrderView } = require("../controllers/orderController");
  // A website cash order waiting at the counter, and a pay-by-link order nobody paid.
  const webCashWaiting = { source: "WEBSITE", orderType: "collection", orderStatus: "Ready", paymentMethod: "cash",
    payments: [{ method: "cash", amount: 500, status: "pending" }], bills: { totalWithTax: 500 } };
  const linkUnpaid = { source: "POS", orderType: "delivery", orderStatus: "Preparing", paymentMethod: "Pay by Link", payments: [], bills: { totalWithTax: 300 } };
  const s = buildReportBuckets([webCashWaiting, linkUnpaid, order({ paymentMethod: "Cash" })]);
  assert.deepEqual(s.other, { count: 2, amount: 800 });
  assert.deepEqual(s.cash, { count: 1, amount: 100 });
  assert.deepEqual(s.gateway, { count: 0, amount: 0 });
  assert.equal(reportOrderView(linkUnpaid).paymentStatus, "pending");
  assert.equal(reportOrderView(order({ paymentMethod: "Cash" })).paymentStatus, "paid", "a settled till sale with no payment line is paid");
  assert.match(fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", "src", "pages", "Reports.jsx"), "utf8"), /value=\{order\.paymentStatus \|\| "pending"\}/);
});

test("REGRESSION R2: voids have their own card, so Total + Cancelled is every order in the list", () => {
  const list = [
    order({ paymentMethod: "Cash" }),
    order({ orderStatus: "Cancelled", paymentMethod: "Cash", bills: { totalWithTax: 250 } }),
    // Refunded void: already in Total, as a refund (N012).
    order({ orderStatus: "Cancelled", payments: [{ method: "cash", amount: 100, status: "paid" }], refunds: [{ amount: 100, status: "SUCCESS", channel: "cash" }] }),
  ];
  const s = buildReportBuckets(list);
  assert.deepEqual(s.cancelled, { count: 1, amount: 250 });
  assert.equal(s.total.count + s.cancelled.count, list.length);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", "src", "pages", "Reports.jsx"), "utf8"), /\{ key: "cancelled", label: "Cancelled Orders"/);
});
