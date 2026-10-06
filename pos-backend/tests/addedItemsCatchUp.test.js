/**
 * Dishes a diner adds to a table mid-meal, as the till sees them.
 *
 * The Added Items card only ever came from a live socket event, so a till
 * that was closed or reloading never saw it. "pending" also meant two things
 * (not cooked yet / waiting for review), so accepting a new QR order left its
 * lines pending and the next Cancel All could void served food.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const mongoose = require("mongoose");

const { itemsAddedPayload } = require("../services/socket");

const RID = new mongoose.Types.ObjectId().toString();
const ORDER_ID = new mongoose.Types.ObjectId().toString();
const TABLE_ID = new mongoose.Types.ObjectId().toString();
const user = { _id: "u1", role: "Owner", restaurantId: RID, name: "Asha" };

/** Runs `fn` with onlineOrderController loaded over fakes; the fakes stay on for the lazy requires. */
const withController = async ({ order = null, found = [], session = null }, fn) => {
  const seen = { filter: null, kitchenRounds: [], released: [], sessionEvents: [], tableLookups: [] };
  const fakes = {
    "../models/orderModel": {
      findOne: async () => order,
      find: (filter) => {
        seen.filter = filter;
        const q = { sort: () => q, limit: () => q, populate: async () => found };
        return q;
      },
    },
    "../models/tableModel": {
      findById: (id) => {
        seen.tableLookups.push(String(id));
        const q = { select: () => q, lean: async () => ({ _id: id, tableNumber: 7, displayId: "T7" }) };
        return q;
      },
    },
    "../models/tableSessionModel": { findOne: async () => session },
    "./tableSessionController": {
      recalculateSessionBill: async (s) => s,
      releaseSessionForCancelledOrder: async (o, actor) => { seen.released.push([String(o._id), actor]); return null; },
    },
    "../services/socket": {
      itemsAddedPayload,
      orderCreatedPayload: () => ({}),
      emitOrderStatusChanged: () => {},
      emitTableSessionUpdated: (e) => seen.sessionEvents.push(e),
      emitToRestaurant: () => {},
      emitKitchenRound: (e) => seen.kitchenRounds.push(e),
    },
    "../services/tenantContext": { resolveTenantFromUser: async () => ({ restaurantId: RID }) },
    "../services/autoReadyService": {
      clocksOnAccept: async () => ({ prepStartAt: null, readyDueAt: new Date(), completeDueAt: null }),
      prepDuePayload: (o) => o,
      reopenForNewRound: async (o) => o,
    },
    "../services/orderCharge": { fireOrderChargeReversal: () => {} },
  };
  const orig = Module._load;
  Module._load = function (r) {
    if (Object.prototype.hasOwnProperty.call(fakes, r)) return fakes[r];
    return orig.apply(this, arguments);
  };
  const path = require.resolve("../controllers/onlineOrderController");
  delete require.cache[path];
  try {
    return await fn(require(path), seen);
  } finally {
    Module._load = orig;
    delete require.cache[path];
  }
};

const call = async (fn, req) => {
  let err = null;
  let body = null;
  const res = { status() { return res; }, json(b) { body = b; return res; } };
  await fn(req, res, (e) => { err = e; });
  return { err, body };
};

const tableOrder = (items, extra = {}) => ({
  _id: ORDER_ID,
  restaurantId: RID,
  outletId: null,
  table: TABLE_ID,
  tableSessionId: "s1",
  source: "QR",
  orderType: "dine-in",
  orderStatus: "In Progress",
  items,
  bills: { subtotal: 0, tax: 0, totalWithTax: 0 },
  timeline: [],
  async save() { return this; },
  ...extra,
});

test("REGRESSION: a till that reloads still gets the Added Items card", async () => {
  const order = tableOrder([
    { _id: "a1", name: "Biryani", quantity: 1, total: 250, status: "preparing" },
    { _id: "a2", name: "Kebab", quantity: 2, total: 300, status: "pending", modifiers: [{ name: "Extra mint", price: 0 }] },
  ], { table: { _id: TABLE_ID, tableNumber: 7, displayId: "T7" } });

  await withController({ found: [order] }, async ({ listPendingAdditions }, seen) => {
    const { err, body } = await call(listPendingAdditions, { user });
    assert.equal(err, null, err && err.message);
    assert.equal(String(seen.filter.restaurantId), RID, "tenant scoped");
    assert.equal(seen.filter["items.status"], "pending");
    assert.deepEqual(seen.filter.tableSessionId, { $ne: null });
    // An undecided QR order belongs to the New Order card, not this one.
    assert.deepEqual(seen.filter.$nor, [{ source: "QR", orderStatus: "Preparing" }]);

    const [card] = body.data;
    assert.equal(card.orderId, ORDER_ID);
    assert.equal(card.displayId, "T7");
    assert.deepEqual(card.pendingItems.map((i) => i._id), ["a2"], "only the dish nobody has reviewed");
    assert.equal(card.addedCount, 1);
  });
});

