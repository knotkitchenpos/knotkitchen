// -----------------------------------------------------------------------------
// Modifier group caps — unit tests
// -----------------------------------------------------------------------------
// Run with: node customer-web/src/lib/modifierGroups.test.mjs

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { capLabel, capOf } from "./modifierGroups.js";

test("REGRESSION: a group with no cap flag is uncapped", () => {
  // This is the shape found in production: a stored `maxSelections` and no
  // flag beside it. Reading the number directly capped a "choose any" group
  // at one, so a customer could add a single drink and the next tap did
  // nothing at all.
  assert.equal(capOf({ maxSelections: 5 }), Infinity);
  assert.equal(capOf({}), Infinity);
  assert.equal(capOf(), Infinity);
});

test("a cap applies only when Maximum Selection is explicitly on", () => {
  assert.equal(capOf({ maxSelectionEnabled: false, maxSelections: 5 }), Infinity);
  assert.equal(capOf({ maxSelectionEnabled: true, maxSelections: 5 }), 5);
  assert.equal(capOf({ maxSelectionEnabled: true, maxSelections: 1 }), 1);
});

test("a nonsense cap still yields at least one", () => {
  for (const bad of [0, -3, "abc", null, undefined]) {
    assert.equal(capOf({ maxSelectionEnabled: true, maxSelections: bad }), 1, String(bad));
  }
});

test("the label says what the customer may actually do", () => {
  assert.equal(capLabel({ maxSelections: 5 }), "Choose any");
  assert.equal(capLabel({ maxSelectionEnabled: true, maxSelections: 1 }), "Choose 1");
  assert.equal(capLabel({ maxSelectionEnabled: true, maxSelections: 3 }), "Choose up to 3");
});
