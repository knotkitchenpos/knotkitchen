import test from "node:test";
import assert from "node:assert";

// A localStorage for node, so the queue helpers run as they do in the till.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class {};

const { enqueueOrder, readQueue, removeFromQueue, localOrderView, isNetworkError } = await import("../src/utils/offlineQueue.js");

test("orders queue with a local id and number, and come off once synced", () => {
  const a = enqueueOrder({ items: [{ name: "Tea", quantity: 2 }], paymentMethod: "Cash" });
  const b = enqueueOrder({ items: [{ name: "Coffee", quantity: 1 }] });
  assert.equal(readQueue().length, 2);
  assert.equal(a.localNumber, "OFF-001");
  assert.equal(b.localNumber, "OFF-002");
  assert.notEqual(a.localId, b.localId);
  const view = localOrderView(a);
  assert.equal(view.orderNumber, "OFF-001");
  assert.equal(view.orderStatus, "Completed");
  assert.equal(localOrderView(b).orderStatus, "Preparing");
  assert.equal(view.offline, true);
  removeFromQueue([a.localId]);
  assert.deepEqual(readQueue().map((e) => e.localId), [b.localId]);
});

test("only a network failure is treated as offline; a 4xx is a real error", () => {
  assert.equal(isNetworkError({ code: "ERR_NETWORK" }), true);
  assert.equal(isNetworkError({ message: "Network Error" }), true);
  assert.equal(isNetworkError({ response: { status: 400 } }), false);
  assert.equal(isNetworkError(null), false);
});
