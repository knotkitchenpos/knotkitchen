const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");
const realMongoose = require("mongoose");

/**
 * Inventory management: items with a minimum and maximum, one status rule,
 * stock bought in any unit of the item's kind at a total cost, recipes in the
 * unit the cook thinks in, and every sale taking its recipe off the shelf.
 * The examples are the owner's own: pizza dough, mozzarella, chicken sausage.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const { convertQty, stockStatus, STOCK_STATUS } = require("../services/inventory");

const oid = () => new realMongoose.Types.ObjectId();

/**
 * Load a module with some of its requires replaced (as tests/autoEBill.test.js
 * does). The replacements stay in place until the test ends: the inventory
 * service requires its models when a sale happens, not when it is loaded.
 */
const originalLoad = Module._load;
let activeStubs = null;
Module._load = function (request, parent, isMain) {
  if (activeStubs && Object.prototype.hasOwnProperty.call(activeStubs, request)) return activeStubs[request];
  return originalLoad.apply(this, [request, parent, isMain]);
};
const loadWith = (target, stubs) => {
  activeStubs = stubs;
  delete require.cache[require.resolve(target)];
  return require(target);
};
test.afterEach(() => { activeStubs = null; });

const lean = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });

// ---------------------------------------------------------------------------
// Units and status
// ---------------------------------------------------------------------------

test("units convert within their kind and never across", () => {
  assert.equal(convertQty(20, "g", "kg"), 0.02, "20 g of mozzarella from a kg shelf");
  assert.equal(convertQty(100, "g", "kg"), 0.1, "100 g of flour bought for a kg shelf");
  assert.equal(convertQty(1, "L", "ml"), 1000);
  assert.equal(convertQty(1, "dozen", "pcs"), 12);
  assert.equal(convertQty(5, "pcs", "pcs"), 5);
  assert.equal(convertQty(1, "g", "pcs"), null, "grams of something counted in pieces");
  assert.equal(convertQty(1, "ml", "kg"), null);
});

test("one status rule: out, low (at or below the minimum), maximum reached, in stock", () => {
  assert.equal(stockStatus({ stockQuantity: 0, reorderLevel: 2, maxLevel: 20 }), "out");
  assert.equal(stockStatus({ stockQuantity: -1 }), "out", "oversold is still out");
  assert.equal(stockStatus({ stockQuantity: 2, reorderLevel: 2, maxLevel: 20 }), "low");
  assert.equal(stockStatus({ stockQuantity: 3, reorderLevel: 2, maxLevel: 20 }), "in");
  assert.equal(stockStatus({ stockQuantity: 20, reorderLevel: 2, maxLevel: 20 }), "max");
  assert.equal(stockStatus({ stockQuantity: 500, reorderLevel: 0, maxLevel: 0 }), "in", "no limits set");
  assert.deepEqual(Object.values(STOCK_STATUS), ["In Stock", "Low Stock", "Out of Stock", "Maximum Stock Reached"]);
});

// ---------------------------------------------------------------------------
// Automatic deduction
// ---------------------------------------------------------------------------

const buildDepletion = ({ shelf, recipes }) => {
  const moves = [];
  const emitted = [];
  const flags = {};
  const Ingredient = {
    find: () => lean(Object.values(shelf).map((i) => ({ _id: i._id, unit: i.unit }))),
    findOneAndUpdate: async (filter, update) => {
      const ing = shelf[String(filter._id)];
      ing.stockQuantity = Math.round((ing.stockQuantity + update.$inc.stockQuantity) * 1000) / 1000;
      return { ...ing, toObject: () => ({ ...ing }) };
    },
    updateOne: async (filter, update) => { flags[String(filter._id)] = update.$set.isLowStock; },
  };
  const service = loadWith("../services/inventory", {
    mongoose: { connection: { readyState: 1 }, Types: realMongoose.Types },
    "../models/inventoryModel": {
      Ingredient,
      Recipe: { find: () => lean(recipes) },
      StockMovement: { create: async (m) => moves.push(m) },
    },
    "../models/orderModel": { updateOne: async () => ({}) },
    "./socket": { emitToRestaurant: (rid, event, payload) => emitted.push({ rid, event, payload }) },
  });
  return { service, moves, emitted, flags };
};

