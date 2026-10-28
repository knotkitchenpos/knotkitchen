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
  const claimedLines = new Set();
  const moves = [];
  const emitted = [];
  const flags = {};
  const Ingredient = {
    find: () => lean(Object.values(shelf).map((i) => ({ _id: i._id, unit: i.unit }))),
    findOneAndUpdate: async (filter, update, options) => {
      const ing = shelf[String(filter._id)];
      const had = { ...ing };
      // The service's pipeline update: stock less the quantity, rounded to 3
      // places, never below 0. It asks for the value before the update.
      const [floor, rounded] = update[0].$set.stockQuantity.$max;
      const [, quantity] = rounded.$round[0].$subtract;
      ing.stockQuantity = Math.max(floor, Math.round((ing.stockQuantity - quantity) * 1000) / 1000);
      const doc = options?.new === false ? had : { ...ing };
      return { ...doc, toObject: () => ({ ...doc }) };
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
    // A line's claim flips its flag once, like the database's atomic update.
    "../models/orderModel": {
      updateOne: async (filter, update) => {
        const key = filter.items?.$elemMatch ? String(filter.items.$elemMatch._id) : Object.keys(update.$set)[0];
        if (claimedLines.has(`${filter._id}:${key}`)) return { modifiedCount: 0 };
        claimedLines.add(`${filter._id}:${key}`);
        return { modifiedCount: 1 };
      },
    },
    "./socket": { emitToRestaurant: (rid, event, payload) => emitted.push({ rid, event, payload }) },
    "./stockProducts": { countOnSale: async () => 2 },
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

test("REGRESSION: a POS order keeps the dish id, so its recipe comes off the shelf", () => {
  // addOrder's sanitizeItem dropped menuItemId: every till order was saved
  // without it, matched no recipe, and stock never moved (owner, 2026-10-28).
  const { toQuantity } = require("../services/orderItemAmounts");
  const { depletionPlan } = require("../services/inventory");
  const ctrl = SRC("controllers/orderController.js");
  const block = ctrl.slice(ctrl.indexOf("const safeNumber"), ctrl.indexOf("/**\n * The first till line"));
  const sanitizeItem = new Function("toQuantity", `${block}; return sanitizeItem;`)(toQuantity);

  const pizza = oid();
  const dough = oid();
  // The till's cart line (ProductPanel addItems -> toOrderItems), as posted.
  const line = sanitizeItem({ id: 1730100000000.5, menuItemId: String(pizza), name: "Chicken Pizza", quantity: 2, price: 299, total: 598 });
  assert.equal(line.menuItemId, String(pizza));

  const { take } = depletionPlan([line], [{ menuItemId: pizza, ingredients: [{ ingredientId: dough, quantity: 1, unit: "pcs" }] }]);
  assert.deepEqual(take.map((t) => [t.ingredientId, t.quantity]), [[String(dough), 2]]);

  // Anything that is not a dish id is left out rather than stored.
  assert.equal(sanitizeItem({ menuItemId: "not-an-id", name: "x", price: 1 }).menuItemId, undefined);
  assert.equal(sanitizeItem({ menuItemId: { $gt: "" }, name: "x", price: 1 }).menuItemId, undefined);
});

test("REGRESSION: two saves of one order at once take its recipe off the shelf once", async () => {
  // A till order is saved, then saved again by the platform-fee stamp; both
  // saves queued a deduction with the line still unmarked, and one Margherita
  // took 2 dough and 60 g of cheese (owner, 2026-10-28).
  const dough = { _id: oid(), name: "Pizza Dough", unit: "pcs", stockQuantity: 5, reorderLevel: 2, maxLevel: 0 };
  const cheese = { _id: oid(), name: "Mozzarella Cheese", unit: "kg", stockQuantity: 1, reorderLevel: 0.2, maxLevel: 0 };
  const pizza = oid();
  const { service, moves } = buildDepletion({
    shelf: { [dough._id]: dough, [cheese._id]: cheese },
    recipes: [{ menuItemId: pizza, ingredients: [
      { ingredientId: dough._id, quantity: 1, unit: "pcs" },
      { ingredientId: cheese._id, quantity: 30, unit: "g" },
    ] }],
  });
  const order = { _id: oid(), restaurantId: oid(), items: [{ _id: oid(), menuItemId: pizza, name: "Margherita Pizza", quantity: 1 }] };

  await Promise.all([service.depleteOrder(order), service.depleteOrder(order)]);

  assert.equal(dough.stockQuantity, 4, "one pizza, one dough");
  assert.equal(cheese.stockQuantity, 0.97, "1 kg - 30 g");
  assert.equal(moves.length, 2);
});

test("the sale that takes an item to its minimum alerts the POS once; the next one does not", async () => {
  const dough = { _id: oid(), name: "Pizza Dough", unit: "pcs", stockQuantity: 4, reorderLevel: 2, maxLevel: 0 };
  const pizza = oid();
  const restaurantId = oid();
  const { service, emitted: all, flags } = buildDepletion({
    shelf: { [dough._id]: dough },
    recipes: [{ menuItemId: pizza, yield: 1, ingredients: [{ ingredientId: dough._id, quantity: 1, unit: "pcs" }] }],
  });
  // Every sale also tells the tills the stock moved (inventory:stock); the alerts are the restock ones.
  const emitted = { get length() { return all.filter((e) => e.event === "inventory:restock").length; } };
  const alert = (n) => all.filter((e) => e.event === "inventory:restock")[n];
  const sell = (n) => service.depleteOrder({ _id: oid(), restaurantId, items: [{ menuItemId: pizza, name: "Chicken Pizza", quantity: n }] });

  await sell(1); // 4 -> 3: still in stock
  assert.equal(emitted.length, 0);
  assert.equal(all.at(-1).event, "inventory:stock", "the tills hear the stock moved");
  await sell(1); // 3 -> 2: at the minimum
  assert.equal(emitted.length, 1);
  assert.equal(alert(0).rid, String(restaurantId), "only this restaurant's tills");
  assert.deepEqual(alert(0).payload.items.map((i) => [i.name, i.status, i.stockQuantity, i.unit]), [["Pizza Dough", "low", 2, "pcs"]]);
  assert.equal(flags[String(dough._id)], true, "flagged for restocking");
  await sell(1); // 2 -> 1: still low, no second alert
  assert.equal(emitted.length, 1);
  await sell(1); // 1 -> 0: out of stock is news, and asks about the 2 products still on sale
  assert.equal(emitted.length, 2);
  assert.deepEqual([alert(1).payload.items[0].status, alert(1).payload.items[0].productsOn], ["out", 2]);
});

test("stock never goes below 0: the sale stands, the shelf stops at nothing, the log says what was short", async () => {
  // 1 dough left, an order for 2 pizzas the till was warned about (owner, 2026-10-28).
  const dough = { _id: oid(), name: "Pizza Dough", unit: "pcs", stockQuantity: 1, reorderLevel: 1, maxLevel: 0 };
  const pizza = oid();
  const { service, moves } = buildDepletion({
    shelf: { [dough._id]: dough },
    recipes: [{ menuItemId: pizza, ingredients: [{ ingredientId: dough._id, quantity: 1, unit: "pcs" }] }],
  });
  await service.depleteOrder({ _id: oid(), restaurantId: oid(), items: [{ menuItemId: pizza, name: "Chicken Pizza", quantity: 2 }] });
  assert.equal(dough.stockQuantity, 0, "0, not -1");
  assert.deepEqual(moves.map((m) => [m.quantity, m.reason]), [[-1, "Chicken Pizza (short by 1 Piece)"]]);

  // Another sale with nothing left records no movement and leaves it at 0.
  await service.depleteOrder({ _id: oid(), restaurantId: oid(), items: [{ menuItemId: pizza, name: "Chicken Pizza", quantity: 1 }] });
  assert.equal(dough.stockQuantity, 0);
  assert.equal(moves.length, 1);
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

const buildController = (ing, back = { products: [], ingredients: [] }) => {
  const moves = [];
  const emitted = [];
  const controller = loadWith("../controllers/inventoryController", {
    "../models/inventoryModel": {
      Ingredient: { findOne: async () => ing },
      Recipe: {},
      StockMovement: { create: async (m) => { moves.push(m); return m; } },
    },
    "../services/auditService": { logActivity: async () => {} },
    "../services/stockProducts": { backInStock: async () => back, countOnSale: async () => 0 },
    "../services/socket": { emitToRestaurant: (rid, event, payload) => emitted.push({ event, payload }) },
  });
  return { controller, moves, emitted };
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

test("dough bought again asks every till whether to turn its products back on", async () => {
  const dough = shelfItem({ name: "Pizza Dough", unit: "pcs", stockQuantity: 0, reorderLevel: 1 });
  const back = { products: [{ itemId: String(oid()), name: "Chicken Pizza" }, { itemId: String(oid()), name: "Margherita Pizza" }], ingredients: ["Pizza Dough"] };
  const { controller, emitted } = buildController(dough, back);
  const out = await call(controller.recordMovement, { ingredientId: String(dough._id), type: "purchase", quantity: 10, unit: "pcs" });
  assert.equal(out.err, undefined);
  assert.deepEqual(out.json.data.backInStock, { products: 2, ingredients: ["Pizza Dough"] });
  assert.deepEqual(emitted.map((e) => e.event), ["inventory:stock", "inventory:back"]);
  assert.deepEqual(emitted[1].payload, { products: 2, ingredients: ["Pizza Dough"] });
});

test("more wasted than is on the shelf is refused: stock never goes below 0", async () => {
  const dough = shelfItem({ name: "Pizza Dough", unit: "pcs", stockQuantity: 2 });
  const { controller, moves } = buildController(dough);
  const out = await call(controller.recordMovement, { ingredientId: String(dough._id), type: "waste", quantity: 3, reason: "dropped" });
  assert.equal(out.err?.status, 400);
  assert.equal(out.err.message, "Only 2 Piece of Pizza Dough in stock.");
  assert.equal(dough.stockQuantity, 2);
  assert.equal(moves.length, 0);
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
  assert.match(src, /const s = scope\(req\);\n\s+const data = await Ingredient\.find\(\{ \.\.\.s, isLowStock: true \}\)/);
});
