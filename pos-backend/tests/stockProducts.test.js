const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const mongoose = require("mongoose");

/**
 * Products switched off because an inventory item ran out, and back on when
 * it is restocked (owner, 2026-10-28): "Pizza Dough is out of stock. Do you
 * want to turn off all products using this item?" and "Items are back in
 * stock. Do you want to turn on the products that were previously turned off
 * due to stock shortage?"
 */

const oid = () => new mongoose.Types.ObjectId();

// One category: two pizzas on the dough's recipes, one of them already
// switched off by hand, and a drink that uses nothing.
const world = () => {
  const dough = { _id: oid(), name: "Pizza Dough", stockQuantity: 0 };
  const item = (name, isAvailable = true) => ({ _id: oid(), name, isAvailable, stockOffBy: undefined });
  const chicken = item("Chicken Pizza");
  const margherita = item("Margherita Pizza");
  const veggie = item("Veggie Pizza", false); // the owner turned this off by hand
  const chai = item("Masala Chai");
  const snapshot = [chicken, margherita, veggie, chai].map((i) => ({ ...i }));
  const menu = {
    items: [chicken, margherita, veggie, chai],
    systemSnapshot: { items: Object.assign(snapshot, { id: (id) => snapshot.find((s) => String(s._id) === String(id)) }) },
    saves: 0,
    markModified() {},
    async save() { this.saves += 1; },
  };
  const recipes = [chicken, margherita, veggie].map((i) => ({ menuItemId: i._id }));
  const emitted = [];
  const lean = (v) => ({ select: () => ({ lean: async () => v }), lean: async () => v });
  const stubs = {
    "../models/inventoryModel": {
      Recipe: { find: () => lean(recipes) },
      Ingredient: { find: () => lean([dough]) },
    },
    "../models/menuModel": {
      find: (q) => {
        // backInStock asks for the menus with a product waiting on stock.
        const docs = q["items.stockOffBy.0"] ? [{ items: menu.items.map((i) => ({ ...i })) }] : [menu];
        return Object.assign(Promise.resolve(docs), { select: () => ({ lean: async () => docs }) });
      },
    },
    "./knotEats": { invalidateListing() {} },
    "./socket": { emitToRestaurant: (rid, event, payload) => emitted.push({ event, payload }) },
  };
  const real = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : real.call(this, request, ...rest);
  };
  delete require.cache[require.resolve("../services/stockProducts")];
  const service = require("../services/stockProducts");
  return { service, dough, chicken, margherita, veggie, chai, menu, emitted, restore: () => { Module._load = real; } };
};

test("turning off for an empty item switches off the products on sale that use it, live on the tills", async (t) => {
  const w = world();
  t.after(w.restore);
  const restaurantId = oid();

  assert.equal(await w.service.countOnSale(restaurantId, w.dough._id), 2, "the two pizzas still on sale");
  const names = await w.service.turnOffFor(restaurantId, w.dough._id);

  assert.deepEqual(names, ["Chicken Pizza", "Margherita Pizza"]);
  assert.equal(w.chicken.isAvailable, false);
  assert.deepEqual(w.chicken.stockOffBy.map(String), [String(w.dough._id)], "remembers why");
  assert.equal(w.menu.systemSnapshot.items.id(w.chicken._id).isAvailable, false, "the tills' copy follows at once");
  assert.equal(w.veggie.stockOffBy, undefined, "switched off by hand: not marked, so never switched back on");
  assert.equal(w.chai.isAvailable, true, "a product that does not use the item is untouched");
  assert.equal(w.emitted.at(-1).event, "menu:updated");
});

test("back in stock: the products turned off for it come back on (Yes), and the one off by hand stays off", async (t) => {
  const w = world();
  t.after(w.restore);
  const restaurantId = oid();
  await w.service.turnOffFor(restaurantId, w.dough._id);

  assert.deepEqual((await w.service.backInStock(restaurantId)).products, [], "still nothing on the shelf");
  w.dough.stockQuantity = 10;
  const back = await w.service.backInStock(restaurantId);
  assert.deepEqual(back.products.map((p) => p.name), ["Chicken Pizza", "Margherita Pizza"]);
  assert.deepEqual(back.ingredients, ["Pizza Dough"]);

  assert.equal(await w.service.answerBackInStock(restaurantId, true), 2);
  assert.deepEqual([w.chicken.isAvailable, w.margherita.isAvailable, w.veggie.isAvailable], [true, true, false]);
  assert.equal(w.chicken.stockOffBy, undefined, "no longer waiting for stock");
  assert.equal(w.menu.systemSnapshot.items.id(w.margherita._id).isAvailable, true);
});

test("back in stock, No: the products stay off and stop waiting, so nobody is asked again", async (t) => {
  const w = world();
  t.after(w.restore);
  const restaurantId = oid();
  await w.service.turnOffFor(restaurantId, w.dough._id);
  w.dough.stockQuantity = 10;

  assert.equal(await w.service.answerBackInStock(restaurantId, false), 0);
  assert.deepEqual([w.chicken.isAvailable, w.margherita.isAvailable], [false, false]);
  assert.deepEqual([w.chicken.stockOffBy, w.margherita.stockOffBy], [undefined, undefined]);
});
