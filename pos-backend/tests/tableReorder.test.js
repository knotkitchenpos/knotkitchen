const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Tables in the order the owner dragged them to (hold a card on the Tables
 * screen, move it; owner, 2026-10-31). PUT /api/table/order saves each
 * table's place; GET /api/table lists them in it, tables never arranged after.
 */

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const ID = (n) => `6ae5a0000000000000000${String(n).padStart(3, "0")}`;

const load = (writes) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/tableModel") {
      return {
        bulkWrite: async (ops, opts) => {
          writes.push({ ops, opts });
          return {};
        },
      };
    }
    return orig.apply(this, arguments);
  };
  const file = require.resolve("../controllers/tableController");
  delete require.cache[file];
  try {
    return require(file);
  } finally {
    Module._load = orig;
  }
};

const call = async (fn, body, user = { _id: "u1", restaurantId: RESTAURANT_ID, outletId: null }) => {
  let status;
  let json;
  let error;
  await fn(
    { body, user },
    { status: (s) => ((status = s), { json: (j) => (json = j) }) },
    (e) => (error = e),
  );
  return { status, json, error };
};

test("arranged tables come first in their order; the rest follow by number", () => {
  const { sortTables } = load([]);
  const tables = [
    { tableNumber: 1, sortOrder: null },
    { tableNumber: 2, sortOrder: 1 },
    { tableNumber: 3, sortOrder: 0 },
    { tableNumber: 4 },
  ];
  assert.deepEqual(sortTables(tables).map((t) => t.tableNumber), [3, 2, 1, 4]);
});

test("PUT /api/table/order saves each table's place, only in the signed-in store", async () => {
  const writes = [];
  const { reorderTables } = load(writes);
  const res = await call(reorderTables, { ids: [ID(3), ID(1), ID(2)] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { success: true });
  const ops = writes[0].ops.map((o) => o.updateOne);
  assert.deepEqual(ops.map((o) => [o.filter._id, o.update.$set.sortOrder]), [[ID(3), 0], [ID(1), 1], [ID(2), 2]]);
  for (const o of ops) {
    assert.equal(o.filter.restaurantId, RESTAURANT_ID);
    assert.deepEqual(o.filter.isDeleted, { $ne: true });
  }
});

test("a bad list is refused and nothing is written", async () => {
  const writes = [];
  const { reorderTables } = load(writes);
  for (const body of [{}, { ids: [] }, { ids: ["nope"] }, { ids: [ID(1), ID(1)] }]) {
    const res = await call(reorderTables, body);
    assert.equal(res.error?.status, 400);
  }
  assert.equal(writes.length, 0);
});

test("the route needs the ordinary table permission and sits before /:id", () => {
  const src = fs.readFileSync(path.join(__dirname, "../routes/tableRoute.js"), "utf8");
  assert.match(src, /router\.route\("\/order"\)\.put\(isVerifiedUser, requirePermission\("TABLE_UPDATE"\), reorderTables\);/);
  assert.ok(src.indexOf('route("/order")') < src.indexOf('route("/:id")'));
  assert.match(fs.readFileSync(path.join(__dirname, "../models/tableModel.js"), "utf8"), /sortOrder: \{ type: Number, default: null \}/);
});
