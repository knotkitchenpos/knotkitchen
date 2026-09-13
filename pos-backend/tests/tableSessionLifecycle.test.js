const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

// ============================================================
// In-memory store to simulate the session lifecycle
// ============================================================
const store = {
  sessions: [],
  tables: [],
  orders: [],
  auditLogs: [],
  _nextId: 1,
};

const newId = () => {
  const hex = store._nextId.toString(16).padStart(24, "0");
  store._nextId++;
  return hex;
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// ============================================================
// Fake mongoose session (transaction no-ops for unit tests)
// ============================================================
const fakeMongoSession = {
  startTransaction() {},
  async commitTransaction() {},
  async abortTransaction() {},
  endSession() {},
};

const fakeMongooseSessionReturn = { session: fakeMongoSession };

function resetStore() {
  store.sessions = [];
  store.tables = [];
  store.orders = [];
  store.auditLogs = [];
  store._nextId = 1;
}

// ============================================================
// Mocked model implementations
// ============================================================

/** Mongoose query-chain emulation:
 * `Model.findOne(...).session(ms)` and `await query` must both work.
 */
const makeThenable = (value) => {
  const q = {
    session() { return q; },
    populate() { return q; },
    then(resolve) { resolve(value); return Promise.resolve(); },
  };
  return q;
};

/** Return a live store reference so controller mutations persist. */
const toLiveSession = (s) => {
  s.toObject = () => JSON.parse(JSON.stringify(s));
  s.save = async function () { return s; };
  return s;
};
const toLiveTable = (t) => {
  t.toObject = () => JSON.parse(JSON.stringify(t));
  t.save = async function () { return t; };
  return t;
};

/** TableSession.mock */
const TableSessionMock = {
  findOne(query) {
    const { tableId, status, restaurantId, isDeleted, _id, ...rest } = query || {};
    let result = store.sessions.find((s) => {
      if (tableId && s.tableId !== tableId) return false;
      if (_id && s._id !== _id) return false;
      if (restaurantId && s.restaurantId !== restaurantId) return false;
      if (isDeleted) {
        // Query style is { $ne: true } — match NOT-deleted docs only
        if (isDeleted.$ne === true) {
          if (s.isDeleted === true) return false;
        } else if (s.isDeleted === undefined || s.isDeleted === false) {
          return false;
        }
      }
      if (status) {
        if (Array.isArray(status.$in)) {
          if (!status.$in.includes(s.status)) return false;
        } else if (s.status !== status) return false;
      }
      // Ignore other operators — test-specific
      return true;
    });
    return makeThenable(result ? toLiveSession(result) : null);
  },

  async find(query = {}) {
    let list = store.sessions.slice();
    if (query.tableId) list = list.filter((s) => s.tableId === query.tableId);
    if (query.status && Array.isArray(query.status.$in)) {
      list = list.filter((s) => query.status.$in.includes(s.status));
    }
    if (query.restaurantId) list = list.filter((s) => s.restaurantId === query.restaurantId);
    return list.map((s) => clone({ ...s, toObject: () => clone(s) }));
  },

  async create(docs) {
    const arr = Array.isArray(docs) ? docs : [docs];
    const created = arr.map((doc) => {
      const s = {
        _id: newId(),
        sessionCode: doc.sessionCode,
        restaurantId: doc.restaurantId,
        outletId: doc.outletId,
        tableId: doc.tableId,
        source: doc.source || "POS",
        status: doc.status || "OPEN",
        customerCount: doc.customerCount || 1,
        customerName: doc.customerName || "",
        customerPhone: doc.customerPhone || "",
        items: doc.items || [],
        originalItemsCount: doc.originalItemsCount || 0,
        bills: doc.bills || { subtotal: 0, tax: 0, discount: 0, charges: 0, totalWithTax: 0 },
        payment: doc.payment || { method: "", status: "PENDING", transactionId: "", paidAt: null },
        paymentHistory: doc.paymentHistory || [],
        timeline: doc.timeline || [],
        openedAt: doc.openedAt || new Date(),
        openedBy: doc.openedBy || null,
        closedBy: null,
        closedAt: null,
        billRequestedAt: null,
        paymentRequestedAt: null,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.sessions.push(s);
      return toLiveSession(s);
    });
    // Mongoose always returns an array when an array is passed to create()
    return created;
  },

  async save() {
    // no-op — documents are mutated in place via references
  },

  findOneAndUpdate(query, update) {
    const sess = store.sessions.find((s) => s._id === query._id);
    if (!sess) return makeThenable(null);
    Object.assign(sess, update);
    return makeThenable(toLiveSession(sess));
  },
};

/** Table.mock */
const TableMock = {
  findOne(query) {
    const { _id, tableNumber, restaurantId, outletId, isDeleted } = query || {};
    const result = store.tables.find((t) => {
      if (_id && t._id !== _id) return false;
      if (tableNumber !== undefined && t.tableNumber !== tableNumber) return false;
      if (restaurantId && t.restaurantId !== restaurantId) return false;
      if (outletId && t.outletId !== outletId) return false;
      if (isDeleted) {
        // Query style is { $ne: true } — match NOT-deleted docs only
        if (isDeleted.$ne === true) {
          if (t.isDeleted === true) return false;
        } else if (t.isDeleted === undefined || t.isDeleted === false) {
          return false;
        }
      }
      return true;
    });
    return makeThenable(result ? toLiveTable(result) : null);
  },

  findOneAndUpdate(query, update, opts) {
    const t = store.tables.find((x) => x._id === query._id);
    if (!t) return makeThenable(null);
    Object.assign(t, update.$set || update);
    return makeThenable(toLiveTable(t));
  },

  async save() {
    // no-op — mutated in place
  },
};

/** Order.mock */
const OrderMock = {
  async create(docs) {
    const arr = Array.isArray(docs) ? docs : [docs];
    const created = arr.map((d) => {
      const o = {
        _id: newId(),
        ...d,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.orders.push(o);
      return clone(o);
    });
    // Mongoose returns an array when an array is passed to create()
    return created;
  },
  async findById() {
    return null;
  },
  async findOne() {
    return null;
  },
};

/** AuditLog.mock */
const AuditLogMock = {
  async create(doc) {
    store.auditLogs.push(doc);
    return doc;
  },
};

/** PaymentTransaction.mock */
const PaymentTransactionMock = {
  async create() { return { _id: newId() }; },
  async updateMany() { return {}; },
};

/** Bill.mock */
const BillMock = {
  async create() { return [{ _id: newId() }]; },
  async findOneAndUpdate() { return {}; },
};

/** price service mock */
const priceMock = {
  async resolveMenuItem({ menuItemId, restaurantId, outletId }) {
    return {
      item: { _id: menuItemId, name: "Test Item", price: 100 },
    };
  },
  calculateUnitPrice({ item }) {
    return { unitPrice: item.price, variant: null, addons: [], modifiers: [] };
  },
  calculateBill({ items, discount = 0, additionalCharges = 0 }) {
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const tax = Math.round(subtotal * 0.05 * 100) / 100;
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      tax,
      discount,
      charges: additionalCharges,
      totalWithTax: Math.round((subtotal + tax + additionalCharges) * 100) / 100,
    };
  },
};

const realMongoose = require("mongoose");
/** mongoose mock */
const mongooseMock = {
  Schema: realMongoose.Schema,
  Types: realMongoose.Types,
  model: realMongoose.model.bind(realMongoose),
  models: realMongoose.models,
  async startSession() {
    return { ...fakeMongoSession, startTransaction() {} };
  },
};

function loadControllerWithMocks() {
  const orig = Module._load;
  Module._load = function (r, p, m) {
    // No pre-bookings in these scenarios.
    if (/tableBookingController$/.test(r)) return { findActiveBlock: async () => null, blockedError: () => new Error("blocked"), formatTimeOf: () => "", upcomingBookingsByTable: async () => ({}) };
    if (r === "../models/tableModel") return TableMock;
    if (r === "../models/tableSessionModel") return TableSessionMock;
    if (r === "../models/orderModel") return OrderMock;
    if (r === "../models/auditLogModel") return AuditLogMock;
    if (r === "../models/paymentTransactionModel") return PaymentTransactionMock;
    if (r === "../models/billModel") return BillMock;
    if (r === "../services/price") return priceMock;
    if (r === "mongoose") return mongooseMock;
    return orig.apply(this, arguments);
  };
  const ctrl = require("../controllers/tableSessionController");
  Module._load = orig;
  return ctrl;
}

// ============================================================
// Helpers to build requests
// ============================================================
function makeUser() {
  return { _id: newId(), restaurantId: "rest-1", outletId: "outlet-1" };
}

function makeTable(overrides = {}) {
  const t = {
    _id: newId(),
    tableNumber: 4,
    capacity: 4,
    currentOccupancy: 0,
    status: "available",
    restaurantId: "rest-1",
    outletId: "outlet-1",
    isDeleted: false,
  };
  Object.assign(t, overrides);
  store.tables.push(t);
  return t;
}

function makeResponse() {
  const res = {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; },
  };
  return res;
}

/**
 * Awaits an Express-style controller directly and captures any error it
 * forwards to `next(err)`.
 *
 * Controllers in this codebase call `res.json(...)` on success and only
 * invoke `next(err)` when something fails — they never call `next()` on the
 * success path. Wrapping the call in a `new Promise((resolve) => controller(req, res, resolve))`
 * therefore hangs forever when a request succeeds. This helper awaits the
 * async controller itself (which resolves when the handler finishes) and
 * records `next` invocations so tests can assert "no error was forwarded".
 */
async function callController(handler, req, res) {
  let capturedError;
  const next = (err) => {
    capturedError = err;
  };
  await handler(req, res, next);
  return capturedError;
}

const itemPayload = (menuItemId) => ({
  menuItemId,
  quantity: 1,
  name: "Biryani",
  price: 100,
});

// ============================================================
// TESTS
// ============================================================

test("first order creates a session", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  const req = {
    user,
    body: {
      tableId: table._id,
      items: [itemPayload(newId())],
      customerCount: 2,
    },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res = makeResponse();
  const err = await callController(ctrl.addItemsToSession, req, res);

  assert.equal(err, undefined, "expected no error");
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.success);

  const activeSessions = store.sessions.filter((s) => ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"].includes(s.status));
  assert.equal(activeSessions.length, 1, "exactly one active session should exist");
  assert.equal(activeSessions[0].tableId, table._id);
  assert.equal(activeSessions[0].status, "OCCUPIED");
  assert.equal(activeSessions[0].items.length, 1);

  const t = store.tables.find((x) => x._id === table._id);
  assert.equal(t.status, "occupied");
  assert.equal(t.currentOccupancy, 2);
});

test("second item uses the same session", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  // First order — creates session
  const req1 = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res1 = makeResponse();
  await callController(ctrl.addItemsToSession, req1, res1);
  const firstSessionId = res1.body.data._id;

  // Second order — must reuse same session
  const req2 = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 3 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res2 = makeResponse();
  await callController(ctrl.addItemsToSession, req2, res2);

  assert.equal(res2.body.data._id, firstSessionId, "second item must use the same session id");
  assert.ok(res2.body.data.items.length >= 2, "session should now have more than one item");

  const activeSessions = store.sessions.filter((s) => ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"].includes(s.status));
  assert.equal(activeSessions.length, 1, "still only one active session");
});

test("third item uses the same session", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  // First, second, third orders
  let firstSessionId = null;
  for (let i = 0; i < 3; i++) {
    const req = {
      user,
      body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
      ip: "1.2.3.4",
      get: () => "test-agent",
    };
    const res = makeResponse();
    await callController(ctrl.addItemsToSession, req, res);
    assert.equal(res.statusCode, 200);

    if (i === 0) {
      firstSessionId = res.body.data._id;
    } else {
      assert.equal(res.body.data._id, firstSessionId, `item ${i + 1} must reuse session ${firstSessionId}`);
    }
  }

  const activeSessions = store.sessions.filter((s) => ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"].includes(s.status));
  assert.equal(activeSessions.length, 1, "only one active session after 3 orders");
  assert.equal(activeSessions[0].items.length, 3, "session accumulates all 3 items");
});

test("only one active session ever exists for a table", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  // Fire several sequential requests
  for (let i = 0; i < 5; i++) {
    const req = {
      user,
      body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
      ip: "1.2.3.4",
      get: () => "test-agent",
    };
    const res = makeResponse();
    await callController(ctrl.addItemsToSession, req, res);
    assert.equal(res.statusCode, 200);
  }

  const allSessions = store.sessions;
  const activeSessions = allSessions.filter((s) => ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"].includes(s.status));
  assert.equal(activeSessions.length, 1, "exactly one active session");
  assert.ok(allSessions.length >= 1);
  // All requests must have returned the same session
  const uniqueIds = new Set();
  store.sessions.forEach((s) => uniqueIds.add(s._id));
  assert.equal(uniqueIds.size, 1);
});

test("simultaneous session creation does not create duplicates", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  // Simulate two concurrent requests by intercepting TableSession.create
  // to throw E11000 on the second call — controller must retry and reuse.
  let createCount = 0;
  const origCreate = TableSessionMock.create.bind(TableSessionMock);
  TableSessionMock.create = async function (docs, opts) {
    createCount++;
    if (createCount === 2) {
      const err = new Error("E11000 duplicate key error collection: tablesessions index: tableId_1 dup key");
      err.code = 11000;
      throw err;
    }
    return origCreate(docs, opts);
  };

  try {
    const callPairs = [0, 1].map(() => {
      const req = {
        user,
        body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
        ip: "1.2.3.4",
        get: () => "test-agent",
      };
      const res = makeResponse();
      return { req, res };
    });

    const promises = callPairs.map(({ req, res }) => callController(ctrl.addItemsToSession, req, res));
    const results = await Promise.all(promises);
    // Both should succeed (no error propagated to next)
    results.forEach((err) => assert.equal(err, undefined, "no error expected on concurrent create"));

    const activeSessions = store.sessions.filter((s) => ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"].includes(s.status));
    assert.equal(activeSessions.length, 1, "concurrent opening must produce exactly one active session");
  } finally {
    TableSessionMock.create = origCreate;
  }
});

test("closed table can later create a new session", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  // Open session with first order
  const req1 = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res1 = makeResponse();
  await callController(ctrl.addItemsToSession, req1, res1);
  const firstSessionId = res1.body.data._id;

  // Close the session (admin close, no payment)
  const closeReq = { params: { id: firstSessionId }, user, body: {} };
  const closeRes = makeResponse();
  await callController(ctrl.closeSessionWithoutPayment, closeReq, closeRes);
  assert.equal(closeRes.statusCode, 200);
  assert.equal(closeRes.body.data.status, "CLOSED");

  // Table should be available again
  const t = store.tables.find((x) => x._id === table._id);
  assert.equal(t.status, "available");
  assert.equal(t.currentOccupancy, 0);

  // New order — must create a NEW session (different id)
  const req2 = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res2 = makeResponse();
  await callController(ctrl.addItemsToSession, req2, res2);
  assert.equal(res2.statusCode, 200);
  assert.notEqual(res2.body.data._id, firstSessionId, "closed session must allow a fresh session");

  const activeSessions = store.sessions.filter((s) => ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"].includes(s.status));
  assert.equal(activeSessions.length, 1, "exactly one active session again");
  assert.equal(activeSessions[0].tableId, table._id);
});

test("findActiveSessionByTable returns null when no active session exists", async () => {
  resetStore();
  const table = makeTable();
  const ctrl = loadControllerWithMocks();
  const result = await ctrl.findActiveSessionByTable({ tableId: table._id, restaurantId: "rest-1" });
  assert.equal(result, null);
});

test("addItemsToExistingSession attaches items to the same session", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  // First order creates session
  const req1 = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res1 = makeResponse();
  await callController(ctrl.addItemsToSession, req1, res1);
  const sessionId = res1.body.data._id;

  // Add second item via /:id/items endpoint
  const req2 = {
    params: { id: sessionId },
    user,
    body: { items: [itemPayload(newId())] },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res2 = makeResponse();
  await callController(ctrl.addItemsToExistingSession, req2, res2);
  assert.equal(res2.statusCode, 200);

  const activeSessions = store.sessions.filter((s) => ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"].includes(s.status));
  assert.equal(activeSessions.length, 1, "still one active session");
  assert.equal(activeSessions[0].items.length, 2, "session now has both items");
});

test("POS can open a table and view session details", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  // First order creates a session with item + customer count
  const req = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res = makeResponse();
  const err = await callController(ctrl.addItemsToSession, req, res);
  assert.equal(err, undefined, "expected no error");

  // POS opens the table session and reads the details
  const getReq = { params: { id: res.body.data._id }, user };
  const getRes = makeResponse();
  const getErr = await callController(ctrl.getSessionById, getReq, getRes);
  assert.equal(getErr, undefined, "expected no error opening session");
  assert.equal(getRes.statusCode, 200);

  const data = getRes.body.data;
  assert.equal(data._id, res.body.data._id);
  assert.equal(data.tableId, table._id);
  assert.equal(data.customerCount, 2, "session exposes customer count");
  assert.equal(data.status, "OCCUPIED", "session exposes status");
  assert.ok(data.items.length >= 1, "session exposes ordered items");
  assert.ok(data.bills.totalWithTax > 0, "session exposes running total");
  assert.ok(typeof data.sessionDuration === "string", "session exposes formatted duration");
  assert.ok(data.sessionDurationMs >= 0, "session exposes duration in ms");
});

test("Table 4 Biryani then Water uses the same active session", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable(); // Table 4, capacity 4
  const user = makeUser();

  // First order: Biryani
  const req1 = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res1 = makeResponse();
  await callController(ctrl.addItemsToSession, req1, res1);
  const sessionId = res1.body.data._id;

  // Later, biller adds Water to the same table — must reuse the open session
  const req2 = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res2 = makeResponse();
  await callController(ctrl.addItemsToSession, req2, res2);

  assert.equal(res2.body.data._id, sessionId, "Water must attach to the same Biryani session");
  assert.equal(res2.body.data.items.length, 2, "session now holds Biryani + Water");

  const activeSessions = store.sessions.filter((s) => ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"].includes(s.status));
  assert.equal(activeSessions.length, 1, "still exactly one active session");

  // Table 4 remains occupied, bill stays open
  const t = store.tables.find((x) => x._id === table._id);
  assert.equal(t.status, "occupied");
  assert.equal(t.currentOccupancy, 2);
  const session = store.sessions.find((s) => s._id === sessionId);
  assert.equal(session.status, "OCCUPIED", "session remains occupied — never closed by adding items");
  assert.equal(session.closedAt, null, "no close timestamp");
  assert.ok(session.bills.totalWithTax > 0, "running bill remains open with a total");
});

test("placing a table order leaves session active and bill open (no auto-close)", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  const req = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res = makeResponse();
  await callController(ctrl.addItemsToSession, req, res);
  const sessionId = res.body.data._id;

  const session = store.sessions.find((s) => s._id === sessionId);
  assert.equal(session.status, "OCCUPIED", "session must remain occupied, not closed after placing order");
  assert.equal(session.closedAt, null);
  const t = store.tables.find((x) => x._id === table._id);
  assert.equal(t.status, "occupied", "table stays occupied");
  assert.ok(session.bills.totalWithTax > 0, "bill remains open");
});

