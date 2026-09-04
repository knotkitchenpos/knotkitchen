/**
 * Takeaway isolation for menus, categories, products and groups.
 *
 * menuScopeFor() was `{ $or: [ {restaurantId}, {createdBy} ] }`. The $or is a
 * UNION, not a fallback, so anyone who created menus for two takeaways saw
 * both sets merged. Every group endpoint keys off the group NAME across every
 * menu in scope, so renaming/deleting/toggling "Sauce" in one takeaway did it
 * in the other too -- and csvMenuController's "replace all" runs
 * Menu.deleteMany(menuScopeFor(user)), which would have wiped the other
 * takeaway's menus outright.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const menuController = require("../controllers/menuController");
const csvMenuController = require("../controllers/csvMenuController");

const oid = () => new mongoose.Types.ObjectId();

// The helper is module-private, so exercise it through the shape it produces.
// Rebuilt here identically in both controllers; assert on both.
const scopeOf = (mod) => mod.__menuScopeForTest;

test("menuScopeFor is exported for testing from both controllers", () => {
  assert.equal(typeof scopeOf(menuController), "function", "menuController must expose it");
  assert.equal(typeof scopeOf(csvMenuController), "function", "csvMenuController must expose it");
});

for (const [label, mod] of [["menuController", menuController], ["csvMenuController", csvMenuController]]) {
  test(`${label}: REGRESSION: scope is the tenant ALONE, never a $or union`, () => {
    const scope = scopeOf(mod)({ _id: oid(), restaurantId: oid() });
    assert.equal(scope.$or, undefined, "a $or union re-opens the cross-takeaway leak");
    assert.deepEqual(Object.keys(scope), ["restaurantId"]);
  });

  test(`${label}: REGRESSION: a creator's other takeaway is out of scope`, () => {
    const creator = oid();
    const takeawayA = oid();
    const takeawayB = oid();

    const scope = scopeOf(mod)({ _id: creator, restaurantId: takeawayA });

    // Simulate the query against menus from both takeaways, both created by
    // the same person -- exactly the case the $or merged.
    const menus = [
      { name: "Tea", restaurantId: takeawayA, createdBy: creator },
      { name: "Tea", restaurantId: takeawayB, createdBy: creator },
    ];
    const matched = menus.filter((m) => String(m.restaurantId) === String(scope.restaurantId));

    assert.equal(matched.length, 1, "only the current takeaway's menu may match");
    assert.equal(String(matched[0].restaurantId), String(takeawayA));
  });

  test(`${label}: staff still reach menus their owner created`, () => {
    const takeaway = oid();
    const owner = oid();
    const staff = oid();

    const scope = scopeOf(mod)({ _id: staff, restaurantId: takeaway });
    const ownerMenu = { restaurantId: takeaway, createdBy: owner };

    assert.equal(
      String(ownerMenu.restaurantId),
      String(scope.restaurantId),
      "shared restaurantId is what grants staff access",
    );
  });

  test(`${label}: createdBy remains the fallback for a user with no tenant`, () => {
    const legacy = oid();
    const scope = scopeOf(mod)({ _id: legacy });
    assert.deepEqual(Object.keys(scope), ["createdBy"]);
    assert.equal(String(scope.createdBy), String(legacy));
  });

  test(`${label}: outletId never narrows the scope`, () => {
    // Every menu has outletId null. Including it would hide all of them the
    // moment a user gained an outletId.
    const scope = scopeOf(mod)({ _id: oid(), restaurantId: oid(), outletId: oid() });
    assert.equal(scope.outletId, undefined);
    assert.deepEqual(Object.keys(scope), ["restaurantId"]);
  });
}
