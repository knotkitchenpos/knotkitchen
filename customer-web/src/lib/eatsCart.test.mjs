import test from "node:test";
import assert from "node:assert/strict";
import { clearCartFor, getActiveCart, guardCart } from "./eatsCart.js";
import { addRecentOrder, recentOrders } from "./eatsOrders.js";

// A Map-backed localStorage, as the browser's.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const fakeCart = (storeId) => ({
  added: [],
  addItem(line) {
    this.added.push(line);
    const lines = JSON.parse(store.get(`kk_cart_v1:${storeId}`) || "[]");
    store.set(`kk_cart_v1:${storeId}`, JSON.stringify([...lines, { ...line, quantity: 1 }]));
  },
});

test("one basket at a time: another store's dish asks first", async () => {
  store.clear();
  const a = fakeCart("111111");
  guardCart(a, { storeId: "111111", name: "A" }, () => assert.fail("same store never asks")).addItem({ itemId: "x" });
  assert.deepEqual(getActiveCart(), { storeId: "111111", name: "A", count: 1 });

  // Declined: B's dish is dropped, A's basket stays.
  const b = fakeCart("222222");
  let asked = null;
  guardCart(b, { storeId: "222222", name: "B" }, (active) => ((asked = active), false)).addItem({ itemId: "y" });
  await new Promise((r) => setTimeout(r));
  assert.equal(asked.name, "A");
  assert.equal(b.added.length, 0);
  assert.equal(getActiveCart().storeId, "111111");

  // Accepted: A is emptied, B holds the basket.
  guardCart(b, { storeId: "222222", name: "B" }, () => Promise.resolve(true)).addItem({ itemId: "y" });
  await new Promise((r) => setTimeout(r));
  assert.equal(store.has("kk_cart_v1:111111"), false);
  assert.deepEqual(getActiveCart(), { storeId: "222222", name: "B", count: 1 });

  clearCartFor("222222");
  assert.equal(getActiveCart(), null);
});

test("recent orders: newest first, no duplicates, at most 10; a known one is filled in place", () => {
  store.clear();
  for (let i = 0; i < 12; i++) addRecentOrder({ token: `v_${i}`, orderNumber: `W-${i}` });
  let list = recentOrders();
  assert.equal(list.length, 10);
  assert.equal(list[0].token, "v_11");
  // Checkout confirmed before the store name loaded; the order page fills it.
  addRecentOrder({ token: "v_5", storeName: "Test Kitchen", orderNumber: "" });
  list = recentOrders();
  assert.equal(list.length, 10);
  assert.equal(list[6].token, "v_5", "keeps its place");
  assert.equal(list[6].storeName, "Test Kitchen");
  assert.equal(list[6].orderNumber, "W-5", "an empty field never wipes a known one");
  assert.equal(list.filter((o) => o.token === "v_5").length, 1);
  addRecentOrder({ token: "" });
  assert.equal(recentOrders().length, 10);
});