test("Flow 2: items-first order attaches to table session", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  // Biller selected items, chose Table Service, selected Table 4, entered 3 guests
  const req = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId()), itemPayload(newId())], customerCount: 3 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res = makeResponse();
  const err = await callController(ctrl.addItemsToSession, req, res);
  assert.equal(err, undefined, "expected no error");
  assert.equal(res.statusCode, 200);

  const session = store.sessions[0];
  assert.equal(session.tableId, table._id);
  assert.equal(session.customerCount, 3, "guest count attached to session");
  assert.equal(session.items.length, 2, "both cart items attached");
  assert.equal(session.status, "OCCUPIED", "session occupied, bill open");
  assert.ok(session.bills.totalWithTax > 0);
});

test("Flow 2: capacity validation rejects over-capacity guest count on existing session", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable(); // Table 4, capacity 4
  const user = makeUser();

  // Open a session first
  const req1 = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res1 = makeResponse();
  await callController(ctrl.addItemsToSession, req1, res1);
  const sessionId = res1.body.data._id;

  // Biller later tries to bump guests to 5 — must be rejected
  const req2 = {
    params: { id: sessionId },
    user,
    body: { items: [itemPayload(newId())], customerCount: 5 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res2 = makeResponse();
  const err = await callController(ctrl.addItemsToExistingSession, req2, res2);
  assert.ok(err, "expected capacity error");
  assert.equal(err.status, 400);
  assert.match(err.message, /maximum capacity of 4 customers/);

  const session = store.sessions.find((s) => s._id === sessionId);
  assert.equal(session.customerCount, 2, "customer count must not change on failed validation");
  assert.equal(session.items.length, 1, "no items should be added on failed validation");
});
