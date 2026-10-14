import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const { repriceCart } = await import("../src/utils/qrCart.js");

const chai = { _id: "chai", name: "Chai", price: 6 };
const line = (over = {}) => ({ key: "chai", item: { ...chai, price: 4 }, qty: 2, variant: null, modifiers: [], unitPrice: 4, ...over });

test("owner case: a line held at ₹4 shows ₹6 once the menu says the Table price is 6", () => {
  const out = repriceCart({ chai: line() }, [chai]);
  assert.equal(out.chai.unitPrice, 6);
  assert.equal(out.chai.qty, 2);
});

test("modifiers add on to the fresh base: 6 + 10 = 16", () => {
  const mods = [{ groupName: "Extras", optionName: "Ginger", price: 10, quantity: 1 }];
  const out = repriceCart({ k: line({ key: "k", modifiers: mods, unitPrice: 14 }) }, [chai]);
  assert.equal(out.k.unitPrice, 16);
});

test("a variant line takes the fresh variant price, not item.price", () => {
  const menu = [{ ...chai, variants: [{ _id: "lg", name: "Large", price: 9 }] }];
  const cart = { k: line({ key: "k", variant: { variantId: "lg", name: "Large", price: 8 }, unitPrice: 8 }) };
  assert.equal(repriceCart(cart, menu).k.unitPrice, 9);
  // A variant gone from the menu keeps the price it was added at.
  assert.equal(repriceCart(cart, [chai]).k.unitPrice, 8);
});

test("an unchanged cart is returned as the same object (no re-render loop)", () => {
  const cart = { chai: line({ unitPrice: 6 }) };
  assert.equal(repriceCart(cart, [chai]), cart);
});

test("a line whose item left the menu keeps its price", () => {
  const cart = { chai: line() };
  const out = repriceCart(cart, [{ _id: "other", price: 1 }]);
  assert.equal(out, cart);
  assert.equal(out.chai.unitPrice, 4);
});

test("OrderOnline re-prices the held cart from every menu refresh", () => {
  const page = fs.readFileSync(new URL("../src/pages/OrderOnline.jsx", import.meta.url), "utf8");
  assert.match(page, /import \{ repriceCart \} from "\.\.\/utils\/qrCart"/);
  assert.match(page, /useEffect\(\(\) => setCart\(\(c\) => repriceCart\(c, flatMenu\)\), \[flatMenu\]\)/);
});
