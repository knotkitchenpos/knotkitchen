import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const { default: cart, addItems } = await import("../src/redux/slices/cartSlice.js");
const { setOrderType } = await import("../src/redux/slices/orderTypeSlice.js");
const panel = fs.readFileSync(new URL("../src/components/pos/ProductPanel.jsx", import.meta.url), "utf8");

test("switching the order type reprices cart lines from their channel prices", () => {
  let state = cart(undefined, addItems({
    id: 1, menuItemId: "m", pricePerQuantity: 100, price: 200, quantity: 2,
    modifiers: [{ price: 10, quantity: 1 }],
    channelBase: { Collection: 90, Delivery: 120, "Table Service": 150 },
  }));
  state = cart(state, setOrderType("Delivery"));
  assert.equal(state[0].pricePerQuantity, 130);
  assert.equal(state[0].price, 260);
});

test("a line with no channel prices (a variant) keeps its price", () => {
  let state = cart(undefined, addItems({ id: 2, menuItemId: "v", pricePerQuantity: 80, price: 80, quantity: 1, channelBase: null }));
  state = cart(state, setOrderType("Table Service"));
  assert.equal(state[0].price, 80);
});

test("ProductPanel stamps channel prices on non-variant lines and uses the store clock", () => {
  assert.match(panel, /channelBase: variantObj \? null : channelBase\(customizingItem\)/);
  assert.match(panel, /channelBase: variant \? null : channelBase\(item\)/);
  // Schedules and timed prices must not read the device's hours or weekday.
  assert.ok(!/getHours\(\)|getDay\(\)/.test(panel), "ProductPanel still reads the device clock");
  assert.match(panel, /import \{[^}]*storeClock[^}]*\} from "\.\.\/\.\.\/utils";/);
});
