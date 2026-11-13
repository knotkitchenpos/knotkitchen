/**
 * Profit for the Partners dashboard: what each dish sold, what it cost to
 * make (its recipe at today's cost prices: Inventory > Dish costs), and the
 * gross profit and food-cost % per dish and store. Pure.
 *
 * Revenue is the bill lines (before order discounts and GST); a dish with no
 * recipe has no known cost and is shown apart, so the margin is never
 * stated on sales it cannot cost. A sized dish (variants) uses its recipe's
 * cost per plate.
 */
const { resolveItemAmounts } = require("./orderItemAmounts");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CANCELLED = /cancel/i;
const base = (name) => String(name || "").replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();

/**
 * @param {{ orders: Array, costs: Array, targetPct?: number }} input
 *        orders: report views; costs: dishCostTable(...).data
 */
const profitOf = ({ orders = [], costs = [], targetPct = 35 }) => {
  const byId = new Map();
  const byName = new Map();
  for (const c of costs) {
    if (c.menuItemId) byId.set(String(c.menuItemId), c);
    if (!byName.has(base(c.name))) byName.set(base(c.name), c);
  }
  const dishes = new Map();
  let discounts = 0;
  for (const o of orders) {
    if (CANCELLED.test(String(o.orderStatus || ""))) continue;
    discounts += Number(o.bills?.discount) || 0;
    for (const line of o.items || []) {
      if (!line?.name || line.status === "cancelled" || line.status === "refunded") continue;
      const { quantity, lineTotal } = resolveItemAmounts(line);
      const cost = byId.get(String(line.menuItemId || line.itemId || "")) || byName.get(base(line.name));
      const name = cost?.name || String(line.name).replace(/\s*\([^)]*\)\s*$/, "");
      const d = dishes.get(name) || { name, category: cost?.category || "", quantity: 0, revenue: 0, hasRecipe: Boolean(cost?.hasRecipe), costPerPlate: cost?.hasRecipe ? cost.cost : null, foodCost: 0 };
      d.quantity = Math.round((d.quantity + quantity) * 1000) / 1000;
      d.revenue = round2(d.revenue + lineTotal);
      if (d.hasRecipe) d.foodCost = round2(d.foodCost + quantity * (d.costPerPlate || 0));
      dishes.set(name, d);
    }
  }
  const list = [...dishes.values()].map((d) => {
    const profit = d.hasRecipe ? round2(d.revenue - d.foodCost) : null;
    const pct = d.hasRecipe && d.revenue > 0 ? Math.round((d.foodCost / d.revenue) * 1000) / 10 : null;
    return { ...d, profit, foodCostPct: pct, flag: pct !== null && pct > targetPct };
  });
  const costed = list.filter((d) => d.hasRecipe);
  const revenue = round2(list.reduce((s, d) => s + d.revenue, 0));
  const costedRevenue = round2(costed.reduce((s, d) => s + d.revenue, 0));
  const foodCost = round2(costed.reduce((s, d) => s + d.foodCost, 0));
  return {
    revenue,
    costedRevenue,
    foodCost,
    grossProfit: round2(costedRevenue - foodCost),
    foodCostPct: costedRevenue > 0 ? Math.round((foodCost / costedRevenue) * 1000) / 10 : null,
    coveragePct: revenue > 0 ? Math.round((costedRevenue / revenue) * 1000) / 10 : 0,
    discounts: round2(discounts),
    targetPct,
    dishes: list.sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity) || b.revenue - a.revenue),
  };
};

module.exports = { profitOf };
