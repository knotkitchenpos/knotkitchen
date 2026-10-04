/**
 * A Knot Eats order is a website order to every POS flow (source "WEBSITE"),
 * but the POS can tell it apart: its own report card, and `salesChannel` on
 * the order list and on the new-order alert.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildReportBuckets } = require("../controllers/orderController");
const { toPosOrderView } = require("../controllers/onlineOrderController");
const { orderCreatedPayload } = require("../services/socket");

const order = (source, over = {}) => ({
  source, orderStatus: "Completed", orderType: "takeaway",
  bills: { totalWithTax: 100 }, payments: [{ method: "cash", amount: 100, status: "paid" }], ...over,
});

test("Knot Eats orders get their own report card, and the source cards still sum to the total", () => {
  const s = buildReportBuckets([
    order("POS"),
    order("WEBSITE"),
    order("WEBSITE", { salesChannel: "KNOT_EATS" }),
    order("WEBSITE", { salesChannel: "KNOT_EATS", orderType: "delivery" }),
    order("QR"),
    order("MARKETPLACE"),
    order("WEBSITE", { salesChannel: "KNOT_EATS", orderStatus: "Cancelled" }),
  ]);
  assert.deepEqual(s.knotEats, { count: 2, amount: 200 });
  assert.deepEqual(s.website, { count: 1, amount: 100 });
  assert.deepEqual(s.total, { count: 6, amount: 600 });
  const sources = ["system", "website", "knotEats", "tableQr", "outside"];
  assert.equal(sources.reduce((n, k) => n + s[k].count, 0), s.total.count);
  assert.equal(sources.reduce((n, k) => n + s[k].amount, 0), s.total.amount);
});

test("the POS order view and the new-order alert carry salesChannel; the alert still keys off source", () => {
  const eats = { _id: "e".repeat(24), source: "WEBSITE", salesChannel: "KNOT_EATS", items: [] };
  assert.equal(toPosOrderView(eats).salesChannel, "KNOT_EATS");
  assert.equal(toPosOrderView({ ...eats, salesChannel: undefined }).salesChannel, "", "older orders read as the website");

  const payload = orderCreatedPayload(eats, "231146");
  assert.deepEqual([payload.source, payload.salesChannel], ["WEBSITE", "KNOT_EATS"]);
  assert.equal(orderCreatedPayload({ ...eats, salesChannel: "" }).salesChannel, "");
});
