import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isCustomisable, simpleLine, qtyInCart, linesFor, priceFor, lineUnitPrice } from "./cartLine.js";

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

test("each channel shows what the server bills for it (pickup: collection, delivery: delivery)", () => {
  const chai = { id: "i9", menuId: "m1", price: 5, prices: { collection: 5, delivery: 7 } };
  assert.equal(priceFor(chai, "delivery"), 7);
  assert.equal(priceFor(chai, "collection"), 5);
  assert.equal(priceFor({ price: 5 }, "delivery"), 5, "an older payload without prices falls back to price");
});

test("a cart line is re-priced from the latest menu for the chosen channel", () => {
  const chai = { id: "i9", menuId: "m1", price: 5, prices: { collection: 5, delivery: 7 }, variants: [{ id: "v1", name: "Large", price: 30 }] };
  // Stamped at 4 (an older menu); the server bills 7 + 10 + 5 on delivery.
  const plain = { ...simpleLine({ ...chai, price: 4 }), addons: [{ addonId: "a1", price: 10 }], modifierSelections: [{ groupId: "g", optionId: "o", price: 5 }] };
  assert.equal(lineUnitPrice(plain, chai, "delivery"), 22);
  assert.equal(lineUnitPrice(plain, chai, "collection"), 20);
  // A variant replaces the channel price with the variant's CURRENT price.
  const large = { ...plain, addons: [], modifierSelections: [], variant: { variantId: "v1", name: "Large", price: 25 } };
  assert.equal(lineUnitPrice(large, chai, "delivery"), 30);
  assert.equal(lineUnitPrice({ ...large, variant: { variantId: "gone", price: 25 } }, chai, "delivery"), 25, "a variant no longer listed keeps its stamped price");
  // A dish no longer on the menu keeps its stamped price; the server refuses it.
  assert.equal(lineUnitPrice({ ...plain, unitPrice: 19 }, undefined, "delivery"), 19);
});

test("the cart, the menu and the product sheet all read the channel price", () => {
  const cart = read("hooks/useCart.js");
  assert.match(cart, /lineUnitPrice\(l, index\.get\(`\$\{l\.menuId\}:\$\{l\.itemId\}`\), channel\)/);
  assert.match(read("components/CartDrawer.jsx"), /cart\.setChannel\?\.\(channel\)/);
  assert.match(read("pages/StorePage.jsx"), /useCart\(effectiveSlug, store\?\.categories\)/);
  const shell = read("components/StoreShell.jsx");
  assert.match(shell, /price: priceFor\(p, cart\.channel\)/);
  assert.match(shell, /product=\{\{ \.\.\.selected, price: priceFor\(selected, cart\.channel\) \}\}/);
  assert.doesNotMatch(read("components/ProductCard.jsx"), /originalPrice/);
});

test("REGRESSION: the landing's popular dish shows the delivery price at a pickup-less store", () => {
  // content.js imports "./data" without an extension, so Node cannot load it: guard the source.
  const landing = read("components/landing/content.js");
  assert.match(landing, /const channel = store\?\.ordering\?\.pickupEnabled === false \? "delivery" : "collection";/);
  assert.match(landing, /money\(symbol, priceFor\(p, channel\)\)/);
  const chai = { price: 5, prices: { collection: 5, delivery: 7 } };
  assert.equal(priceFor(chai, "delivery"), 7, "every order at a pickup-less store is a delivery, billed 7");
});

test("REGRESSION: a pickup slot that drops out on the 30 s menu refresh is cleared, not sent", () => {
  assert.match(
    read("components/CartDrawer.jsx"),
    /useEffect\(\(\) => \{\s*if \(pickupAt && !pickupSlots\.some\(\(t\) => t\.toISOString\(\) === pickupAt\)\) setPickupAt\(""\);[\s\S]{0,120}\}, \[pickupSlots\]\);/,
  );
});

test("REGRESSION A4: the card's stepper is 40 px tall, so overflow-hidden does not clip its 40 px buttons", () => {
  const card = read("components/ProductCard.jsx");
  assert.match(card, /const base =\s*"h-10 w-\[104px\]/);
  assert.doesNotMatch(card, /\bh-9\b/);
  assert.equal((card.match(/min-h-\[40px\]/g) || []).length, 2);
});
