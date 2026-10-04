const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

/**
 * Finishing a deletion that was never finished.
 *
 * Deleting a store used to be two isDeleted flags and nothing else. Every
 * store removed before the purge shipped therefore still owns its restaurant,
 * its users, its orders and its menus: the staff can still sign in, and the
 * store is still there in every way that matters.
 *
 * Those stores were also stranded. The search filtered them out, so nobody
 * could see them, and updateStoreStatus refused to load an already-flagged
 * row, so the delete could not be run again. There was no way to finish the
 * job from anywhere in the product.
 */

const CTRL = SRC("controllers", "csdStoreController.js");

test("REGRESSION: an already-deleted store can be deleted again", () => {
  // The 404 that stranded them: `Store.findOne({ storeId, isDeleted: { $ne:
  // true } })` never matched a flagged row.
  assert.match(
    CTRL,
    /const store = await Store\.findOne\(\{\s*\n\s*storeId,\s*\n\s*\.\.\.\(status === "deleted" \? \{\} : \{ isDeleted: \{ \$ne: true \} \}\),\s*\n\s*\}\);/,
  );
});

test("but every other status still refuses, so a deleted store cannot be revived", () => {
  // Loading a flagged row for `status: "active"` would put the store back
  // into service with none of its data left.
  const update = CTRL.slice(CTRL.indexOf("const updateStoreStatus"));
  assert.match(update, /status === "deleted" \? \{\} : \{ isDeleted: \{ \$ne: true \} \}/);
  assert.ok(
    !/isDeleted: false/.test(CTRL),
    "nothing un-flags a store",
  );
});

test("REGRESSION: staff can see deleted stores in order to clear them", () => {
  assert.match(CTRL, /const includeDeleted = status === "deleted";/);
  assert.match(CTRL, /const notDeleted = includeDeleted \? \{\} : \{ isDeleted: \{ \$ne: true \} \};/);

  // Every query in the search must honour it, or the row appears in one half
  // and vanishes in the other -- which is how it stayed invisible.
  const search = CTRL.slice(CTRL.indexOf("const notDeleted ="), CTRL.indexOf("const getStore"));
  assert.ok(
    !/isDeleted: \{ \$ne: true \}/.test(search.slice(search.indexOf(";"))),
    "a hard-coded filter left in the search hides the rows again",
  );
  assert.equal(
    search.split("...notDeleted").length - 1,
    5,
    "store filter, restaurant filter, and the three page lookups",
  );

  // And the operator needs the option in front of them.
  const ui = SRC("..", "csd-web", "src", "pages", "StoreSearch.jsx");
  assert.match(ui, /"closed_until", "deleted"\]/);
});

test("REGRESSION: the purge is scoped even when the Store row has no restaurantId", () => {
  // restaurantId is optional on Store. Tables, menus, bills and sessions are
  // keyed ONLY by restaurantId, so a Store row missing that link had all of
  // them skipped -- a "purge" that removed almost nothing.
  assert.match(CTRL, /const restaurantId = store\.restaurantId \|\| restaurant\?\._id \|\| null;/);
  assert.match(CTRL, /const purge = await purgeStoreData\(\{ restaurantId, storeId \}\);/);
  assert.match(CTRL, /\{ storeId \},\s*\n\s*\],\s*\n\s*\}\)\.select\("_id"\);/, "resolved by storeId when the link is absent");
});

test("REGRESSION: a deleted store's page opens, so staff can act on it", () => {
  // getStore 404'd on a flagged row, so a store found in the search could not
  // be opened -- and the delete button lives on that page.
  const get = CTRL.slice(CTRL.indexOf("const getStore"), CTRL.indexOf("const permanentlyDeleteStore"));
  assert.match(get, /const store = await Store\.findOne\(\{ storeId \}\)\.lean\(\);/);
  assert.ok(!/isDeleted: \{ \$ne: true \}/.test(get), "the page must not hide a deleted store");
});

test("the restaurant goes by both links", () => {
  // Deleting by id alone left a Restaurant row that only carried the storeId,
  // and a live Restaurant is what let a deleted store resolve on login.
  assert.match(CTRL, /await Restaurant\.deleteOne\(\{ _id: restaurantId \}\);/);
  assert.match(CTRL, /await Restaurant\.deleteMany\(\{ storeId \}\);/);
});

test("a second pass is safe to run", () => {
  // purgeStoreData is a sweep by scope, not a list of ids, so re-running it
  // removes whatever the first pass never did and no-ops on the rest.
  const purge = SRC("services", "storePurge.js");
  assert.match(purge, /const res = await Model\.deleteMany\(filter\);/);
  assert.ok(
    !/findOneAndDelete|deleteOne\(/.test(purge),
    "a single-document delete would not be idempotent across passes",
  );
  // And it still refuses to run unscoped, which a re-run must not weaken.
  assert.match(purge, /throw new Error\("purgeStoreData needs a restaurantId or a storeId\."\);/);
});

test("Knot Eats reviews go with the store, and their model is registered at boot", async () => {
  // The sweep only sees models that have been required. The review model is
  // pulled in by app.js -> knotEatsRoute -> knotEatsController.
  const mongoose = require("mongoose");
  const KnotEatsReview = require("../models/knotEatsReviewModel");
  const { purgeStoreData } = require("../services/storePurge");
  const calls = [];
  const real = mongoose.models;
  Object.defineProperty(mongoose, "models", {
    value: { KnotEatsReview: { schema: KnotEatsReview.schema, deleteMany: async (f) => (calls.push(f), { deletedCount: 2 }) } },
    configurable: true,
  });
  try {
    const restaurantId = new mongoose.Types.ObjectId().toString();
    const out = await purgeStoreData({ restaurantId, storeId: "231146" });
    assert.deepEqual(calls, [{ $or: [{ restaurantId }, { storeId: "231146" }] }]);
    assert.equal(out.deleted.KnotEatsReview, 2);
  } finally {
    Object.defineProperty(mongoose, "models", { value: real, configurable: true });
  }

  assert.match(SRC("app.js"), /app\.use\("\/api\/eats", require\("\.\/routes\/knotEatsRoute"\)\)/);
  assert.match(SRC("routes", "knotEatsRoute.js"), /require\("\.\.\/controllers\/knotEatsController"\)/);
  assert.match(SRC("controllers", "knotEatsController.js"), /require\("\.\.\/models\/knotEatsReviewModel"\)/);
});
