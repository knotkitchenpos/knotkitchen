/**
 * The Partners dashboard's figures, from each store's own sales report
 * (controllers/orderController reportFor): the cards are that report's
 * buckets added up, so a store's numbers here are the ones its POS report
 * shows. Pure: no database.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const addBuckets = (into, from) => {
  for (const [k, v] of Object.entries(from || {})) {
    const b = into[k] || (into[k] = { count: 0, amount: 0 });
    b.count += Number(v?.count) || 0;
    b.amount = round2(b.amount + (Number(v?.amount) || 0));
  }
  return into;
};

/** The headline numbers of a summary. */
const headline = (summary = {}) => {
  const total = summary.total || { count: 0, amount: 0 };
  return {
    sales: round2(total.amount),
    orders: total.count,
    average: total.count ? round2(total.amount / total.count) : 0,
    cancelled: summary.cancelled?.count || 0,
    cancelledAmount: round2(summary.cancelled?.amount || 0),
  };
};

/** Change from `before` to `now` as a percentage, or null when there was nothing before. */
const change = (now, before) => (before ? round2(((now - before) / before) * 100) : null);

const mergeRows = (lists, key, fields) => {
  const map = new Map();
  for (const list of lists) {
    for (const r of list || []) {
      const k = r[key];
      const row = map.get(k) || { [key]: k, ...Object.fromEntries(fields.map((f) => [f, 0])) };
      for (const f of fields) row[f] = round2(row[f] + (Number(r[f]) || 0));
      map.set(k, row);
    }
  }
  return [...map.values()];
};

const CHANNELS = [
  ["system", "POS"],
  ["website", "Website"],
  ["knotEats", "Knot Eats"],
  ["tableQr", "Table QR"],
  ["outside", "Swiggy / Zomato"],
];
const PAYMENTS = [
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["card", "Card"],
  ["gateway", "Online"],
  ["split", "Split"],
  ["other", "Other"],
];

const split = (summary, list) =>
  list.map(([k, label]) => ({ key: k, label, count: summary[k]?.count || 0, amount: round2(summary[k]?.amount || 0) })).filter((r) => r.count > 0);

/**
 * @param {{ stores: Array<{ storeId, name, report, previous }> }} input
 */
const aggregateDashboard = ({ stores = [] }) => {
  const combined = {};
  const combinedPrev = {};
  const perStore = stores.map((s) => {
    addBuckets(combined, s.report?.summary);
    addBuckets(combinedPrev, s.previous?.summary);
    const now = headline(s.report?.summary);
    const before = headline(s.previous?.summary);
    return {
      storeId: s.storeId,
      name: s.name,
      ...now,
      salesChange: change(now.sales, before.sales),
      ordersChange: change(now.orders, before.orders),
    };
  });
  const now = headline(combined);
  const before = headline(combinedPrev);

  const items = mergeRows(stores.map((s) => s.report?.breakdown?.byItem), "name", ["quantity", "amount"])
    .sort((a, b) => b.quantity - a.quantity || b.amount - a.amount)
    .slice(0, 10);
  const byHour = mergeRows(stores.map((s) => s.report?.breakdown?.byHour), "hour", ["count", "amount"]).sort((a, b) => a.hour - b.hour);
  const daily = mergeRows(stores.map((s) => s.report?.daily), "day", ["count", "amount"]).sort((a, b) => String(a.day).localeCompare(String(b.day)));

  return {
    totals: {
      ...now,
      tips: round2(combined.tips?.amount || 0),
      salesChange: change(now.sales, before.sales),
      ordersChange: change(now.orders, before.orders),
      averageChange: change(now.average, before.average),
      previous: before,
    },
    stores: perStore.sort((a, b) => b.sales - a.sales),
    channels: split(combined, CHANNELS),
    payments: split(combined, PAYMENTS),
    orderTypes: [
      { key: "delivery", label: "Delivery", count: combined.delivery?.count || 0, amount: round2(combined.delivery?.amount || 0) },
      { key: "collection", label: "Collection", count: combined.collection?.count || 0, amount: round2(combined.collection?.amount || 0) },
    ].filter((r) => r.count > 0),
    topItems: items,
    byHour,
    daily,
  };
};

module.exports = { aggregateDashboard, headline, change };
