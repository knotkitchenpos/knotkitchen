const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { cleanPopularIds, popularSettingsOf, buildPopularList, POPULAR_MAX } = require("../services/popularSettings");

const id = (n) => n.toString(16).padStart(24, "0");
const dish = (n) => ({ _id: id(n), name: `Dish ${n}` });
const byId = new Map([1, 2, 3, 4, 5, 6].map((n) => [id(n), dish(n)]));

test("pinned ids: ObjectId-shaped, each once, capped", () => {
  assert.deepEqual(cleanPopularIds([id(1), "nope", id(1), id(2), null]), [id(1), id(2)]);
  assert.equal(cleanPopularIds(Array.from({ length: 60 }, (_, i) => id(i + 1))).length, POPULAR_MAX);
  assert.deepEqual(cleanPopularIds("x"), []);
});

test("settings default for a store saved before they existed, and the count never hides a pinned dish", () => {
  assert.deepEqual(popularSettingsOf({}), { popularCount: 12, popularItemIds: [], popularFill: true });
  const s = popularSettingsOf({ posSettings: { popularCount: 2, popularItemIds: [id(1), id(2), id(3)], popularFill: false } });
  assert.equal(s.popularCount, 3);
  assert.equal(s.popularFill, false);
});

test("pinned dishes first in their order, best sellers fill the rest without repeats", () => {
  const ranked = [dish(3), dish(1), dish(4), dish(5)];
  const out = buildPopularList({ pinnedIds: [id(2), id(1)], byId, ranked, count: 4, fill: true });
  assert.deepEqual(out.map((d) => d.name), ["Dish 2", "Dish 1", "Dish 3", "Dish 4"]);
  assert.equal(out[0].pinned, true);
});

test("only the pinned dishes when filling is off; a dish gone from the menu is skipped", () => {
  const out = buildPopularList({ pinnedIds: [id(9), id(5)], byId, ranked: [dish(1)], count: 6, fill: false });
  assert.deepEqual(out.map((d) => d.name), ["Dish 5"]);
});

test("no pinned dishes: the best sellers, cut to the count", () => {
  const out = buildPopularList({ pinnedIds: [], byId, ranked: [dish(1), dish(2), dish(3)], count: 2 });
  assert.deepEqual(out.map((d) => d.name), ["Dish 1", "Dish 2"]);
});

test("the settings API and the till's list both use the store's Popular Items settings", () => {
  const ctrl = fs.readFileSync(path.join(__dirname, "..", "controllers", "restaurantController.js"), "utf8");
  assert.match(ctrl, /"popularItemIds" in body/);
  assert.match(ctrl, /\.\.\.popularSettingsOf\(restaurant\)/);
  assert.match(ctrl, /emitToRestaurant\(String\(restaurant\._id\), "posSettings:updated"/);
  const order = fs.readFileSync(path.join(__dirname, "..", "controllers", "orderController.js"), "utf8");
  assert.match(order, /popularCfg \? popularCfg\.popularCount/);
  assert.match(order, /buildPopularList\(\{ pinnedIds, byId: dishesById, ranked: popular/);
});
