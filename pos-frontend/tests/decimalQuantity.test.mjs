import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

/**
 * A weighed dish: 1.80 kg must show and stay 1.80 (owner, 2026-10-16).
 * The till had no way to type a quantity, rounded a price of 1.80 to "₹2" on
 * the product card, and every bill floored a stored 1.8 to "1 x".
 */

const { default: cart, addItems, updateQuantity } = await import("../src/redux/slices/cartSlice.js");
const { formatQty, resolveItemAmounts, toOrderItems, typedQty } = await import("../src/utils/orderItems.js");
const { layoutKot, layoutReceipt } = await import("../src/utils/receiptLayout.js");
const SRC = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const line = (unit) => cart(undefined, addItems({ id: 1, menuItemId: "m", pricePerQuantity: unit, price: unit, quantity: 1 }));

test("the cart keeps 1.8 exactly, and each line to the paisa", () => {
  let state = cart(line(200), updateQuantity({ id: 1, quantity: 1.8 }));
  assert.equal(state[0].quantity, 1.8);
  assert.equal(state[0].price, 360);
  state = cart(state, updateQuantity({ id: 1, quantity: state[0].quantity + 1 }));
  state = cart(state, updateQuantity({ id: 1, quantity: state[0].quantity - 1 }));
  assert.equal(state[0].quantity, 1.8, "+ then - lands back on 1.8, not 1.7999999999999998");
  assert.equal(cart(line(333.33), updateQuantity({ id: 1, quantity: 1.8 }))[0].price, 599.99);
});

test("a typed quantity is read as typed; nonsense is refused", () => {
  assert.equal(typedQty("1.80"), 1.8);
  assert.equal(typedQty(" 2 "), 2);
  assert.equal(typedQty("0.375"), 0.375);
  for (const t of ["", "0", "0.000", "abc", "1.2345", "-1", "1000", "1,5"]) assert.equal(typedQty(t), null, t);
});

test("the order posts 0.8 and 1.8 as they are, and shows 1.80", () => {
  const [o] = toOrderItems([{ quantity: 0.8, pricePerQuantity: 200, price: 160 }]);
  assert.equal(o.quantity, 0.8);
  assert.equal(o.price, 200);
  assert.equal(o.total, 160);
  assert.deepEqual(resolveItemAmounts({ quantity: 1.8, price: 200, total: 360 }), { quantity: 1.8, unitPrice: 200, lineTotal: 360 });
  assert.equal(resolveItemAmounts({ quantity: "abc", price: 150, total: 0 }).quantity, 1);
  assert.equal(formatQty(1.8), "1.80");
  assert.equal(formatQty(2), "2");
  assert.equal(formatQty(0), "0", "an empty cart counts 0, not 1");
});

test("the bill and the kitchen ticket print 1.80, not 1", () => {
  const measure = (t) => String(t).length * 7;
  const order = { orderType: "collection", items: [{ name: "Mutton", quantity: 1.8, price: 200, total: 360 }], bills: { subtotal: 360, totalWithTax: 360 } };
  const texts = (l) => l.ops.filter((o) => o.type === "text").map((o) => o.text);
  const bill = texts(layoutReceipt({ order, store: { name: "S" }, paper: 80, measure }));
  for (const t of ["1.80", "200.00", "360.00"]) assert.ok(bill.includes(t), `bill shows ${t}: ${bill.join(" | ")}`);
  assert.ok(!bill.includes("1"), "no floored quantity");
  const kot = texts(layoutKot({ order, store: { name: "S" }, paper: 80, measure }));
  assert.ok(kot.includes("1.80 x"), kot.join(" | "));
});

test("SOURCE: the product card shows paise, the price box steps by paise, the ⚙ dialog takes a quantity", () => {
  const panel = SRC("src/components/pos/ProductPanel.jsx");
  assert.ok(!/toFixed\(0\)/.test(panel), "a 1.80 price must not read ₹2");
  assert.equal((panel.match(/\{cardPrice\(price\)\}/g) || []).length, 2);
  const drawer = SRC("src/components/dashboard/manageMenu/ProductDrawer.jsx");
  assert.equal((drawer.match(/type="number"\s+min=\{0\}\s+step="0\.01"/g) || []).length, 4);
  const order = SRC("src/components/pos/OrderPanel.jsx");
  assert.match(order, /dispatch\(updateQuantity\(\{ id: noteFor\.id, quantity: typedQty\(qtyText\) \}\)\)/);
  assert.match(order, /inputMode="decimal"/);
});

test("SOURCE: the guest's table page, held orders and Reports print 1.80, never a raw float sum", () => {
  const guest = SRC("src/pages/OrderOnline.jsx");
  assert.match(guest, /× \{formatQty\(it\.quantity\)\}/);
  assert.match(guest, /sessionItemCount = formatQty\(/, "1.8 + 1.1 must not read 2.9000000000000004 item(s)");
  assert.match(SRC("src/components/pos/OrderPanel.jsx"), /\{formatQty\(itemCount\)\} item/);
  const reports = SRC("src/pages/Reports.jsx");
  assert.equal((reports.match(/r\.quantity === "" \? "" : formatQty\(r\.quantity\)/g) || []).length, 2);
  assert.equal(formatQty(1.8 + 1.1), "2.90");
});
