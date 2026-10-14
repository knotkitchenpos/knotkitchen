// Orders flow: Mark Ready before Accept, paid takeaways, the store's midnight, offline sales.
process.env.TZ = "UTC";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const sift = require("sift").default;
const { runAddOrder, runUpdateOrder, gstWith } = require("./addOrderHarness");

const withFakes = (fakes, rel) => {
  const orig = Module._load;
  Module._load = function (r) { return Object.prototype.hasOwnProperty.call(fakes, r) ? fakes[r] : orig.apply(this, arguments); };
  const p = require.resolve(rel);
  delete require.cache[p];
  return { mod: require(p), restore: () => { Module._load = orig; delete require.cache[p]; } };
};
const res = () => { const r = { status() { return r; }, json() { return r; } }; return r; };

test("REGRESSION N020: Mark Ready refuses a table order nobody accepted, not one with an addition under review", async () => {
  const mocks = { "../services/readyNotificationService": { notifyOrderReady: async () => ({ sent: false }) } };
  const undecided = { tableSessionId: "s1", source: "QR", orderType: "dine-in", orderStatus: "Preparing", items: [{ name: "Naan", status: "pending" }] };
  const out = await runUpdateOrder({ order: undecided, handler: "markOrderReady", mocks });
  assert.equal(out.error?.status, 409);
  assert.equal(out.saves, 0);
  const mixed = { ...undecided, orderStatus: "In Progress", items: [{ name: "Naan", status: "preparing" }, { name: "Kulfi", status: "pending" }] };
  const ok = await runUpdateOrder({ order: mixed, handler: "markOrderReady", mocks });
  assert.equal(ok.status, 200, ok.error?.message);
});

test("REGRESSION N020: Mark Ready refuses a website order still waiting for Accept", async () => {
  const mocks = { "../services/readyNotificationService": { notifyOrderReady: async () => ({ sent: false }) } };
  const waiting = { source: "WEBSITE", orderType: "collection", orderStatus: "Pending", items: [{ name: "Biryani", status: "pending" }] };
  const out = await runUpdateOrder({ order: waiting, handler: "markOrderReady", mocks });
  assert.equal(out.error?.status, 409);
  assert.equal(out.error?.message, "Accept this order first.");
  assert.equal(out.saves, 0);
  const accepted = { ...waiting, orderStatus: "In Progress", items: [{ name: "Biryani", status: "preparing" }] };
  const ok = await runUpdateOrder({ order: accepted, handler: "markOrderReady", mocks });
  assert.equal(ok.status, 200, ok.error?.message);
});

test("REGRESSION S13: a sale synced from the offline queue is born isOffline, so its announcement already says so", async () => {
  const emitted = [];
  const mocks = {
    "../services/gst": gstWith({ applicable: false, rate: 0, percent: 0, inclusive: false }),
    "../services/socket": { emitOrderCreated: (a) => emitted.push(a), emitOrderStatusChanged: () => {} },
  };
  const body = { orderType: "collection", paymentMethod: "cash", bills: { subtotal: 100, total: 100, tax: 0, totalWithTax: 100 } };
  const synced = await runAddOrder({ body, idempotencyKey: "offline:abc123", mocks });
  assert.equal(synced.status, 201, synced.error && synced.error.message);
  assert.equal(synced.saved[0].isOffline, true);
  assert.equal(emitted[0].order.data.isOffline, true, "the tills learn it was taken offline from the first emit");
  const live = await runAddOrder({ body, mocks });
  assert.equal(live.status, 201, live.error && live.error.message);
  assert.equal(live.saved[0].isOffline, false);
});

