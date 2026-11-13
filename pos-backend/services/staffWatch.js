/**
 * Staff watch for the Partners dashboard: per store and staff member, what
 * they sold, discounted, cancelled and refunded in a period, and who stands
 * out from their colleagues. Pure: from one store's report views
 * (controllers/orderController reportFor), each order with createdBy {name}.
 *
 * Who is who
 *   - sold and discounted: the staff member who rang the order up (createdBy);
 *     a customer's own order (QR, website, Knot Eats) is "Customers (online)";
 *   - a cancelled order: cancelledBy (the till, or who rejected it online);
 *   - a cancelled line: the line's cancelledBy (recorded from 13 Nov 2026;
 *     earlier ones are "Not recorded");
 *   - a refund: the refund entry's refundedByName.
 *
 * Flags: a member whose cancelled, discounted or refunded share of their own
 * sales is at least twice the store's and above a floor, with enough cases
 * not to be noise; and any cancellation of a bill that had been paid.
 */

const { netAmount, orderTotal, wasPaid } = require("./refunds");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CANCELLED = /cancel/i;
const ONLINE = "Customers (online)";
const NOT_RECORDED = "Not recorded";

const lineValue = (i) => {
  const total = Number(i?.total);
  if (total > 0) return total;
  return (Number(i?.price) || 0) * (Number(i?.quantity) || 1);
};

const blank = (name) => ({
  name,
  orders: 0,
  sales: 0,
  discounts: 0,
  discountAmount: 0,
  cancelledOrders: 0,
  cancelledAmount: 0,
  cancelledPaid: 0,
  cancelledLines: 0,
  cancelledLineAmount: 0,
  refunds: 0,
  refundAmount: 0,
  reasons: {},
  flags: [],
});

/**
 * @param {Array} orders  one store's report views
 * @returns {{ staff: Array, store: object, events: Array }}
 */
const staffWatch = (orders = []) => {
  const people = new Map();
  const who = (name) => {
    const key = String(name || "").trim() || NOT_RECORDED;
    if (!people.has(key)) people.set(key, blank(key));
    return people.get(key);
  };
  const events = [];

  for (const o of orders) {
    const takenBy = o.createdBy?.name || (o.createdBy ? NOT_RECORDED : ONLINE);
    const cancelled = CANCELLED.test(String(o.orderStatus || ""));
    const at = o.orderDate || o.createdAt;
    const ref = o.billNumber || o.orderNumber || String(o._id || "").slice(-6);

    if (!cancelled) {
      const p = who(takenBy);
      p.orders += 1;
      p.sales = round2(p.sales + netAmount(o));
      const discount = Number(o.bills?.discount) || 0;
      if (discount > 0) {
        p.discounts += 1;
        p.discountAmount = round2(p.discountAmount + discount);
      }
    } else {
      const p = who(String(o.cancelledBy || "").trim() || NOT_RECORDED);
      p.cancelledOrders += 1;
      p.cancelledAmount = round2(p.cancelledAmount + orderTotal(o));
      const reason = String(o.cancelReason || "").trim() || "No reason given";
      p.reasons[reason] = (p.reasons[reason] || 0) + 1;
      // A bill that was paid and then cancelled: the money should have gone back.
      if (wasPaid(o) || (o.payments || []).some((x) => x?.status === "paid")) {
        p.cancelledPaid += 1;
        events.push({ kind: "paid-cancelled", by: p.name, ref, at, amount: orderTotal(o), reason });
      }
    }

    // Lines struck off an order that went ahead.
    if (!cancelled) {
      for (const i of o.items || []) {
        if (String(i?.status || "") !== "cancelled") continue;
        const p = who(i.cancelledBy || NOT_RECORDED);
        p.cancelledLines += 1;
        p.cancelledLineAmount = round2(p.cancelledLineAmount + lineValue(i));
      }
    }

    for (const r of o.refunds || []) {
      if (r?.status && r.status !== "SUCCESS") continue;
      const p = who(r.refundedByName || NOT_RECORDED);
      p.refunds += 1;
      p.refundAmount = round2(p.refundAmount + (Number(r.amount) || 0));
      if (Number(r.amount) >= 1000) events.push({ kind: "refund", by: p.name, ref, at: r.refundedAt || at, amount: round2(r.amount), reason: r.reason || "" });
    }
  }

  const staff = [...people.values()];
  const sum = (f) => round2(staff.reduce((s, p) => s + p[f], 0));
  const store = {
    sales: sum("sales"),
    orders: sum("orders"),
    discountAmount: sum("discountAmount"),
    cancelledAmount: round2(sum("cancelledAmount") + sum("cancelledLineAmount")),
    refundAmount: sum("refundAmount"),
  };
  const base = store.sales || 1;
  const rate = (n, of) => (of > 0 ? round2((n / of) * 100) : 0);
  store.cancelRate = rate(store.cancelledAmount, base);
  store.discountRate = rate(store.discountAmount, base);
  store.refundRate = rate(store.refundAmount, base);

  for (const p of staff) {
    // A member's rates against what they sold (or, with no sales, against the store's).
    const own = p.sales > 0 ? p.sales : base;
    p.cancelRate = rate(p.cancelledAmount + p.cancelledLineAmount, own);
    p.discountRate = rate(p.discountAmount, own);
    p.refundRate = rate(p.refundAmount, own);
    const outlier = (mine, all, floor, cases) => cases >= 3 && mine >= floor && mine >= 2 * Math.max(all, 0.01);
    if (p.name !== ONLINE) {
      if (outlier(p.cancelRate, store.cancelRate, 5, p.cancelledOrders + p.cancelledLines))
        p.flags.push(`Cancels ${p.cancelRate}% of sales, the store ${store.cancelRate}%`);
      if (outlier(p.discountRate, store.discountRate, 5, p.discounts))
        p.flags.push(`Discounts ${p.discountRate}% of sales, the store ${store.discountRate}%`);
      if (outlier(p.refundRate, store.refundRate, 3, p.refunds))
        p.flags.push(`Refunds ${p.refundRate}% of sales, the store ${store.refundRate}%`);
    }
    if (p.cancelledPaid > 0) p.flags.push(`Cancelled ${p.cancelledPaid} bill(s) that had been paid`);
    p.reasons = Object.entries(p.reasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => ({ reason, count }));
  }

  staff.sort((a, b) => b.flags.length - a.flags.length || b.cancelledAmount + b.cancelledLineAmount - (a.cancelledAmount + a.cancelledLineAmount) || b.sales - a.sales);
  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return { staff, store, events: events.slice(0, 50) };
};

module.exports = { staffWatch, ONLINE, NOT_RECORDED };
