const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const inv = require("../services/inventory");

/**
 * Inventory, owner 2026-11-01: cost and profit per dish, add-ons and sizes
 * that use stock, packs, prepared items, use-by dates, stock counts and the
 * inventory reports.
 */

const SRC = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const items = new Map([
  ["cheese", { name: "Cheese", unit: "kg", costPerUnit: 400 }],
  ["dough", { name: "Dough", unit: "pcs", costPerUnit: 20 }],
  ["gravy", { name: "Gravy", unit: "kg", costPerUnit: 56 }],
  ["basil", { name: "Basil", unit: "g", costPerUnit: 0 }],
]);

test("a dish's cost per plate, profit and food cost %, flagged above the target", () => {
  const recipe = { yield: 1, ingredients: [
    { ingredientId: "dough", quantity: 1, unit: "pcs" },
    { ingredientId: "cheese", quantity: 100, unit: "g" },
    { ingredientId: "gravy", quantity: 100, unit: "g" },
  ] };
  assert.deepEqual(inv.dishCost({ recipe, price: 299, items, targetPct: 35 }), {
    cost: 65.6, price: 299, profit: 233.4, foodCostPct: 21.9, missing: [], flag: false,
  });
  const dear = inv.dishCost({ recipe: { yield: 1, ingredients: [{ ingredientId: "cheese", quantity: 300, unit: "g" }, { ingredientId: "dough", quantity: 1, unit: "pcs" }] }, price: 249, items });
  assert.equal(dear.foodCostPct, 56.2);
  assert.equal(dear.flag, true);
  // A recipe for 4 is a quarter per plate; an item with no cost price is named, not hidden.
  const shared = inv.dishCost({ recipe: { yield: 4, ingredients: [{ ingredientId: "dough", quantity: 4, unit: "pcs" }, { ingredientId: "basil", quantity: 5, unit: "g" }] }, price: 100, items });
  assert.equal(shared.cost, 20);
  assert.deepEqual(shared.missing, ["Basil"]);
  assert.equal(inv.dishCost({ recipe, price: 0, items }).foodCostPct, null, "no price, no percentage");
});

test("an add-on and a size take their own recipe with the dish, per portion chosen", () => {
  const plan = inv.depletionPlan(
    [{
      menuItemId: "pizza", name: "Pizza", quantity: 2, variant: { name: "Large" },
      modifierSelections: [{ groupName: "Toppings", optionName: "Extra Cheese" }, { groupName: "Toppings", optionName: "Olives" }],
      modifiers: [{ name: "Extra Cheese", quantity: 2 }],
    }],
    [{ menuItemId: "pizza", yield: 1, ingredients: [{ ingredientId: "dough", quantity: 1, unit: "pcs" }] }],
    [
      // Matched by name whatever the case: order lines record the names as sold.
      { kind: "option", groupName: "toppings", optionName: "EXTRA CHEESE", ingredients: [{ ingredientId: "cheese", quantity: 30, unit: "g" }] },
      { kind: "variant", menuItemId: "pizza", variantName: "large", ingredients: [{ ingredientId: "dough", quantity: 0.5, unit: "pcs" }] },
    ],
  );
  assert.deepEqual(plan.take.map((t) => [t.ingredientId, t.quantity, t.itemName]), [
    ["dough", 2, "Pizza"],
    ["dough", 1, "Pizza · Large"],
    ["cheese", 120, "Pizza · Extra Cheese"], // 30 g x 2 portions x 2 pizzas
  ]);
  // Olives has no recipe: it takes nothing. A dish without add-on recipes is as before.
  assert.equal(inv.depletionPlan([{ menuItemId: "pizza", name: "Pizza", quantity: 1 }], [{ menuItemId: "pizza", yield: 1, ingredients: [{ ingredientId: "dough", quantity: 1, unit: "pcs" }] }]).take.length, 1);
});

test("stock leaves the batch that expires first; dated batches never exceed the shelf", () => {
  const left = inv.trimBatches([
    { quantity: 5, expiryDate: "2026-11-05" },
    { quantity: 3, expiryDate: "2026-11-03" },
  ], 6);
  assert.deepEqual(left.map((b) => [b.quantity, b.expiryDate.toISOString().slice(0, 10)]), [[1, "2026-11-03"], [5, "2026-11-05"]]);
  assert.deepEqual(inv.trimBatches([{ quantity: 2, expiryDate: "2026-11-03" }], 0), []);
  assert.deepEqual(inv.trimBatches([{ quantity: 2, expiryDate: "2026-11-03" }], 10).map((b) => b.quantity), [2], "undated stock is just untracked");

  const now = new Date("2026-11-01T12:00:00Z");
  const states = inv.expiryOf([
    { quantity: 1, expiryDate: "2026-10-31T00:00:00Z" },
    { quantity: 2, expiryDate: "2026-11-02T00:00:00Z" },
    { quantity: 3, expiryDate: "2026-11-20T00:00:00Z" },
  ], { days: 2, now }).map((b) => b.state);
  assert.deepEqual(states, ["expired", "soon", "ok"]);
});

test("a sale records what it was worth and trims the batches it came from", () => {
  const svc = SRC("services/inventory.js");
  assert.match(svc, /value: -Math\.round\(taken \* \(Number\(ing\.costPerUnit\) \|\| 0\) \* 100\) \/ 100,/);
  assert.match(svc, /if \(\(ing\.batches \|\| \[\]\)\.length\) patch\.batches = trimBatches\(ing\.batches, left\);/);
  assert.match(svc, /AddonRecipe \? AddonRecipe\.find\(\{ restaurantId: order\.restaurantId \}\)\.lean\(\) : \[\]/);
});