test("REGRESSION O1: a synced sale keeps the till's 'KOT printed' flag, so the kitchen device does not print it twice; a live sale cannot set it", async () => {
  const mocks = {
    "../services/gst": gstWith({ applicable: false, rate: 0, percent: 0, inclusive: false }),
    "../services/socket": { emitOrderCreated: () => {}, emitOrderStatusChanged: () => {} },
  };
  const body = { orderType: "collection", paymentMethod: "cash", kotPrinted: true, bills: { subtotal: 100, total: 100, tax: 0, totalWithTax: 100 } };
  const synced = await runAddOrder({ body, idempotencyKey: "offline:k1", mocks });
  assert.equal(synced.saved[0].kotPrinted, true);
  const unprinted = await runAddOrder({ body: { ...body, kotPrinted: undefined }, idempotencyKey: "offline:k2", mocks });
  assert.ok(!unprinted.saved[0].kotPrinted, "the kitchen device prints this one on the sync");
  const live = await runAddOrder({ body, mocks });
  assert.ok(!live.saved[0].kotPrinted);
});

test("REGRESSION N019: Today keeps an order still on the floor from before the store's midnight", async () => {
  let filter = null;
  const { mod, restore } = withFakes({
    "../models/orderModel": { find: (f) => { filter = f; const q = { sort: () => q, limit: () => q, populate: async () => [] }; return q; } },
  }, "../controllers/orderController");
  try {
    await mod.getOrders({ user: { _id: "u", restaurantId: "r1" }, query: {} }, res(), (e) => { throw e; });
    const w = mod.buildDateWindow({});
    const base = { restaurantId: "r1", isDeleted: false, createdAt: new Date(w.start.getTime() - 10 * 60 * 1000) };
    const m = sift(filter);
    assert.equal(m({ ...base, orderStatus: "Preparing" }), true, "a table still eating at 00:10");
    assert.equal(m({ ...base, orderStatus: "Completed" }), false, "yesterday's finished order stays on yesterday");
    await mod.getOrders({ user: { _id: "u", restaurantId: "r1" }, query: { date: "2026-10-12" } }, res(), (e) => { throw e; });
    assert.equal(filter.$or, undefined, "a picked day is exactly that day");
  } finally { restore(); }
});

test("REGRESSION N018: Auto Ready stamps a takeaway paid at the till ready and keeps the sale Completed", async () => {
  const past = new Date(Date.now() - 60_000);
  const mk = (extra) => ({ _id: Math.random().toString(16).slice(2), restaurantId: "r1", source: "POS", orderType: "collection", isDeleted: false,
    readyDueAt: past, readyAt: null, timeline: [], async save() { return this; }, ...extra });
  const unpaid = mk({ orderStatus: "Preparing" });
  const paid = mk({ orderStatus: "Completed" });
  const settledTable = mk({ orderStatus: "paid", orderType: "dine-in" });
  // REGRESSION: the live code stamped readyDueAt on every till sale, so paid takeaways from before this deploy are all
  // "due"; and a sale synced from the offline queue gets a clock from its sync. Neither may text the customer now.
  const backlog = mk({ orderStatus: "Completed", readyDueAt: new Date(Date.now() - 3 * 86400e3) });
  const synced = mk({ orderStatus: "Completed", isOffline: true });
  const { mod, restore } = withFakes({
    "../models/orderModel": {
      find: (q) => { const m = sift(q); const docs = [unpaid, paid, settledTable, backlog, synced].filter((o) => m(o)); return { sort: () => ({ limit: async () => docs }) }; },
      updateOne: async () => ({ modifiedCount: 1 }),
    },
    "../models/websiteSettingsModel": { findOne: () => ({ select: async () => ({ ordering: { autoReadyEnabled: true, autoReadyMinutes: { collection: 20 } } }) }) },
    "./readyNotificationService": { notifyOrderReady: async () => ({}) },
    "./eBillService": { fireAutoEBill: () => {} },
    "./orderCharge": { fireOrderCharge: () => {} },
  }, "../services/autoReadyService");
  try { await mod.runAutoReadyTick(); } finally { restore(); }
  assert.equal(unpaid.orderStatus, "Ready");
  assert.equal(paid.orderStatus, "Completed");
  assert.ok(paid.readyAt instanceof Date, "the paid takeaway is ready, not stuck");
  assert.equal(settledTable.readyAt, null);
  assert.equal(backlog.readyAt, null, "days-old backlog is left alone");
  assert.equal(synced.readyAt, null, "an offline sale was handed over when it was taken");
});
