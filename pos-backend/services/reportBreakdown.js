/**
 * The report's "where did the money come from" tables: by dish, by
 * category, by hour of day and by staff member. Pure; the controller passes
 * the orders and a way to name a line's category.
 *
 * Cancelled orders are skipped. Dish amounts are the line totals as sold.
 * The dish and category tables are not capped, and `adjustments` carries the
 * difference between those lines and what was taken (discount, exclusive GST
 * and charges, refunds, anything else), so the rows add up to the Total
 * Orders amount. Hour and staff rows are net of refunds, like that total.
 */
const { isCancelled } = require("../constants/orderStatus");

const { round2 } = require("./money");
const { resolveItemAmounts } = require("./orderItemAmounts");
const { netAmount, orderTotal } = require("./refunds");
const { DEFAULT_TZ } = require("./tableBookings");
const { localClock } = require("./websiteAvailability");

// The one reading of a stored line (a legacy POS line keeps the LINE total
// in `price`; multiplying quantity back in counted it twice here).
const lineAmount = (item) => resolveItemAmounts(item).lineTotal;

const top = (map, key, limit = Infinity) =>
  [...map.values()]
    .map((r) => ({ ...r, amount: round2(r.amount) }))
    .sort((a, b) => b[key] - a[key])
    .slice(0, limit);

/**
 * @param {Array} orders
 * @param {{ categoryOf?: (item) => string, timeZone?: string }} [opts]
 */
const buildReportBreakdown = (orders, { categoryOf = () => "", timeZone = DEFAULT_TZ } = {}) => {
  const items = new Map();
  const categories = new Map();
  const staff = new Map();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, amount: 0 }));
  const adj = { discounts: 0, charges: 0, refunds: 0, other: 0 };

  for (const o of orders || []) {
    if (isCancelled(o.orderStatus)) continue;
    const net = netAmount(o);

    // The store's hour, not the server's: the container runs on UTC, which
    // filed a 1:15 PM lunch order under 7 AM.
    const h = Math.floor(localClock(new Date(o.createdAt || Date.now()), timeZone).minutes / 60);
    hours[h].count += 1;
    hours[h].amount += net;

    const who =
      (o.createdBy && typeof o.createdBy === "object" && o.createdBy.name) ||
      (o.createdBy ? "Staff" : String(o.source || "").toUpperCase() === "QR" ? "Customer · table QR" : "Customer · website");
    const s = staff.get(who) || { name: who, count: 0, amount: 0 };
    s.count += 1;
    s.amount += net;
    staff.set(who, s);

    let lines = 0;
    for (const it of o.items || []) {
      if (it.status === "cancelled") continue;
      const qty = Number(it.quantity) || 1;
      const amt = lineAmount(it);
      lines += amt;
      const name = String(it.name || "Item").trim();
      const r = items.get(name) || { name, quantity: 0, amount: 0 };
      r.quantity += qty;
      r.amount += amt;
      items.set(name, r);

      const cat = String(categoryOf(it) || "Uncategorised");
      const c = categories.get(cat) || { name: cat, quantity: 0, amount: 0 };
      c.quantity += qty;
      c.amount += amt;
      categories.set(cat, c);
    }

    // lines - discount + charges - refunds + other = net, per order. Included
    // GST is already inside the line prices; a tip and the platform fee are
    // outside totalWithTax, so neither appears here.
    const b = o.bills || {};
    const total = orderTotal(o);
    const discount = Number(b.discount) || 0;
    const charges =
      (b.taxInclusive ? 0 : Number(b.tax) || 0) +
      (Number(b.serviceCharge) || 0) +
      (Number(b.deliveryFee) || 0) +
      (Number(b.packagingFee) || 0);
    adj.discounts -= discount;
    adj.charges += charges;
    adj.refunds -= total - net;
    adj.other += total - lines + discount - charges;
  }

  const adjustments = [
    { name: "Discounts", amount: adj.discounts },
    { name: "Tax & charges", amount: adj.charges },
    { name: "Refunds", amount: adj.refunds },
    { name: "Other adjustments", amount: adj.other },
  ]
    .map((a) => ({ ...a, amount: round2(a.amount) }))
    .filter((a) => Math.abs(a.amount) >= 0.01);

  return {
    byItem: top(items, "amount"),
    byCategory: top(categories, "amount"),
    byHour: hours.map((r) => ({ ...r, amount: round2(r.amount) })).filter((r) => r.count > 0),
    byStaff: top(staff, "amount", 50),
    adjustments,
  };
};

/** itemId or item name -> category (Menu document) name, from the tenant's menus. */
const categoryLookup = (menus) => {
  const byId = new Map();
  const byName = new Map();
  for (const m of menus || []) {
    for (const it of m.items || []) {
      if (it._id) byId.set(String(it._id), m.name);
      if (it.name && !byName.has(it.name)) byName.set(it.name, m.name);
    }
  }
  return (item) =>
    byId.get(String(item.itemId || item.menuItemId || "")) ||
    byName.get(String(item.name || "").replace(/\s*\(.*\)$/, "")) ||
    byName.get(String(item.name || "")) ||
    "";
};

module.exports = { buildReportBreakdown, categoryLookup };
