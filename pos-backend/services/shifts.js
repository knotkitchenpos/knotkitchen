/**
 * Shift arithmetic, kept pure so it is testable without a database.
 */
const { isCancelled } = require("../constants/orderStatus");
const { netAmount, refundedTotal } = require("./refunds");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** cash | upi | gateway | other, from how the order was paid. */
const methodOf = (order) => {
  const raw = String(order?.payments?.[0]?.method || order?.paymentMethod || "").trim().toLowerCase();
  if (raw === "cash") return "cash";
  if (raw === "upi" || raw === "qr") return "upi";
  if (["online", "card", "gateway", "cashfree", "phonepe", "link", "pay-by-link", "paybylink"].includes(raw)) return "gateway";
  return "other";
};

/**
 * Totals for the orders of a shift.
 * @param {Array} orders  every order placed during the shift
 * @param {number} openingCash
 */
const shiftSummary = (orders, openingCash = 0) => {
  const s = { orders: 0, cancelled: 0, sales: 0, refunds: 0, cash: 0, upi: 0, gateway: 0, other: 0, cashRefunds: 0 };
  for (const o of orders || []) {
    if (isCancelled(o.orderStatus)) {
      s.cancelled += 1;
      continue;
    }
    s.orders += 1;
    const net = netAmount(o);
    const refunded = refundedTotal(o);
    s.sales += net;
    s.refunds += refunded;
    const m = methodOf(o);
    s[m] += net;
    if (m === "cash") s.cashRefunds += refunded;
  }
  for (const k of Object.keys(s)) s[k] = round2(s[k]);
  s.expectedCash = round2(Number(openingCash || 0) + s.cash);
  return s;
};

/** What closing a shift records. */
const closeFigures = (summary, closingCash) => ({
  ...summary,
  difference: round2(Number(closingCash || 0) - Number(summary.expectedCash || 0)),
});

module.exports = { methodOf, shiftSummary, closeFigures };
