/**
 * "Maximum Selection is OFF but it still limits me to 5."
 *
 * The rule for a group's cap was written out by hand in five places and they
 * disagreed. The Manage Menu editor read an ABSENT `maxSelectionEnabled` as
 * OFF (`=== true`), while the POS panel, the storefront, the storefront
 * pricing service and services/price all read the same absent field as ON
 * (`!== false`). Production proved it: every stored group had
 * `maxSelections: 5` and NO `maxSelectionEnabled` at all, so the editor showed
 * "off" while every consumer capped at five.
 *
 * The field was absent because two write paths -- bulkAddGroupToDishes and
 * addModifierGroup -- persisted maxSelections and never the flag, and Mongoose
 * only applies a subdocument default when the subdocument is created.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { capFor, isCapEnabled, normalizeCap } = require("../services/modifierGroups");
const priceService = require("../services/price");

const oid = () => new mongoose.Types.ObjectId();

test("REGRESSION: Maximum Selection OFF means no limit", () => {
  assert.equal(capFor({ maxSelectionEnabled: false, maxSelections: 5 }), Infinity);
  assert.equal(isCapEnabled({ maxSelectionEnabled: false, maxSelections: 5 }), false);
});

test("REGRESSION: an absent flag is OFF, matching the editor and the schema default", () => {
  // This is the exact shape found in production.
  assert.equal(capFor({ maxSelections: 5 }), Infinity);
});

test("Maximum Selection ON caps at the number", () => {
  assert.equal(capFor({ maxSelectionEnabled: true, maxSelections: 5 }), 5);
  assert.equal(capFor({ maxSelectionEnabled: true, maxSelections: 1 }), 1);
});

test("a nonsense cap value still yields at least one", () => {
  for (const bad of [0, -3, "abc", null, undefined]) {
    assert.equal(capFor({ maxSelectionEnabled: true, maxSelections: bad }), 1, String(bad));
  }
});

test("REGRESSION: normalizeCap always produces BOTH fields", () => {
  // Persisting one without the other is what left groups ambiguous.
  const off = normalizeCap({ maxSelectionEnabled: false, maxSelections: 5 });
  assert.deepEqual(Object.keys(off).sort(), ["maxSelectionEnabled", "maxSelections"]);
  assert.equal(off.maxSelectionEnabled, false);
  // The number survives the cap being off, so switching it back on restores it.
  assert.equal(off.maxSelections, 5);

  const missing = normalizeCap({});
  assert.equal(missing.maxSelectionEnabled, false);
  assert.equal(missing.maxSelections, 1);
});

test("normalizeCap accepts the string 'true' a form may send", () => {
  assert.equal(normalizeCap({ maxSelectionEnabled: "true" }).maxSelectionEnabled, true);
  assert.equal(normalizeCap({ maxSelectionEnabled: "false" }).maxSelectionEnabled, false);
});

// ---- end to end through the pricing path -----------------------------

const productWithGroup = (groupProps) => {
  const groupId = oid();
  const options = ["A", "B", "C", "D", "E", "F", "G"].map((n) => ({
    _id: oid(),
    name: n,
    price: 1,
    isAvailable: true,
  }));
  return {
    groupId,
    options,
    item: {
      _id: oid(),
      name: "Build Your Own",
      price: 100,
      modifierGroups: [{ _id: groupId, name: "Sauce", options, ...groupProps }],
    },
  };
};

const pick = (groupId, options, n) =>
  options.slice(0, n).map((o) => ({
    groupId: String(groupId),
    optionId: String(o._id),
    quantity: 1,
  }));

test("REGRESSION: seven options go through when the cap is off", () => {
  const { item, groupId, options } = productWithGroup({ maxSelectionEnabled: false, maxSelections: 5 });
  const { unitPrice, modifiers } = priceService.calculateUnitPrice({
    item,
    modifierSelections: pick(groupId, options, 7),
  });
  assert.equal(modifiers.length, 7, "the sixth and seventh must not be refused");
  assert.equal(unitPrice, 107);
});

test("REGRESSION: the production shape (no flag, max 5) accepts seven", () => {
  const { item, groupId, options } = productWithGroup({ maxSelections: 5 });
  const { modifiers } = priceService.calculateUnitPrice({
    item,
    modifierSelections: pick(groupId, options, 7),
  });
  assert.equal(modifiers.length, 7);
});

test("the cap is still enforced when it is switched ON", () => {
  const { item, groupId, options } = productWithGroup({ maxSelectionEnabled: true, maxSelections: 5 });
  assert.throws(
    () => priceService.calculateUnitPrice({ item, modifierSelections: pick(groupId, options, 6) }),
    /Maximum 5 selection\(s\)/,
  );
  assert.doesNotThrow(() =>
    priceService.calculateUnitPrice({ item, modifierSelections: pick(groupId, options, 5) }),
  );
});

test("a single-choice group still accepts exactly one", () => {
  const { item, groupId, options } = productWithGroup({ maxSelectionEnabled: true, maxSelections: 1 });
  assert.doesNotThrow(() =>
    priceService.calculateUnitPrice({ item, modifierSelections: pick(groupId, options, 1) }),
  );
  assert.throws(
    () => priceService.calculateUnitPrice({ item, modifierSelections: pick(groupId, options, 2) }),
    /Maximum 1 selection\(s\)/,
  );
});
