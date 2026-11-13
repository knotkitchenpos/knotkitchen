const { test } = require("node:test");
const assert = require("node:assert/strict");
const { profitOf } = require("../services/profit");

const costs = [
  { menuItemId: "pt", name: "Paneer Tikka", category: "Starters", hasRecipe: true, cost: 92 },
  { menuItemId: "cp", name: "Chicken Pizza", category: "Pizzas", hasRecipe: true, cost: 120 },
  { menuItemId: "gj", name: "Gulab Jamun", category: "Desserts", hasRecipe: false },
];
const order = (items, extra = {}) => ({ orderStatus: "Completed", bills: {}, items, ...extra });

test("profit per dish from its recipe cost; dishes without a recipe are apart; cancelled sales are no sales", () => {
  const p = profitOf({
    costs,
    targetPct: 35,
    orders: [
      order([{ menuItemId: "pt", name: "Paneer Tikka", quantity: 2, price: 220, total: 440 }, { menuItemId: "gj", name: "Gulab Jamun", quantity: 1, price: 89, total: 89 }], { bills: { discount: 40 } }),
      // A sized line, matched by name without the size.
      order([{ name: "Chicken Pizza (Large)", quantity: 1, price: 299, total: 299 }]),
      // A struck-off line and a cancelled order are not sold.
      order([{ menuItemId: "pt", name: "Paneer Tikka", quantity: 1, total: 220, status: "cancelled" }]),
      order([{ menuItemId: "cp", name: "Chicken Pizza", quantity: 5, total: 1495 }], { orderStatus: "Cancelled" }),
    ],
  });
  const by = Object.fromEntries(p.dishes.map((d) => [d.name, d]));
  assert.deepEqual([by["Paneer Tikka"].quantity, by["Paneer Tikka"].revenue, by["Paneer Tikka"].foodCost, by["Paneer Tikka"].profit], [2, 440, 184, 256]);
  assert.equal(by["Paneer Tikka"].foodCostPct, 41.8);
  assert.equal(by["Paneer Tikka"].flag, true, "above the 35% target");
  assert.deepEqual([by["Chicken Pizza"].quantity, by["Chicken Pizza"].foodCost], [1, 120]);
  assert.equal(by["Gulab Jamun"].hasRecipe, false);
  assert.equal(by["Gulab Jamun"].profit, null, "no cost, no profit claimed");
  assert.equal(p.revenue, 828);
  assert.equal(p.costedRevenue, 739);
  assert.equal(p.foodCost, 304);
  assert.equal(p.grossProfit, 435);
  assert.equal(p.coveragePct, 89.3);
  assert.equal(p.discounts, 40);
  assert.equal(p.dishes[0].name, "Paneer Tikka", "most profitable first");
});
