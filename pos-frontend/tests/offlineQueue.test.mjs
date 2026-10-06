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

const { enqueueOrder, readQueue, removeFromQueue, localOrderView, isNetworkError, markRejected, newLocalId } = await import("../src/utils/offlineQueue.js");

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

test("offline numbers never repeat, even after earlier orders sync", () => {
  // The first test left OFF-002 queued.
  const c = enqueueOrder({ items: [] });
  assert.equal(c.localNumber, "OFF-003");
  removeFromQueue(readQueue().map((e) => e.localId));
  assert.equal(enqueueOrder({ items: [] }).localNumber, "OFF-004");
});

test("the live attempt's id is the queued order's id, so a lost reply is not saved twice", () => {
  const id = newLocalId();
  assert.equal(enqueueOrder({ items: [] }, id).localId, id);
});

test("a refused order stays on the device with the reason, and warns only once", () => {
  const a = enqueueOrder({ items: [{ name: "Tea", quantity: 1 }], paymentMethod: "Cash" });
  const fresh = markRejected([{ localId: a.localId, error: "Collection orders are currently disabled" }]);
  assert.deepEqual(fresh.map((e) => e.localId), [a.localId]);
  const kept = readQueue().find((e) => e.localId === a.localId);
  assert.equal(kept.error, "Collection orders are currently disabled");
  assert.ok(kept.failedAt);
  assert.deepEqual(markRejected([{ localId: a.localId, error: "still disabled" }]), []);
  assert.equal(readQueue().find((e) => e.localId === a.localId).error, "still disabled");
});

test("the sync hook never deletes refused orders; staff discard them from the banner", async () => {
  const fs = await import("node:fs");
  const hook = fs.readFileSync(new URL("../src/hooks/useOfflineQueue.js", import.meta.url), "utf8");
  assert.doesNotMatch(hook, /removeFromQueue\(rejected/);
  assert.match(hook, /markRejected\(failedOrders\)/);
  assert.match(hook, /window\.confirm\(/);
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /rejected=\{offline\.rejected\}/);
  assert.match(app, /onDiscard=\{offline\.discard\}/);
});
