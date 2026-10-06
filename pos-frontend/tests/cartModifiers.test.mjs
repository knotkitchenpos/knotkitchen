import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const { default: cart, addItems, removeModifier, canRemoveModifier } = await import("../src/redux/slices/cartSlice.js");
const panel = fs.readFileSync(new URL("../src/components/pos/ProductPanel.jsx", import.meta.url), "utf8");

const line = (mods) => ({
  id: 1, menuItemId: "m", pricePerQuantity: 120, price: 120, quantity: 1,
  modifiers: mods, modifierSelections: mods,
});

test("removing an extra removes it from modifierSelections too", () => {
  const cheese = { groupName: "Toppings", optionName: "Cheese", price: 20, quantity: 1 };
  let state = cart(undefined, addItems(line([cheese])));
  state = cart(state, removeModifier({ id: 1, index: 0 }));
  assert.deepEqual(state[0].modifiers, []);
  assert.deepEqual(state[0].modifierSelections, [], "the server would still bill the removed extra");
  assert.equal(state[0].price, 100);
});

test("the last choice of a required group cannot be removed", () => {
  const naan = { groupName: "Bread", optionName: "Naan", price: 20, quantity: 1, required: true };
  let state = cart(undefined, addItems(line([naan])));
  assert.equal(canRemoveModifier(state[0], 0), false);
  const before = state;
  state = cart(state, removeModifier({ id: 1, index: 0 }));
  assert.equal(state, before, "the line must be unchanged");

  const roti = { ...naan, optionName: "Roti" };
  assert.equal(canRemoveModifier({ modifiers: [naan, roti] }, 0), true, "another Bread choice remains");
});

test("ProductPanel marks extras from required groups", () => {
  assert.match(panel, /required: Boolean\(group\.required\)/);
});
