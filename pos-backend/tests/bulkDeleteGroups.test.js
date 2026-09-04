/**
 * Bulk delete of modifier groups.
 *
 * Manage Menu deleted a multi-select by firing one request PER group, in
 * parallel. Each request loaded the SAME Menu documents, filtered one group out
 * and called save(), so the first save bumped `__v` and every other request in
 * flight failed Mongoose's optimistic-concurrency check with a VersionError.
 * The operator saw the first group disappear and "Internal Server Error" for
 * the rest — the identical fault already fixed for products in
 * bulkDeleteDishes.test.js, which the group path never received.
 *
 * The endpoint now takes `groupNames: []` and removes them with one atomic
 * `$pull … $in`. Nothing is loaded to be written back, so there is no document
 * version to race on and no partial outcome.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const RESTAURANT_ID = new mongoose.Types.ObjectId().toString();
const USER_ID = new mongoose.Types.ObjectId().toString();

const user = { _id: USER_ID, role: "Owner", restaurantId: RESTAURANT_ID, storeId: "123456" };

/** Two products, each carrying the same three groups. */
const makeMenus = () => [
  {
    _id: new mongoose.Types.ObjectId(),
    name: "Mains",
    items: [
      { _id: new mongoose.Types.ObjectId(), name: "Burger", modifierGroups: [{ name: "Sauce" }, { name: "Cheese" }, { name: "Extras" }] },
      { _id: new mongoose.Types.ObjectId(), name: "Wrap", modifierGroups: [{ name: "Sauce" }, { name: "Cheese" }] },
    ],
  },
];

/**
 * The mock refuses save() outright: reaching for it is what caused the bug, so
 * a return to the load-and-save shape fails here instead of in production.
 */
const makeMenuMock = () => {
  const calls = { find: 0, lean: 0, updateMany: [], saved: 0 };
  const MenuMock = {
    find(filter) {
      calls.find += 1;
      calls.lastFilter = filter;
      const docs = makeMenus().map((m) => ({
        ...m,
        save() {
          calls.saved += 1;
          throw new Error("save() must not be used: it is what raced __v and 500'd");
        },
      }));
      return {
        lean: async () => { calls.lean += 1; return docs; },
        then: (resolve) => resolve(docs),
      };
    },
    async updateMany(filter, update) {
      calls.updateMany.push({ filter, update });
      return { modifiedCount: 1 };
    },
  };
  return { MenuMock, calls };
};

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
    statusCode: 200,
    status(c) { res.statusCode = c; return res; },
    json(p) { payload = p; return res; },
  };
  await fn(req, res, (e) => { err = e; });
  return { err, payload, res };
};

test("REGRESSION: deletes EVERY selected group in one request", async () => {
  const { MenuMock, calls } = makeMenuMock();
  const ctrl = loadController(MenuMock);

  const { err, payload } = await call(ctrl.deleteGroupFromDishes, {
    user,
    body: { groupNames: ["Sauce", "Cheese", "Extras"] },
  });

  assert.ifError(err);
  assert.equal(payload.success, true);
  assert.equal(calls.updateMany.length, 1, "one atomic write, not one per group");

  const pulled = calls.updateMany[0].update.$pull["items.$[].modifierGroups"];
  assert.deepEqual(pulled.name.$in, ["Sauce", "Cheese", "Extras"]);
  assert.deepEqual(payload.deleted, ["Sauce", "Cheese", "Extras"]);
});

test("REGRESSION: no document is loaded to be saved, so nothing can race __v", async () => {
  const { MenuMock, calls } = makeMenuMock();
  const ctrl = loadController(MenuMock);

  await call(ctrl.deleteGroupFromDishes, { user, body: { groupNames: ["Sauce", "Cheese"] } });

  assert.equal(calls.saved, 0, "save() was called — the VersionError bug is back");
  assert.equal(calls.lean, 1, "the only read is lean(), which tracks nothing for saving");
});

test("reports how many attachments went, across every product", async () => {
  const { MenuMock } = makeMenuMock();
  const ctrl = loadController(MenuMock);

  const { payload } = await call(ctrl.deleteGroupFromDishes, {
    user,
    body: { groupNames: ["Sauce", "Cheese"] },
  });

  // Burger has both, Wrap has both.
  assert.equal(payload.count, 4);
});

test("the single Delete button still works", async () => {
  const { MenuMock, calls } = makeMenuMock();
  const ctrl = loadController(MenuMock);

  const { err, payload } = await call(ctrl.deleteGroupFromDishes, {
    user,
    body: { groupName: "Sauce" },
  });

  assert.ifError(err);
  assert.deepEqual(calls.updateMany[0].update.$pull["items.$[].modifierGroups"].name.$in, ["Sauce"]);
  assert.match(payload.message, /Group "Sauce" deleted/);
});

test("names are trimmed and de-duplicated", async () => {
  const { MenuMock, calls } = makeMenuMock();
  const ctrl = loadController(MenuMock);

  await call(ctrl.deleteGroupFromDishes, {
    user,
    body: { groupNames: ["  Sauce  ", "Sauce", "Cheese", "", null] },
  });

  assert.deepEqual(calls.updateMany[0].update.$pull["items.$[].modifierGroups"].name.$in, ["Sauce", "Cheese"]);
});

test("an empty selection is refused, not treated as delete-everything", async () => {
  const { MenuMock, calls } = makeMenuMock();
  const ctrl = loadController(MenuMock);

  const { err } = await call(ctrl.deleteGroupFromDishes, { user, body: { groupNames: [] } });

  assert.ok(err, "must reject");
  assert.equal(err.status ?? err.statusCode, 400);
  assert.equal(calls.updateMany.length, 0, "nothing may be written");
});

test("REGRESSION: the delete is scoped to this takeaway", async () => {
  const { MenuMock, calls } = makeMenuMock();
  const ctrl = loadController(MenuMock);

  await call(ctrl.deleteGroupFromDishes, { user, body: { groupNames: ["Sauce"] } });

  // An unscoped $pull would strip the group from every takeaway at once.
  assert.equal(String(calls.updateMany[0].filter.restaurantId), RESTAURANT_ID);
  assert.equal(calls.updateMany[0].filter.$or, undefined);
});
