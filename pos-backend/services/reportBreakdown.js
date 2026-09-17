/**
 * The report's "where did the money come from" tables: by dish, by
 * category, by hour of day and by staff member. Pure; the controller passes
 * the orders and a way to name a line's category.
 *
 * Cancelled orders are skipped. Dish amounts are the line totals as sold;
 * refunds are already netted in the summary and are not spread over lines.
 */
const { isCancelled } = require("../constants/orderStatus");

const { round2 } = require("./money");

const lineAmount = (item) => {
  const total = Number(item.total);
  if (Number.isFinite(total) && total > 0) return total;
  return (Number(item.unitPrice || item.price) || 0) * (Number(item.quantity) || 1);
};

const top = (map, key, limit) =>
  [...map.values()]
    .map((r) => ({ ...r, amount: round2(r.amount) }))
    .sort((a, b) => b[key] - a[key])
    .slice(0, limit);

/**
 * @param {Array} orders
 * @param {{ categoryOf?: (item) => string }} [opts]
 */
const buildReportBreakdown = (orders, { categoryOf = () => "" } = {}) => {
  const items = new Map();
  const categories = new Map();
  const staff = new Map();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, amount: 0 }));

  for (const o of orders || []) {
    if (isCancelled(o.orderStatus)) continue;
    const orderAmount = Number(o.bills?.totalWithTax || o.bills?.total || 0);

    const h = new Date(o.createdAt || Date.now()).getHours();
    hours[h].count += 1;
    hours[h].amount += orderAmount;

    const who =
      (o.createdBy && typeof o.createdBy === "object" && o.createdBy.name) ||
      (o.createdBy ? "Staff" : String(o.source || "").toUpperCase() === "QR" ? "Customer · table QR" : "Customer · website");
    const s = staff.get(who) || { name: who, count: 0, amount: 0 };
    s.count += 1;
    s.amount += orderAmount;
    staff.set(who, s);

    for (const it of o.items || []) {
      if (it.status === "cancelled") continue;
      const qty = Number(it.quantity) || 1;
      const amt = lineAmount(it);
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
  }

  return {
    byItem: top(items, "amount", 50),
    byCategory: top(categories, "amount", 50),
    byHour: hours.map((r) => ({ ...r, amount: round2(r.amount) })).filter((r) => r.count > 0),
    byStaff: top(staff, "amount", 50),
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
