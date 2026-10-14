/**
 * D4 (owner, 2026-10-13): a customer's order -- table QR, website, Knot Eats --
 * reaches the kitchen printer when staff ACCEPT it, never before, and a
 * declined order prints nothing. The tills print on `onlineOrder:accepted`
 * (the whole order, then its Auto Receipt) or, for dishes accepted onto a
 * ticket the kitchen already has, on `kitchen:round` (ADDED ITEMS).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const sift = require("sift").default;

const RID = "6a00000000000000000000aa";
const ORDER_ID = "6a0000000000000000000001";
const TABLE_ID = "6a0000000000000000000101";
const user = { _id: "u1", role: "Owner", restaurantId: RID, name: "Asha" };

const withController = async ({ order = null, session = null, found = [] }, fn) => {
  const seen = { accepted: [], rounds: [], filter: null };
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
        const q = { select: () => q, lean: async () => ({ _id: id, tableNumber: 7, displayId: "T7", tableName: "" }) };
        return q;
      },
    },
    "../models/tableSessionModel": { findOne: async () => session },
    "./tableSessionController": {
      recalculateSessionBill: async (s) => s,
      releaseSessionForCancelledOrder: async () => null,
    },
    "../services/socket": {
      orderCreatedPayload: require("../services/socket").orderCreatedPayload,
      itemsAddedPayload: () => ({}),
      emitOrderStatusChanged: () => {},
      emitTableSessionUpdated: () => {},
      emitToRestaurant: () => {},
      emitKitchenRound: (e) => seen.rounds.push(e),
      emitOrderAccepted: (e) => seen.accepted.push(e),
    },
    "../services/tenantContext": { resolveTenantFromUser: async () => ({ restaurantId: RID }) },
    "../services/autoReadyService": {
      clocksOnAccept: async () => ({ prepStartAt: null, readyDueAt: null, completeDueAt: null }),
      prepDuePayload: (o) => o,
      reopenForNewRound: async (o) => o,
    },
    "../services/orderCharge": { fireOrderChargeReversal: () => {} },
    "../services/refunds": { wasPaid: () => false, refundOnCancel: async () => null },
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

const accept = (mod, action = "accept") => call(mod.updateOnlineOrderStatus, { user, params: { id: ORDER_ID }, body: { action } });

/** A guest's table order nobody has accepted: Preparing, every line pending. */
const guestOrder = (extra = {}) => ({
  _id: ORDER_ID,
  restaurantId: RID,
  outletId: null,
  table: TABLE_ID,
  tableSessionId: "s1",
  source: "QR",
  orderType: "dine-in",
  orderStatus: "Preparing",
  items: [
    { _id: "a1", name: "Naan", quantity: 2, total: 80, status: "pending" },
    { _id: "a2", name: "Lassi", quantity: 1, total: 60, status: "pending" },
  ],
  bills: { subtotal: 140, tax: 0, totalWithTax: 140 },
  payments: [],
  timeline: [],
  async save() { return this; },
  ...extra,
});
const liveSession = () => ({ status: "OCCUPIED", items: [] });

test("D4: accepting a guest's table order prints it once, as a new order with its table", async () => {
  await withController({ order: guestOrder(), session: liveSession() }, async (mod, seen) => {
    const { err } = await accept(mod);
    assert.equal(err, null, err && err.message);
    assert.equal(seen.accepted.length, 1, "one onlineOrder:accepted");
    assert.equal(seen.rounds.length, 0, "not an ADDED ITEMS ticket");
    assert.equal(seen.accepted[0].table.tableNumber, 7, "the table is populated for the ticket");
    assert.equal(String(seen.accepted[0].order._id), ORDER_ID);
  });
});

test("D4: dishes accepted onto a ticket the kitchen already has print as a round, just those dishes", async () => {
  const order = guestOrder({
    orderStatus: "In Progress",
    items: [
      { _id: "a1", name: "Naan", quantity: 2, total: 80, status: "preparing" },
      { _id: "a3", name: "Kulfi", quantity: 1, total: 90, status: "pending" },
    ],
  });
  await withController({ order, session: liveSession() }, async (mod, seen) => {
    const { err } = await accept(mod);
    assert.equal(err, null, err && err.message);
    assert.equal(seen.accepted.length, 0);
    assert.equal(seen.rounds.length, 1);
    assert.deepEqual(seen.rounds[0].items.map((i) => i.name), ["Kulfi"]);
    assert.equal(seen.rounds[0].table.displayId, "T7");
  });
});

test("D4: a declined order prints nothing", async () => {
  for (const action of ["reject", "cancel"]) {
    await withController({ order: guestOrder(), session: liveSession() }, async (mod, seen) => {
      const { err } = await accept(mod, action);
      assert.equal(err, null, err && err.message);
      assert.equal(seen.accepted.length + seen.rounds.length, 0, action);
    });
  }
});

