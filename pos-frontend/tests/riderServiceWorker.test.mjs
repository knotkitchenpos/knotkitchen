// The Rider app's service worker (rider/public/rider-sw.js), run against a
// fake browser: a new delivery's notification carries Accept / Decline, and
// tapping one answers it through the API with the rider's own session.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = fs.readFileSync(new URL("../rider/public/rider-sw.js", import.meta.url), "utf8");

const load = ({ fetchReply = { ok: true, body: { data: { delivery: { orderNumber: "10482" } } } } } = {}) => {
  const handlers = {};
  const shown = [];
  const fetched = [];
  const posted = [];
  const self = {
    location: { origin: "https://knotkitchen.com" },
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: () => {},
    registration: { showNotification: async (title, opts) => shown.push({ title, ...opts }) },
    clients: {
      matchAll: async () => [{ url: "https://knotkitchen.com/rider/", postMessage: (m) => posted.push(m), focus: async () => {} }],
      openWindow: async () => {},
      claim: async () => {},
    },
  };
  const fetchFn = async (url, opts) => {
    fetched.push({ url, ...opts });
    return { ok: fetchReply.ok, json: async () => fetchReply.body };
  };
  new Function("self", "fetch", "caches", "atob", SRC)(self, fetchFn, {}, globalThis.atob);
  const fire = async (type, event) => {
    const waits = [];
    handlers[type]({ ...event, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  return { fire, shown, fetched, posted };
};

const push = (data) => ({ data: { json: () => data, text: () => JSON.stringify(data) } });
const note = (data, action = "") => ({ action, notification: { data, close: () => {} } });
const ID = "64b0000000000000000000aa";

test("a new delivery's notification stays up with Accept and Decline on it", async () => {
  const sw = load();
  await sw.fire("push", push({ title: "New Delivery Assigned 🚴", body: "Order #10482", url: `/rider/delivery/${ID}`, tag: `order-${ID}`, orderId: ID }));
  const n = sw.shown[0];
  assert.equal(n.requireInteraction, true);
  assert.deepEqual(n.actions.map((a) => a.action), ["accept", "decline"]);
  assert.equal(n.data.orderId, ID);
});

test("any other notification has no buttons and doesn't stay up", async () => {
  const sw = load();
  await sw.fire("push", push({ title: "Order cancelled ✖", body: "…", url: "/rider/" }));
  assert.equal(sw.shown[0].actions, undefined);
  assert.equal(sw.shown[0].requireInteraction, false);
});

test("Accept on the notification accepts through the API and says so", async () => {
  const sw = load();
  await sw.fire("notificationclick", note({ orderId: ID, url: `/rider/delivery/${ID}` }, "accept"));
  assert.equal(sw.fetched[0].url, `/rider/api/deliveries/${ID}/accept`);
  assert.equal(sw.fetched[0].method, "POST");
  assert.equal(sw.fetched[0].credentials, "include");
  assert.match(sw.shown[0].title, /Accepted order #10482/);
  assert.equal(sw.posted[0].type, "rider-push", "an open app refreshes");
});

test("Decline on the notification declines with a reason", async () => {
  const sw = load();
  await sw.fire("notificationclick", note({ orderId: ID }, "decline"));
  assert.equal(sw.fetched[0].url, `/rider/api/deliveries/${ID}/reject`);
  assert.deepEqual(JSON.parse(sw.fetched[0].body), { reason: "Not available" });
  assert.match(sw.shown[0].title, /Declined order/);
});

test("a refused answer (taken back, cancelled, signed out) says why", async () => {
  const sw = load({ fetchReply: { ok: false, body: { message: "This delivery isn't assigned to you any more." } } });
  await sw.fire("notificationclick", note({ orderId: ID }, "accept"));
  assert.equal(sw.shown[0].title, "Couldn't accept");
  assert.match(sw.shown[0].body, /isn't assigned to you/);
});

test("an id from the notification can't reach any other API path", async () => {
  const sw = load();
  await sw.fire("notificationclick", note({ orderId: "../../me/pin" }, "accept"));
  assert.match(sw.fetched[0].url, /^\/rider\/api\/deliveries\/[a-f0-9]*\/accept$/);
});
