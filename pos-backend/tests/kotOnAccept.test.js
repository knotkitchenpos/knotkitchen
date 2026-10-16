/**
 * D4 (owner, 2026-10-13): a customer's order -- table QR, website, Knot Eats --
 * reaches the kitchen printer when staff ACCEPT it, never before, and a
 * declined order prints nothing. The tills print on `onlineOrder:accepted`
 * (the whole order, then its Auto Receipt -- a table's receipt waits for the
 * till to settle it) or, for dishes accepted onto a
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

const withController = async ({ order = null, session = null, found = [], recalc = async (s) => s }, fn) => {
  const seen = { accepted: [], rounds: [], filter: null, emits: [] };
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
      recalculateSessionBill: recalc,
      releaseSessionForCancelledOrder: async () => null,
    },
    "../services/socket": {
      orderCreatedPayload: require("../services/socket").orderCreatedPayload,
      itemsAddedPayload: () => ({}),
      // The Orders page refetches on these two: note the order's bill as saved when each fires.
      emitOrderStatusChanged: () => seen.emits.push(["status", order && order.savedBill]),
      emitTableSessionUpdated: () => seen.emits.push(["session", order && order.savedBill]),
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

// Owner, 2026-10-16: a guest's table order showed ₹0 on the New Order card, and
// the Orders page kept ₹0 after Accept while Manage Tables had the right amount.

/** As the real recalculateSessionBill under N017: a guest's pending line is off the bill. 10% service charge. */
const billSession = async (s) => {
  const sub = s.items.filter((i) => i.status !== "cancelled" && i.status !== "pending").reduce((t, i) => t + i.total, 0);
  s.bills = { subtotal: sub, tax: 0, serviceCharge: sub / 10, totalWithTax: sub + sub / 10 };
  return s;
};
const sessionFor = (order) => ({
  status: "OCCUPIED",
  items: order.items.map((i) => ({ name: i.name, kdsItemId: i._id, status: i.status, total: i.total })),
  bills: { ...order.bills },
});
/** A guest's first round: none of it is on the bill yet. `savedBill` is what the DB holds. */
const unbilledOrder = (extra = {}) =>
  guestOrder({
    bills: { subtotal: 0, tax: 0, serviceCharge: 0, totalWithTax: 0 },
    savedBill: null,
    async save() { this.savedBill = this.bills?.totalWithTax; return this; },
    ...extra,
  });

test("the New Order card carries a guest's pending total, not only the ₹0 bill", () => {
  const order = unbilledOrder({
    items: [
      { _id: "a1", name: "Naan", quantity: 2, total: 80, status: "pending" },
      { _id: "a2", name: "Lassi", quantity: 1, total: 60, status: "pending" },
      { _id: "a3", name: "Kulfi", quantity: 1, total: 90, status: "cancelled" },
    ],
  });
  const card = require("../services/socket").orderCreatedPayload(order);
  assert.equal(card.bills.totalWithTax, 0);
  assert.equal(card.pendingTotal, 140, "cancelled lines are not counted");
});

test("REGRESSION: accepting a guest's table order saves the table's bill on the order before Orders refetches", async () => {
  const order = unbilledOrder();
  const session = sessionFor(order);
  await withController({ order, session, recalc: billSession }, async (mod, seen) => {
    const { err } = await accept(mod);
    assert.equal(err, null, err && err.message);
    assert.equal(session.bills.totalWithTax, 154);
    assert.equal(order.bills.totalWithTax, 154, "the Orders page showed ₹0 here");
    assert.deepEqual(seen.emits, [["status", 154], ["session", 154]], "saved before the refresh events");
  });
});

test("REGRESSION: accepting added dishes leaves the order's bill equal to the table's", async () => {
  const order = unbilledOrder({
    orderStatus: "In Progress",
    items: [
      { _id: "a1", name: "Naan", quantity: 2, total: 80, status: "preparing" },
      { _id: "a3", name: "Kulfi", quantity: 1, total: 90, status: "pending" },
    ],
    bills: { subtotal: 80, tax: 0, serviceCharge: 8, totalWithTax: 88 },
  });
  const session = sessionFor(order);
  await withController({ order, session, recalc: billSession }, async (mod, seen) => {
    const { err } = await call(mod.resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "accept" } });
    assert.equal(err, null, err && err.message);
    assert.equal(session.bills.totalWithTax, 187);
    // The order's own recompute kept the old ₹8 service charge: 178.
    assert.equal(order.bills.totalWithTax, 187);
    assert.deepEqual(seen.emits, [["status", 187], ["session", 187]]);
  });
});
