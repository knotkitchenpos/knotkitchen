import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isCustomisable, simpleLine, qtyInCart, linesFor } from "./cartLine.js";

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const dal = { id: "i1", menuId: "m1", name: "Dal Makhani", price: 249, dispatchType: { collection: true }, dispatchLabel: null };

test("ADD puts a plain dish in the cart exactly as the product sheet would", () => {
  assert.deepEqual(simpleLine(dal), {
    menuId: "m1",
    itemId: "i1",
    name: "Dal Makhani",
    dispatchType: { collection: true },
    dispatchLabel: null,
    quantity: 1,
    unitPrice: 249,
    price: 249,
    variant: null,
    addons: [],
    modifierSelections: [],
    note: "",
  });
  // The fields the sheet sends too, so the two merge into one cart line.
  const sheet = read("components/ProductModal.jsx");
  for (const k of ["menuId", "itemId", "variant", "addons", "modifierSelections", "note"]) assert.match(sheet, new RegExp(`\\b${k}:`), k);
});

test("a dish with anything to choose opens its sheet instead", () => {
  assert.equal(isCustomisable(dal), false);
  assert.equal(isCustomisable({ ...dal, variants: [{ id: "v" }] }), true);
  assert.equal(isCustomisable({ ...dal, addons: [{ id: "a" }] }), true);
  assert.equal(isCustomisable({ ...dal, modifierGroups: [{ id: "g" }] }), true);
});

test("the stepper counts every line of the dish", () => {
  const items = [
    { itemId: "i1", quantity: 2 },
    { itemId: "i1", quantity: 1, note: "no onion" },
    { itemId: "i2", quantity: 5 },
  ];
  assert.equal(qtyInCart(items, "i1"), 3);
  assert.equal(linesFor(items, "i1").length, 2);
  assert.equal(qtyInCart([], "i1"), 0);
});

test("the menu page: categories aside and a phone Menu button, search, veg only, cart bar", () => {
  const shell = read("components/StoreShell.jsx");
  assert.match(shell, /data-cat=\{String\(category\.id\)\}/);
  assert.match(shell, /new IntersectionObserver\(/, "the category being read lights up");
  assert.match(shell, /placeholder="Search within menu"/);
  assert.match(shell, /Veg only/);
  assert.match(shell, /View cart ›/);
  assert.match(shell, /<MenuSheet/);
  assert.doesNotMatch(shell, /zomato/i, "our own design, no one else's name");
});