test("D4: a stale Accept on a settled table prints nothing", async () => {
  await withController({ order: guestOrder(), session: { status: "PAID", items: [] } }, async (mod, seen) => {
    await accept(mod);
    assert.equal(seen.accepted.length + seen.rounds.length, 0, "the table was paid: nothing to cook");
  });
  // Added dishes accepted from the catch-up list after the table was settled.
  const order = guestOrder({
    orderStatus: "In Progress",
    items: [
      { _id: "a1", name: "Naan", quantity: 2, total: 80, status: "preparing" },
      { _id: "a3", name: "Kulfi", quantity: 1, total: 90, status: "pending" },
    ],
  });
  await withController({ order, session: { status: "CLOSED", items: [] } }, async (mod, seen) => {
    const { err } = await call(mod.resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "accept" } });
    assert.equal(err, null, err && err.message);
    assert.equal(seen.accepted.length + seen.rounds.length, 0);
  });
});

test("D4: a website or Knot Eats order prints on Accept, to its store too", async () => {
  const order = guestOrder({
    source: "WEBSITE", salesChannel: "KNOT_EATS", storeId: "231146", orderStatus: "Pending",
    orderType: "collection", table: null, tableSessionId: null,
  });
  await withController({ order }, async (mod, seen) => {
    const { err } = await accept(mod);
    assert.equal(err, null, err && err.message);
    assert.equal(seen.accepted.length, 1);
    assert.equal(seen.accepted[0].storeId, "231146");
    assert.equal(seen.accepted[0].table, null);
    // Accepting it again (Preparing) has nothing new for the kitchen.
    await accept(mod, "preparing");
    assert.equal(seen.accepted.length, 1, "printed once");
  });
});

test("a till order is never reprinted by Accept: it printed when it was rung up", async () => {
  const takeaway = guestOrder({ source: "POS", orderType: "collection", table: null, tableSessionId: null });
  await withController({ order: takeaway }, async (mod, seen) => {
    const { err } = await accept(mod);
    assert.equal(err, null, err && err.message);
    assert.equal(seen.accepted.length + seen.rounds.length, 0);
  });
});

test("the New Order catch-up lists a guest's first round on a till-opened table, and Added Items does not", async () => {
  const undecidedOnTillTable = guestOrder({ source: "POS", createdAt: new Date(), restaurantId: RID, isDeleted: false });
  const tillTable = guestOrder({ source: "POS", items: [{ _id: "b1", name: "Thali", status: "preparing" }] });
  const reviewing = guestOrder({ orderStatus: "In Progress", items: [{ _id: "a1", status: "preparing" }, { _id: "a3", status: "pending" }] });
  const website = guestOrder({ source: "WEBSITE", orderStatus: "Pending", table: null, tableSessionId: null });

  await withController({ found: [undecidedOnTillTable] }, async (mod, seen) => {
    const { err, body } = await call(mod.listAwaitingOrders, { user });
    assert.equal(err, null, err && err.message);
    const { createdAt, ...rest } = seen.filter; // the 12 h window is not under test
    assert.ok(createdAt.$gte instanceof Date);
    const awaiting = sift(rest);
    assert.equal(awaiting({ ...undecidedOnTillTable, restaurantId: RID }), true, "an undecided guest order, whatever the table's source");
    assert.equal(awaiting({ ...tillTable, restaurantId: RID }), false, "a till's table order was decided by the till");
    assert.equal(awaiting({ ...reviewing, restaurantId: RID }), false, "an accepted order with an addition is the Added Items card's");
    assert.equal(awaiting({ ...website, restaurantId: RID }), true);
    // The card alerts as a table order: the live event says placedVia QR too.
    assert.equal(body.data[0].placedVia, "QR");
    assert.equal(body.data[0].source, "POS");
  });

  await withController({ found: [] }, async (mod, seen) => {
    await call(mod.listPendingAdditions, { user });
    const additions = sift({ $nor: seen.filter.$nor });
    assert.equal(additions(undecidedOnTillTable), false, "never listed twice");
    assert.equal(additions(reviewing), true);
  });
});

test("emitOrderAccepted sends onlineOrder:accepted to the restaurant, outlet and store rooms", () => {
  const sent = [];
  const fakeIo = { use() {}, on() {}, to: (rooms) => ({ emit: (event, payload) => sent.push({ rooms, event, payload }) }) };
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "socket.io") return { Server: function Server() { return fakeIo; } };
    return orig.apply(this, arguments);
  };
  const path = require.resolve("../services/socket");
  delete require.cache[path];
  let socket;
  try {
    socket = require(path);
  } finally {
    Module._load = orig;
  }
  try {
    socket.initSocket({});
    // A Mongoose document: its fields are read through toObject, not spread.
    const doc = { toObject: () => guestOrder({ storeId: "231146" }) };
    socket.emitOrderAccepted({ restaurantId: RID, outletId: "o1", storeId: "231146", order: doc, table: { _id: TABLE_ID, tableNumber: 7, displayId: "T7", tableName: "" } });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].event, "onlineOrder:accepted");
    assert.deepEqual(sent[0].rooms, [`restaurant:${RID}`, "outlet:o1", "store:231146"]);
    assert.equal(sent[0].payload.orderId, ORDER_ID);
    assert.equal(sent[0].payload.tableNumber, 7);
    assert.equal(sent[0].payload.table.displayId, "T7");
    assert.deepEqual(sent[0].payload.items.map((i) => i.name), ["Naan", "Lassi"]);
  } finally {
    delete require.cache[path];
  }
});
