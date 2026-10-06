/**
 * Shift arithmetic, kept pure so it is testable without a database.
 */
const { isCancelled } = require("../constants/orderStatus");
const { netAmount, refundedTotal } = require("./refunds");

const { round2 } = require("./money");

const bucketOf = (raw) => {
  const m = String(raw || "").trim().toLowerCase();
  if (m === "cash") return "cash";
  if (m === "upi" || m === "qr" || m === "qr_code") return "upi";
  // A card machine at the counter, not Cashfree: its own bucket.
  if (m === "card") return "card";
  if (["online", "gateway", "cashfree", "phonepe", "link", "pay-by-link", "paybylink"].includes(m)) return "gateway";
  return "other";
};

/**
 * cash | upi | card | gateway | other, from how the order was paid. Money that
 * went through Cashfree carries its payment id; a paid pay-by-link order is
 * rewritten to the instrument ("card"), and is not card-machine takings.
 * Reports decide the same way (orderController.reportMethodOf).
 */
const methodOf = (order) =>
  order?.paymentData?.gatewayPaymentId ? "gateway" : bucketOf(order?.payments?.[0]?.method || order?.paymentMethod);

/**
 * How an order's money splits across buckets, as fractions adding to 1.
 * A split bill ("Cash ₹500 + UPI ₹300") has one paid line per part; reading
 * only the first line sent the whole bill to one bucket, so the cash part
 * never reached the drawer's expected cash.
 */
const sharesOf = (order) => {
  const paid = (order?.payments || []).filter(
    (p) => String(p?.status || "").toLowerCase() === "paid" && Number(p.amount) > 0,
  );
  const sum = paid.reduce((t, p) => t + Number(p.amount), 0);
  if (paid.length < 2 || order?.paymentData?.gatewayPaymentId) return [[methodOf(order), 1]];
  return paid.map((p) => [bucketOf(p.method), Number(p.amount) / sum]);
};

/**
 * Totals for the orders of a shift.
 * @param {Array} orders  every order placed during the shift
 * @param {number} openingCash
 */
const shiftSummary = (orders, openingCash = 0) => {
  const s = { orders: 0, cancelled: 0, sales: 0, refunds: 0, cash: 0, upi: 0, card: 0, gateway: 0, other: 0, cashRefunds: 0, tips: 0, cashTips: 0 };
  for (const o of orders || []) {
    if (isCancelled(o.orderStatus)) {
      s.cancelled += 1;
      continue;
    }
    s.orders += 1;
    const net = netAmount(o);
    const refunded = refundedTotal(o);
    const tip = Number(o.tips || o.bills?.tip) || 0;
    s.sales += net;
    s.refunds += refunded;
    s.tips += tip;
    // A split's paid lines include the tip, so the tip and any refund go
    // with each part in proportion.
    for (const [m, share] of sharesOf(o)) {
      s[m] += net * share;
      if (m === "cash") {
        s.cashRefunds += refunded * share;
        s.cashTips += tip * share;
      }
    }
  }
  for (const k of Object.keys(s)) s[k] = round2(s[k]);
  s.expectedCash = round2(Number(openingCash || 0) + s.cash + s.cashTips);
  return s;
};

/** What closing a shift records. */
const closeFigures = (summary, closingCash) => ({
  ...summary,
  difference: round2(Number(closingCash || 0) - Number(summary.expectedCash || 0)),
});

module.exports = { methodOf, shiftSummary, closeFigures };
