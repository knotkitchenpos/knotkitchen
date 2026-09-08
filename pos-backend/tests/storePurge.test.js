const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const { purgeStoreData, KEEP, HANDLED_BY_CALLER } = require("../services/storePurge");

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

/**
 * "Permanently delete" actually deleting something.
 *
 * It only ever flipped `isDeleted` on the Store and the Restaurant. Orders,
 * staff, tables, menus, sessions, QR codes, website settings and agreements
 * all stayed, so the store kept working through any route that did not happen
 * to check those two flags, and none of its data was gone.
 */

const RESTAURANT_ID = new mongoose.Types.ObjectId().toString();
const STORE_ID = "123456";

/** A stand-in model: records the filter it was asked to delete by. */
const fakeModel = (paths, calls, name) => ({
  schema: { paths },
  deleteMany: async (filter) => {
    calls.push([name, filter]);
    return { deletedCount: 1 };
  },
});

const withModels = async (models, fn) => {
  const real = mongoose.models;
  Object.defineProperty(mongoose, "models", { value: models, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(mongoose, "models", { value: real, configurable: true });
  }
};

test("REGRESSION: every store-scoped collection is swept, not just two flags", async () => {
  const calls = [];
  const models = {
    Order: fakeModel({ restaurantId: {} }, calls, "Order"),
    Table: fakeModel({ restaurantId: {} }, calls, "Table"),
    Menu: fakeModel({ restaurantId: {}, storeId: {} }, calls, "Menu"),
    WebsiteSettings: fakeModel({ storeId: {} }, calls, "WebsiteSettings"),
  };

  const out = await withModels(models, () =>
    purgeStoreData({ restaurantId: RESTAURANT_ID, storeId: STORE_ID }),
  );

  assert.deepEqual(
    calls.map(([n]) => n).sort(),
    ["Menu", "Order", "Table", "WebsiteSettings"],
  );
  assert.equal(out.deleted.Order, 1);
});

test("a collection is matched on whichever key it actually carries", async () => {
  const calls = [];
  const models = {
    ByRestaurant: fakeModel({ restaurantId: {} }, calls, "ByRestaurant"),
    ByStore: fakeModel({ storeId: {} }, calls, "ByStore"),
    ByBoth: fakeModel({ restaurantId: {}, storeId: {} }, calls, "ByBoth"),
  };

  await withModels(models, () => purgeStoreData({ restaurantId: RESTAURANT_ID, storeId: STORE_ID }));

  const byName = Object.fromEntries(calls);
  assert.deepEqual(byName.ByRestaurant, { restaurantId: RESTAURANT_ID });
  assert.deepEqual(byName.ByStore, { storeId: STORE_ID });
  assert.deepEqual(byName.ByBoth, {
    $or: [{ restaurantId: RESTAURANT_ID }, { storeId: STORE_ID }],
  });
});

test("an unscoped collection is never touched", async () => {
  // A global collection has no restaurantId and no storeId. Deleting from it
  // with an empty filter would wipe the whole platform.
  const calls = [];
  const models = { PlatformBillingConfig: fakeModel({ singleton: {} }, calls, "PlatformBillingConfig") };
  await withModels(models, () => purgeStoreData({ restaurantId: RESTAURANT_ID, storeId: STORE_ID }));
  assert.deepEqual(calls, []);
});

test("the audit trail and our own invoices survive the store", async () => {
  const calls = [];
  const models = Object.fromEntries(
    [...KEEP, ...HANDLED_BY_CALLER].map((n) => [n, fakeModel({ restaurantId: {}, storeId: {} }, calls, n)]),
  );
  const out = await withModels(models, () =>
    purgeStoreData({ restaurantId: RESTAURANT_ID, storeId: STORE_ID }),
  );

  assert.deepEqual(calls, [], "nothing on the keep list is deleted");
  assert.ok(out.skipped.includes("AuditLog"), "erasing the record OF the deletion is self-defeating");
  assert.ok(out.skipped.includes("PlatformInvoice"), "our issued invoices are our accounting records");
});

test("it refuses to run with no scope at all", async () => {
  // An empty scope would build an empty filter and delete every row in every
  // scoped collection, for every restaurant on the platform.
  await assert.rejects(() => purgeStoreData({}), /needs a restaurantId or a storeId/);
});

test("one failing collection does not hide itself", async () => {
  const calls = [];
  const models = {
    Order: fakeModel({ restaurantId: {} }, calls, "Order"),
    Broken: {
      schema: { paths: { restaurantId: {} } },
      deleteMany: async () => {
        throw new Error("index missing");
      },
    },
  };
  const out = await withModels(models, () =>
    purgeStoreData({ restaurantId: RESTAURANT_ID, storeId: STORE_ID }),
  );
  assert.equal(out.deleted["Broken:ERROR"], "index missing");
  assert.equal(out.deleted.Order, 1, "and the rest still ran");
});

test("REGRESSION: the delete route purges, and the Restaurant really goes", () => {
  const src = SRC("controllers", "csdStoreController.js");
  assert.match(src, /const purge = await purgeStoreData\(\{ restaurantId: store\.restaurantId, storeId \}\);/);
  assert.match(src, /await Restaurant\.deleteOne\(\{ _id: store\.restaurantId \}\);/);
  assert.ok(
    !/Restaurant\.updateOne\(\s*\n?\s*\{ _id: store\.restaurantId \},\s*\n?\s*\{ \$set: \{ isDeleted: true \} \}/.test(src),
    "flagging the restaurant was how a deleted store still resolved on login",
  );
  // What was destroyed is recorded, per collection.
  assert.match(src, /purged: purge\.deleted,/);
});