test("selling 2 chicken pizzas takes 2 dough, 40 g mozzarella and 20 g sausage off the shelf", async () => {
  const dough = { _id: oid(), name: "Pizza Dough", unit: "pcs", stockQuantity: 5, reorderLevel: 2, maxLevel: 0 };
  const cheese = { _id: oid(), name: "Mozzarella Cheese", unit: "kg", stockQuantity: 1, reorderLevel: 0.2, maxLevel: 0 };
  const sausage = { _id: oid(), name: "Chicken Sausage", unit: "kg", stockQuantity: 1, reorderLevel: 0, maxLevel: 0 };
  const shelf = { [dough._id]: dough, [cheese._id]: cheese, [sausage._id]: sausage };
  const pizza = oid();
  const { service, moves } = buildDepletion({
    shelf,
    recipes: [{ menuItemId: pizza, yield: 1, ingredients: [
      { ingredientId: dough._id, quantity: 1, unit: "pcs" },
      { ingredientId: cheese._id, quantity: 20, unit: "g" },
      { ingredientId: sausage._id, quantity: 10, unit: "g" },
    ] }],
  });

  await service.depleteOrder({ _id: oid(), restaurantId: oid(), items: [{ menuItemId: pizza, name: "Chicken Pizza", quantity: 2 }] });

  assert.equal(dough.stockQuantity, 3, "5 dough -> 3 dough");
  assert.equal(cheese.stockQuantity, 0.96, "1 kg - 40 g");
  assert.equal(sausage.stockQuantity, 0.98, "1 kg - 20 g");
  assert.deepEqual(moves.map((m) => [m.ingredientName, m.quantity, m.unit, m.type]), [
    ["Pizza Dough", -2, "pcs", "sale"],
    ["Mozzarella Cheese", -0.04, "kg", "sale"],
    ["Chicken Sausage", -0.02, "kg", "sale"],
  ]);
});

test("the sale that takes an item to its minimum alerts the POS once; the next one does not", async () => {
  const dough = { _id: oid(), name: "Pizza Dough", unit: "pcs", stockQuantity: 4, reorderLevel: 2, maxLevel: 0 };
  const pizza = oid();
  const restaurantId = oid();
  const { service, emitted, flags } = buildDepletion({
    shelf: { [dough._id]: dough },
    recipes: [{ menuItemId: pizza, yield: 1, ingredients: [{ ingredientId: dough._id, quantity: 1, unit: "pcs" }] }],
  });
  const sell = (n) => service.depleteOrder({ _id: oid(), restaurantId, items: [{ menuItemId: pizza, name: "Chicken Pizza", quantity: n }] });

  await sell(1); // 4 -> 3: still in stock
  assert.equal(emitted.length, 0);
  await sell(1); // 3 -> 2: at the minimum
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, "inventory:restock");
  assert.equal(emitted[0].rid, String(restaurantId), "only this restaurant's tills");
  assert.deepEqual(emitted[0].payload.items.map((i) => [i.name, i.status, i.stockQuantity, i.unit]), [["Pizza Dough", "low", 2, "pcs"]]);
  assert.equal(flags[String(dough._id)], true, "flagged for restocking");
  await sell(1); // 2 -> 1: still low, no second alert
  assert.equal(emitted.length, 1);
  await sell(1); // 1 -> 0: out of stock is news
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].payload.items[0].status, "out");
});

test("a recipe line in a unit the item cannot take is skipped at sale, never deducted wrongly", async () => {
  const dough = { _id: oid(), name: "Pizza Dough", unit: "pcs", stockQuantity: 5, reorderLevel: 0, maxLevel: 0 };
  const pizza = oid();
  const { service, moves } = buildDepletion({
    shelf: { [dough._id]: dough },
    recipes: [{ menuItemId: pizza, yield: 1, ingredients: [{ ingredientId: dough._id, quantity: 1, unit: "kg" }] }],
  });
  await service.depleteOrder({ _id: oid(), restaurantId: oid(), items: [{ menuItemId: pizza, quantity: 1 }] });
  assert.equal(dough.stockQuantity, 5);
  assert.equal(moves.length, 0);
});

// ---------------------------------------------------------------------------
// Stock entry
// ---------------------------------------------------------------------------

const buildController = (ing) => {
  const moves = [];
  const controller = loadWith("../controllers/inventoryController", {
    "../models/inventoryModel": {
      Ingredient: { findOne: async () => ing },
      Recipe: {},
      StockMovement: { create: async (m) => { moves.push(m); return m; } },
    },
    "../services/auditService": { logActivity: async () => {} },
  });
  return { controller, moves };
};

const call = async (handler, body) => {
  const out = {};
  const res = { status: (code) => { out.code = code; return { json: (j) => { out.json = j; } }; } };
  await handler({ body, params: {}, query: {}, user: { _id: oid(), restaurantId: oid() } }, res, (err) => { out.err = err; });
  return out;
};

const shelfItem = (fields) => ({
  _id: oid(), reorderLevel: 0, maxLevel: 0, costPerUnit: 0, isLowStock: false,
  ...fields,
  save: async () => {},
  toObject() { const { save, toObject, ...rest } = this; return rest; },
});

