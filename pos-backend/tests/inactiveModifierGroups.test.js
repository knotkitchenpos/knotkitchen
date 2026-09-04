/**
 * A modifier group switched OFF must not be sold, and must not block a sale.
 *
 * Both pricing paths iterated EVERY group on a product, while both clients
 * (the QR options sheet and the storefront) hide groups with isActive false.
 * A group turned off but still marked Required therefore demanded a choice the
 * customer was never shown -- an error they could not clear, so the product
 * simply could not be ordered.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const priceService = require("../services/price");

const oid = () => new mongoose.Types.ObjectId();

const productWith = (groupProps) => {
  const groupId = oid();
  const optionId = oid();
  return {
    groupId,
    optionId,
    item: {
      _id: oid(),
      name: "Nutella Brownie",
      price: 100,
      modifierGroups: [
        {
          _id: groupId,
          name: "Sauce",
          options: [{ _id: optionId, name: "Tomato Sauce", price: 5, isAvailable: true }],
          ...groupProps,
        },
      ],
    },
  };
};

test("REGRESSION: an inactive REQUIRED group does not block the order", () => {
  const { item } = productWith({ required: true, isActive: false });

  const { unitPrice, modifiers } = priceService.calculateUnitPrice({ item, modifierSelections: [] });

  assert.equal(unitPrice, 100, "the base price, with nothing demanded");
  assert.deepEqual(modifiers, []);
});

test("an ACTIVE required group still blocks, as it must", () => {
  const { item } = productWith({ required: true, isActive: true });
  assert.throws(
    () => priceService.calculateUnitPrice({ item, modifierSelections: [] }),
    /Please select "Sauce"/,
  );
});

test("a group predating the isActive flag keeps blocking", () => {
  // undefined is NOT off. Treating it as off would quietly stop enforcing
  // every required group created before the flag existed.
  const { item } = productWith({ required: true });
  assert.throws(
    () => priceService.calculateUnitPrice({ item, modifierSelections: [] }),
    /Please select "Sauce"/,
  );
});

test("REGRESSION: an option from an inactive group is never charged", () => {
  // It is hidden from the customer, so it is not on sale -- a crafted request
  // must not be able to add it to the bill either.
  const { item, groupId, optionId } = productWith({ isActive: false });

  const { unitPrice, modifiers } = priceService.calculateUnitPrice({
    item,
    modifierSelections: [{ groupId: String(groupId), optionId: String(optionId), quantity: 1 }],
  });

  assert.equal(unitPrice, 100, "the +5 option must not be applied");
  assert.deepEqual(modifiers, []);
});

test("an option from an ACTIVE group is charged normally", () => {
  const { item, groupId, optionId } = productWith({ isActive: true });
  const { unitPrice, modifiers } = priceService.calculateUnitPrice({
    item,
    modifierSelections: [{ groupId: String(groupId), optionId: String(optionId), quantity: 1 }],
  });
  assert.equal(unitPrice, 105);
  assert.deepEqual(modifiers, [{ name: "Tomato Sauce", price: 5 }]);
});

test("an inactive group's max-selection cap cannot fire", () => {
  // The cap is only meaningful for a group the customer can actually see.
  const { item, groupId, optionId } = productWith({
    isActive: false,
    maxSelectionEnabled: true,
    maxSelections: 1,
  });
  assert.doesNotThrow(() =>
    priceService.calculateUnitPrice({
      item,
      modifierSelections: [
        { groupId: String(groupId), optionId: String(optionId), quantity: 5 },
      ],
    }),
  );
});