test("packs: bought as 2 Trays of 30, kept in pieces; a purchase gets a use-by date", () => {
  const ctrl = SRC("controllers/inventoryController.js");
  assert.match(ctrl, /const quantity = pack \? round3\(entered \* pack\.size\) : convertQty\(entered, unit, ing\.unit\);/);
  assert.match(ctrl, /ing\.shelfLifeDays > 0 \? new Date\(Date\.now\(\) \+ ing\.shelfLifeDays \* 86400000\) : null;/);
  assert.match(SRC("models/inventoryModel.js"), /packs: \{\s*type: \[\{ name: \{ type: String, trim: true \}, size: \{ type: Number, min: 0 \}, _id: false \}\],/);
});

test("prepared items: a batch takes its recipe off the shelf, short items are asked about first", () => {
  const ctrl = SRC("controllers/inventoryController.js");
  assert.match(ctrl, /if \(short\.length && req\.body\?\.force !== true\) \{/);
  assert.match(ctrl, /code: "STOCK_SHORT",/);
  assert.match(ctrl, /if \(batchCost > 0\) ing\.costPerUnit = round3\(batchCost \/ quantity\);/);
  assert.match(ctrl, /throw createHttpError\(400, "A prepared item cannot use itself\."\);/);
});

test("stock count: finishing sets counted items and records each difference in quantity and ₹", () => {
  const ctrl = SRC("controllers/inventoryController.js");
  assert.match(ctrl, /\{ \$set: \{ status: "done", finishedAt: new Date\(\), finishedBy: req\.user\._id \} \}/, "finished once, atomically");
  assert.match(ctrl, /type: "count", quantity: diff, value: worth\(ing, diff\), unit: ing\.unit, reason: `Stock count #\$\{count\.number\}`,/);
  assert.match(ctrl, /if \(line\.counted === null \|\| line\.counted === undefined\) continue;/, "blank items are left alone");
});

test("report: food cost is stock used against sales before tax; settings are the owner's", () => {
  const ctrl = SRC("controllers/inventoryController.js");
  assert.match(ctrl, /sales \+= net \* \(total > 0 \? Math\.max\(0, 1 - tax \/ total\) : 1\);/);
  assert.match(ctrl, /foodCostPct: sales > 0 \? Math\.round\(\(used \/ sales\) \* 1000\) \/ 10 : null,/);
  const routes = SRC("routes/inventoryRoute.js");
  for (const r of ["/dish-costs", "/addon-recipes", "/ingredients/:id/make", "/counts", "/counts/:id/finish", "/report", "/settings"]) {
    assert.ok(routes.includes(`router.route("${r}")`), r);
  }
  assert.match(routes, /router\.route\("\/settings"\)\.get\(isVerifiedUser, c\.getSettings\)\.put\(isVerifiedUser, requireProtectedAction, c\.saveSettings\);/);
  assert.match(SRC("models/restaurantModel.js"), /targetFoodCostPct: \{ type: Number, default: 35, min: 1, max: 100 \},/);
});

test("REGRESSION: add-ons on dine-in and table-QR orders take stock too (lines keep only the choice's name)", () => {
  // Table session lines are stored with modifiers: [{ name, price }] and no group,
  // so the group is read from the dish's own groups.
  const dishGroups = inv.dishGroupsOf([{ items: [{ _id: "pizza", modifierGroups: [{ name: "Crust", options: [{ name: "Cheese Burst" }, { name: "Thin" }] }] }] }]);
  const plan = inv.depletionPlan(
    [{ menuItemId: "pizza", name: "Pizza", quantity: 3, modifiers: [{ name: "Cheese Burst", price: 60 }] }],
    [],
    [{ kind: "option", groupName: "Crust", optionName: "Cheese Burst", ingredients: [{ ingredientId: "cheese", quantity: 60, unit: "g" }] }],
    dishGroups,
  );
  assert.deepEqual(plan.take.map((t) => [t.ingredientId, t.quantity]), [["cheese", 180]]);
  // A till line that sent both shapes is counted once.
  const both = inv.depletionPlan(
    [{ menuItemId: "pizza", name: "Pizza", quantity: 1, modifierSelections: [{ groupName: "Crust", optionName: "Cheese Burst" }], modifiers: [{ name: "Cheese Burst" }] }],
    [], [{ kind: "option", groupName: "Crust", optionName: "Cheese Burst", ingredients: [{ ingredientId: "cheese", quantity: 60, unit: "g" }] }], dishGroups,
  );
  assert.equal(both.take.length, 1);
  assert.match(SRC("services/inventory.js"), /\(it\.modifiers \|\| \[\]\)\.length > \(it\.modifierSelections \|\| \[\]\)\.length/, "the menu is read only when a line needs it");
});

test("a group or component renamed in Manage Menu takes its add-on recipe with it", () => {
  const svc = SRC("services/inventory.js");
  assert.match(svc, /const carryAddonRecipes = async \(\{ restaurantId, oldGroup, newGroup, options = \[\] \}\) => \{/);
  assert.match(svc, /if \(e\?\.code !== 11000\) throw e; \/\/ the new name has its own recipe already/);
  const menu = SRC("controllers/menuController.js");
  assert.equal((menu.match(/await carryAddonRecipes\(\{ restaurantId: req\.user\?\.restaurantId, oldGroup: old, newGroup: name, options: req\.body\.options \}\);/g) || []).length, 2, "both group saves");
  // Changing an item's unit is refused while any recipe kind measures it.
  assert.match(SRC("controllers/inventoryController.js"), /"prep\.ingredients\.ingredientId": doc\._id/);
  // A removed item still in a recipe is named, never silently left out of the cost.
  assert.deepEqual(inv.linesCost([{ ingredientId: "gone", quantity: 1, unit: "pcs" }], items).missing, ["a removed item"]);
});