test("buying 5 pizza dough for ₹20 adds 5 pieces and sets the cost price to ₹4 a piece", async () => {
  const dough = shelfItem({ name: "Pizza Dough", unit: "pcs", stockQuantity: 0, reorderLevel: 2 });
  const { controller, moves } = buildController(dough);
  const out = await call(controller.recordMovement, { ingredientId: String(dough._id), type: "purchase", quantity: 5, unit: "pcs", totalCost: 20 });
  assert.equal(out.err, undefined);
  assert.equal(dough.stockQuantity, 5);
  assert.equal(dough.costPerUnit, 4);
  assert.equal(dough.isLowStock, false, "5 is above the minimum of 2");
  assert.equal(out.json.data.ingredient.status, "in");
  assert.deepEqual([moves[0].type, moves[0].quantity, moves[0].unit, moves[0].cost], ["purchase", 5, "pcs", 20]);
});

test("100 g of flour bought for a shelf counted in kg adds 0.1 kg at ₹100 a kg", async () => {
  const flour = shelfItem({ name: "Flour", unit: "kg", stockQuantity: 2 });
  const { controller, moves } = buildController(flour);
  await call(controller.recordMovement, { ingredientId: String(flour._id), type: "purchase", quantity: 100, unit: "g", totalCost: 10 });
  assert.equal(flour.stockQuantity, 2.1);
  assert.equal(flour.costPerUnit, 100);
  assert.equal(moves[0].quantity, 0.1);
  assert.match(moves[0].reason, /100 Gram/, "the log says what was actually entered");
});

test("stock in a unit the item cannot take is refused, naming both", async () => {
  const dough = shelfItem({ name: "Pizza Dough", unit: "pcs", stockQuantity: 5 });
  const { controller } = buildController(dough);
  const out = await call(controller.recordMovement, { ingredientId: String(dough._id), type: "purchase", quantity: 1, unit: "kg", totalCost: 50 });
  assert.equal(out.err.status, 400);
  assert.match(out.err.message, /Pizza Dough is counted in Piece; it cannot take KG/);
  assert.equal(dough.stockQuantity, 5);
});

// ---------------------------------------------------------------------------
// Items, recipes, wiring
// ---------------------------------------------------------------------------

test("maximum stock must be above the minimum, and every listed item carries its status", () => {
  const src = SRC("controllers/inventoryController.js");
  assert.match(src, /if \(maxLevel > 0 && maxLevel <= reorderLevel\) \{\s*throw createHttpError\(400, "Maximum stock must be more than the minimum stock\."\);/);
  assert.match(src, /res\.status\(200\)\.json\(\{ success: true, data: data\.map\(view\) \}\);/);
  assert.match(src, /return \{ \.\.\.o, status: stockStatus\(o\) \};/);
  assert.match(SRC("models/inventoryModel.js"), /maxLevel: \{ type: Number, default: 0 \},/);
});

test("a recipe line in a unit its item cannot take is refused when saved, naming the item", async () => {
  const cheese = { _id: oid(), name: "Mozzarella Cheese", unit: "kg" };
  const service = loadWith("../services/inventory", {
    "../models/inventoryModel": { Ingredient: { find: () => lean([cheese]) } },
  });
  const ok = await service.cleanRecipeLines(oid(), [{ ingredientId: String(cheese._id), quantity: 20, unit: "g" }]);
  assert.deepEqual(ok.map((l) => [l.quantity, l.unit]), [[20, "g"]], "kept in the unit the cook entered");
  await assert.rejects(
    () => service.cleanRecipeLines(oid(), [{ ingredientId: String(cheese._id), quantity: 1, unit: "pcs" }]),
    /Mozzarella Cheese is counted in KG; a recipe cannot use Piece for it\./,
  );
  const foreign = await service.cleanRecipeLines(oid(), [{ ingredientId: String(oid()), quantity: 1, unit: "g" }]);
  assert.equal(foreign.length, 0, "another restaurant's item (not found in this one) is dropped");
});

test("Manage Menu saves the product's recipe, checked before the product is saved", () => {
  const src = SRC("controllers/menuController.js");
  const add = src.slice(src.indexOf("const addDish = async"), src.indexOf("const updateDish = async"));
  const update = src.slice(src.indexOf("const updateDish = async"), src.indexOf("res.status(200).json({ success: true, message: \"Product updated!\""));
  for (const [name, body] of [["addDish", add], ["updateDish", update]]) {
    const check = body.indexOf("const recipe = await checkRecipe(req);");
    const save = body.indexOf("await menu.save();");
    const keep = body.indexOf("await keepRecipe(req, recipe,");
    assert.ok(check > 0 && check < save && save < keep, `${name}: check, then save the product, then the recipe`);
  }
  assert.match(src, /if \(!recipe \|\| typeof recipe !== "object"\) return null;/, "a form without the section leaves a saved recipe alone");
});

test("the POS can read what needs restocking now, scoped to its own restaurant", () => {
  const routes = SRC("routes/inventoryRoute.js");
  assert.match(routes, /router\.route\("\/alerts"\)\.get\(isVerifiedUser, c\.listRestockAlerts\);/);
  const src = SRC("controllers/inventoryController.js");
  assert.match(src, /Ingredient\.find\(\{ \.\.\.scope\(req\), isLowStock: true \}\)/);
});
