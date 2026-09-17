const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { depletionPlan } = require("../services/inventory");

const recipes = [
  { menuItemId: "dish1", yield: 1, ingredients: [{ ingredientId: "paneer", quantity: 0.2, unit: "kg" }, { ingredientId: "oil", quantity: 30, unit: "ml" }] },
  { menuItemId: "dish2", yield: 4, ingredients: [{ ingredientId: "rice", quantity: 1, unit: "kg" }] },
];

test("a sold line takes its recipe's ingredients, scaled by quantity and yield", () => {
  const { take, lines } = depletionPlan(
    [
      { menuItemId: "dish1", name: "Paneer Tikka", quantity: 2 },
      { itemId: "dish2", name: "Rice", quantity: 2 },
    ],
    recipes,
  );
  assert.equal(lines.length, 2);
  assert.deepEqual(
    take.map((t) => [t.ingredientId, t.quantity]),
    [["paneer", 0.4], ["oil", 60], ["rice", 0.5]],
  );
});

test("lines already depleted or cancelled are left alone; a dish with no recipe is marked but takes nothing", () => {
  const { take, lines } = depletionPlan(
    [
      { menuItemId: "dish1", quantity: 1, stockDepleted: true },
      { menuItemId: "dish1", quantity: 1, status: "cancelled" },
      { menuItemId: "unknown", quantity: 3 },
    ],
    recipes,
  );
  assert.equal(take.length, 0);
  assert.deepEqual(lines, [{ itemIndex: 2 }]);
});

test("depletion hangs off Order save and never takes a restaurantId from the client", () => {
  const model = fs.readFileSync(path.join(__dirname, "..", "models", "orderModel.js"), "utf8");
  assert.match(model, /orderSchema\.post\("save", function depleteStock/);
  const ctrl = fs.readFileSync(path.join(__dirname, "..", "controllers", "inventoryController.js"), "utf8");
  assert.ok(!/req\.(params|body|query)\.restaurantId/.test(ctrl), "inventory must be scoped from req.user only");
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "inventoryRoute.js"), "utf8");
  assert.ok(!/:restaurantId/.test(routes));
});
