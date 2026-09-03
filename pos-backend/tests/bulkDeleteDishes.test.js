/**
 * Bulk product delete.
 *
 * Manage Menu used to delete a multi-select by firing one deleteDish request
 * per product. Each of those loaded the SAME Menu document, spliced one item
 * and saved it, so the first save bumped `__v` and every other request in
 * flight failed Mongoose's optimistic-concurrency check with a VersionError —
 * surfacing to the operator as "only the first product was deleted" plus an
 * internal server error for the rest.
 *
 * DELETE /api/menu/:menuId/dishes removes the whole selection with a single
 * atomic `$pull … $in`, so there is no document version to race on and no
 * partial outcome.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const RESTAURANT_ID = new mongoose.Types.ObjectId().toString();
const USER_ID = new mongoose.Types.ObjectId().toString();
const MENU_ID = new mongoose.Types.ObjectId().toString();

const user = { _id: USER_ID, role: "Owner", restaurantId: RESTAURANT_ID, storeId: "123456" };

/** Four products; we delete three of them in one go. */
const makeItems = () =>
  [1, 2, 3, 4].map((n) => ({
    _id: new mongoose.Types.ObjectId(),
    name: `Item ${n}`,
    price: n * 10,
    category: "Mains",
  }));

const loadController = (MenuMock) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/menuModel") return MenuMock;
    if (r === "../services/auditService") return { logActivity: async () => {} };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../controllers/menuController")];
  const ctrl = require("../controllers/menuController");
  Module._load = orig;
  return ctrl;
};

const call = async (fn, req) => {
  let err = null;
  let payload = null;
  const res = {
    status() { return res; },
    json(p) { payload = p; return res; },
  };
  await fn(req, res, (e) => { err = e; });
  return { err, payload };
};

test("deletes EVERY selected product in one request, not just the first", async () => {
  const items = makeItems();
  const doomed = [items[0]._id, items[1]._id, items[2]._id];

  const stored = { _id: MENU_ID, name: "Mains", items: [...items] };
  let pullCalls = 0;

  const MenuMock = {
    findOne: async () => stored,
    findById: async () => stored,
    updateOne: async (filter, update) => {
      pullCalls += 1;
      const ids = update.$pull.items._id.$in.map(String);
      stored.items = stored.items.filter((i) => !ids.includes(String(i._id)));
      return { modifiedCount: 1 };
    },
  };

  const { deleteDishes } = loadController(MenuMock);
  const { err, payload } = await call(deleteDishes, {
    user,
    params: { menuId: MENU_ID },
    body: { itemIds: doomed.map(String) },
  });

  assert.equal(err, null, err && err.message);
  assert.equal(payload.success, true);
  assert.equal(payload.meta.deleted, 3, "all three selected products must go");
  assert.equal(stored.items.length, 1, "only the unselected product should remain");
  assert.equal(String(stored.items[0]._id), String(items[3]._id));

  // The point of the fix: ONE write, so there is no version to race.
  assert.equal(pullCalls, 1, "must be a single atomic update, not one per item");
});

test("Select All removes the entire category's products", async () => {
  const items = makeItems();
  const stored = { _id: MENU_ID, name: "Mains", items: [...items] };

  const MenuMock = {
    findOne: async () => stored,
    findById: async () => stored,
    updateOne: async (filter, update) => {
      const ids = update.$pull.items._id.$in.map(String);
      stored.items = stored.items.filter((i) => !ids.includes(String(i._id)));
      return { modifiedCount: 1 };
    },
  };

  const { deleteDishes } = loadController(MenuMock);
  const { err, payload } = await call(deleteDishes, {
    user,
    params: { menuId: MENU_ID },
    body: { itemIds: items.map((i) => String(i._id)) },
  });

  assert.equal(err, null);
  assert.equal(payload.meta.deleted, 4);
  assert.equal(stored.items.length, 0);
});

test("an empty selection is refused rather than silently doing nothing", async () => {
  const MenuMock = { findOne: async () => ({ _id: MENU_ID, items: [] }), findById: async () => ({ items: [] }), updateOne: async () => ({}) };
  const { deleteDishes } = loadController(MenuMock);
  const { err } = await call(deleteDishes, { user, params: { menuId: MENU_ID }, body: { itemIds: [] } });
  assert.equal(err?.status, 400);
});

test("a category belonging to another tenant is not touched", async () => {
  // findOne is what applies menuScopeFor(); no match means no delete.
  const MenuMock = {
    findOne: async () => null,
    findById: async () => null,
    updateOne: async () => { throw new Error("must not reach updateOne for a foreign menu"); },
  };
  const { deleteDishes } = loadController(MenuMock);
  const { err } = await call(deleteDishes, {
    user,
    params: { menuId: MENU_ID },
    body: { itemIds: [new mongoose.Types.ObjectId().toString()] },
  });
  assert.equal(err?.status, 404);
});

test("malformed ids are rejected instead of reaching the database", async () => {
  const MenuMock = {
    findOne: async () => ({ _id: MENU_ID, items: [] }),
    findById: async () => ({ items: [] }),
    updateOne: async () => { throw new Error("must not run with no valid ids"); },
  };
  const { deleteDishes } = loadController(MenuMock);
  const { err } = await call(deleteDishes, {
    user,
    params: { menuId: MENU_ID },
    body: { itemIds: ["not-an-id", "still-not"] },
  });
  assert.equal(err?.status, 400);
});