test("REGRESSION: accepting a new QR order moves its lines out of pending, so Cancel All cannot reach them", async () => {
  const order = tableOrder([
    { _id: "a1", name: "Biryani", quantity: 1, total: 250, status: "pending" },
    { _id: "a2", name: "Water", quantity: 1, total: 20, status: "pending" },
  ], { orderStatus: "Preparing" });
  const session = {
    status: "OCCUPIED",
    items: [
      { name: "Biryani", kdsItemId: "a1", status: "pending" },
      { name: "Water", kdsItemId: "a2", status: "pending" },
    ],
  };

  await withController({ order, session }, async ({ updateOnlineOrderStatus, resolveAddedItems }, seen) => {
    const accepted = await call(updateOnlineOrderStatus, { user, params: { id: ORDER_ID }, body: { action: "accept" } });
    assert.equal(accepted.err, null, accepted.err && accepted.err.message);
    assert.equal(order.orderStatus, "In Progress");
    assert.deepEqual(order.items.map((i) => i.status), ["preparing", "preparing"]);
    // The diner's page and Manage Tables read the session.
    assert.deepEqual(session.items.map((i) => i.status), ["preparing", "preparing"]);
    assert.equal(seen.sessionEvents.length, 1);

    const cancelAll = await call(resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "reject" } });
    assert.equal(cancelAll.err?.status, 409, "nothing is waiting for review");
    assert.deepEqual(order.items.map((i) => i.status), ["preparing", "preparing"], "served food is untouched");
  });
});

test("accepting added dishes sends the kitchen a ticket for just those dishes, with the table", async () => {
  const order = tableOrder([
    { _id: "a1", name: "Biryani", quantity: 1, total: 250, status: "preparing" },
    { _id: "a2", name: "Kebab", quantity: 1, total: 300, status: "pending" },
  ]);

  await withController({ order }, async ({ resolveAddedItems }, seen) => {
    const { err } = await call(resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "accept" } });
    assert.equal(err, null, err && err.message);
    assert.equal(seen.kitchenRounds.length, 1);
    assert.deepEqual(seen.kitchenRounds[0].items.map((i) => i._id), ["a2"]);
    assert.equal(seen.kitchenRounds[0].table.displayId, "T7");
    assert.equal(order.table, TABLE_ID, "order.table stays the id the session event is addressed by");
  });
});

test("REGRESSION: declining the last dishes on a table's order frees the table", async () => {
  const order = tableOrder([
    { _id: "a1", name: "Kebab", quantity: 1, total: 300, status: "pending" },
  ], { orderStatus: "Preparing", source: "POS" });

  await withController({ order }, async ({ resolveAddedItems }, seen) => {
    const { err } = await call(resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "reject" } });
    assert.equal(err, null, err && err.message);
    assert.equal(order.orderStatus, "Cancelled");
    assert.deepEqual(seen.released, [[ORDER_ID, "Asha"]]);
    assert.equal(seen.kitchenRounds.length, 0, "a declined dish is never sent to the kitchen");
  });
});

test("REGRESSION: a delivery paid at the till cannot be cancelled through the online-order status route", async () => {
  // It used to be created Completed, which this route refused. It now starts
  // Preparing, so any staff token could cancel a cash sale with no reason.
  const order = tableOrder([{ _id: "a1", name: "Thali", quantity: 1, total: 600, status: "preparing" }], {
    source: "POS", orderType: "delivery", orderStatus: "Preparing", table: null, tableSessionId: null,
    payments: [{ method: "cash", amount: 600, status: "paid" }],
  });
  await withController({ order }, async ({ updateOnlineOrderStatus }) => {
    const staff = { ...user, role: "Staff" };
    for (const action of ["cancel", "reject"]) {
      const { err } = await call(updateOnlineOrderStatus, { user: staff, params: { id: ORDER_ID }, body: { action } });
      assert.equal(err?.status, 409, action);
    }
    assert.equal(order.orderStatus, "Preparing");
    assert.equal(order.items[0].status, "preparing");
  });

  // A prepaid website order still waiting to be accepted may be turned down.
  const waiting = tableOrder([{ _id: "a1", name: "Thali", quantity: 1, total: 600, status: "pending" }], {
    source: "WEBSITE", orderStatus: "Pending", table: null, tableSessionId: null,
    payments: [{ method: "online", amount: 600, status: "paid" }],
  });
  await withController({ order: waiting }, async ({ updateOnlineOrderStatus }) => {
    const { err } = await call(updateOnlineOrderStatus, { user, params: { id: ORDER_ID }, body: { action: "reject" } });
    assert.equal(err, null, err && err.message);
    assert.equal(waiting.orderStatus, "Cancelled");
  });
});

test("REGRESSION: Cancel entire order on the Added Items card needs the Security PIN from staff", async () => {
  const order = tableOrder([
    { _id: "a1", name: "Biryani", quantity: 1, total: 1200, status: "preparing" },
    { _id: "a2", name: "Lassi", quantity: 1, total: 50, status: "pending" },
  ]);
  await withController({ order }, async ({ resolveAddedItems }, seen) => {
    const staff = { ...user, role: "Staff" };
    const { err } = await call(resolveAddedItems, { user: staff, headers: {}, params: { id: ORDER_ID }, body: { action: "cancel_order" } });
    assert.equal(err?.status, 403);
    assert.equal(err?.code, "PIN_REQUIRED");
    assert.deepEqual(order.items.map((i) => i.status), ["preparing", "pending"], "nothing voided");
    assert.deepEqual(seen.released, [], "the table stays open");

    // The owner never needs the PIN.
    const owner = await call(resolveAddedItems, { user, headers: {}, params: { id: ORDER_ID }, body: { action: "cancel_order" } });
    assert.equal(owner.err, null, owner.err && owner.err.message);
    assert.equal(order.orderStatus, "Cancelled");
  });
});
