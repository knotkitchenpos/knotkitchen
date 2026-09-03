const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

// ============================================================
// In-memory store to simulate the full table billing lifecycle
// ============================================================
const store = {
  sessions: [],
  tables: [],
  orders: [],
  bills: [],
  auditLogs: [],
  paymentTransactions: [],
  _nextId: 1,
};

const newId = () => {
  const hex = store._nextId.toString(16).padStart(24, "0");
  store._nextId++;
  return hex;
};

const clone = (o) => JSON.parse(JSON.stringify(o));

function resetStore() {
  store.sessions = [];
  store.tables = [];
  store.orders = [];
  store.bills = [];
  store.auditLogs = [];
  store.paymentTransactions = [];
  store._nextId = 1;
}

// ============================================================
// Fake mongoose session (transaction no-ops for unit tests)
// ============================================================
const fakeMongoSession = {
  startTransaction() {},
  async commitTransaction() {},
  async abortTransaction() {},
  endSession() {},
};

// ============================================================
// Mocked model implementations
// ============================================================

const makeThenable = (value) => {
  const q = {
    session() { return q; },
    populate() { return q; },
    then(resolve) { resolve(value); return Promise.resolve(); },
  };
  return q;
};

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

/** TableSession.mock — in-memory store with live references */
const TableSessionMock = {
  findOne(query) {
    const { tableId, status, restaurantId, isDeleted, _id } = query || {};
    let result = store.sessions.find((s) => {
      if (tableId && s.tableId !== tableId) return false;
      if (_id && s._id !== _id) return false;
      if (restaurantId && s.restaurantId !== restaurantId) return false;
      if (isDeleted) {
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
        customerId: null,
        items: doc.items || [],
        originalItemsCount: doc.originalItemsCount || 0,
        bills: doc.bills || { subtotal: 0, tax: 0, discount: 0, charges: 0, totalWithTax: 0 },
        payment: doc.payment || { method: "", status: "PENDING", transactionId: "", paidAt: null, recordedBy: null },
        paymentHistory: doc.paymentHistory || [],
        timeline: doc.timeline || [],
        openedAt: doc.openedAt || new Date(),
        openedBy: doc.openedBy || null,
        closedBy: null,
        closedAt: null,
        billId: doc.billId || null,
        billRequestedAt: null,
        paymentRequestedAt: null,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.sessions.push(s);
      return toLiveSession(s);
    });
    return created;
  },

  async save() {},

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

  async save() {},
};

/** Order.mock — also tracks updateMany so we can verify orders survive payment */
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
    return created;
  },
  async findById() {
    return null;
  },
  async findOne() {
    return null;
  },
  async updateMany(query, update) {
    const { tableSessionId } = query || {};
    let modified = 0;
    store.orders.forEach((o) => {
      if (tableSessionId && o.tableSessionId === tableSessionId) {
        Object.assign(o, update.$set || update);
        modified++;
      }
    });
    return { modifiedCount: modified };
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
  async create(doc) {
    const arr = Array.isArray(doc) ? doc : [doc];
    const created = arr.map((d) => ({ _id: newId(), ...d }));
    store.paymentTransactions.push(...created);
    return created;
  },
  async updateMany() {
    return { modifiedCount: 0 };
  },
};

/** Bill.mock — supports create, findOneAndUpdate and findOne (for bill display) */
const BillMock = {
  async create(docs) {
    const arr = Array.isArray(docs) ? docs : [docs];
    const created = arr.map((d) => {
      const b = {
        _id: newId(),
        ...d,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.bills.push(b);
      return clone(b);
    });
    return created;
  },
  async findOne(query) {
    const { _id } = query || {};
    const b = store.bills.find((x) => x._id === _id);
    return b ? clone(b) : null;
  },
  async findOneAndUpdate(query, update) {
    const { _id } = query || {};
    const b = store.bills.find((x) => x._id === _id);
    if (!b) return null;
    Object.assign(b, update.$set || update);
    return clone(b);
  },
};

/** price service mock — server-side pricing with menu lookup */
const MENU_LOOKUP = {
  menu_biryani: { _id: "menu_biryani", name: "Biryani", price: 250 },
  menu_water: { _id: "menu_water", name: "Water", price: 20 },
  menu_kebab: { _id: "menu_kebab", name: "Kebab", price: 300 },
  menu_default: { _id: "menu_default", name: "Test Item", price: 100 },
};

const priceMock = {
  async resolveMenuItem({ menuItemId, restaurantId, outletId }) {
    const item = MENU_LOOKUP[menuItemId] || MENU_LOOKUP.menu_default;
    return { item: { _id: item._id, name: item.name, price: item.price } };
  },
  calculateUnitPrice({ item }) {
    return { unitPrice: item.price, variant: null, addons: [], modifiers: [] };
  },
  calculateBill({ items, discount = 0, additionalCharges = 0 }) {
    const subtotal = Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
    const tax = Math.round(subtotal * 0.05 * 100) / 100;
    return {
      subtotal,
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

/** Seeds a session directly in a given state (for lifecycle tests). */
async function seedSession({ table, user, status = "OCCUPIED", items = [] }) {
  const [session] = await TableSessionMock.create([
    {
      sessionCode: `TS_SEED_${Date.now().toString(36).toUpperCase()}`,
      restaurantId: table.restaurantId,
      outletId: table.outletId,
      tableId: table._id,
      source: "POS",
      status,
      customerCount: 2,
      customerName: "Guest",
      customerPhone: "",
      items,
      bills: { subtotal: 0, tax: 0, discount: 0, charges: 0, totalWithTax: 0 },
      openedAt: new Date(),
      openedBy: user._id,
    },
  ]);
  const ctrl = loadControllerWithMocks();
  await ctrl.recalculateSessionBill(session);
  return session;
}

// ============================================================
// TESTS
// ============================================================

// ============================================================
// 1. Full happy-path lifecycle
// OPEN → OCCUPIED → PROCESSING → BILL_REQUESTED
//     → PAYMENT_PENDING → PAID → CLOSED
// ============================================================
test("full lifecycle: OPEN → OCCUPIED → PROCESSING → BILL_REQUESTED → PAYMENT_PENDING → PAID → CLOSED", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable(); // Table 4
  const user = makeUser();

  // ---- 1. OPEN ----
  // Seed an OPEN session (e.g. manager pre-opened for a reservation)
  const [openSession] = await TableSessionMock.create([
    {
      sessionCode: `TS_OPEN_${Date.now().toString(36).toUpperCase()}`,
      restaurantId: table.restaurantId,
      outletId: table.outletId,
      tableId: table._id,
      source: "POS",
      status: "OPEN",
      customerCount: 0,
      items: [],
      bills: { subtotal: 0, tax: 0, discount: 0, charges: 0, totalWithTax: 0 },
      openedAt: new Date(),
      openedBy: user._id,
    },
  ]);
  assert.equal(openSession.status, "OPEN");

  // ---- 2. OCCUPIED ----
  // First order (Biryani) — OPEN session becomes OCCUPIED
  const req = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res = makeResponse();
  const err = await callController(ctrl.addItemsToSession, req, res);
  assert.equal(err, undefined, "expected no error");
  assert.equal(res.statusCode, 200);
  const sessionId = res.body.data._id;
  assert.equal(sessionId, openSession._id, "must reuse the OPEN session");
  assert.equal(res.body.data.status, "OCCUPIED", "OPEN → OCCUPIED on first order");

  // Later: Water — still same session, still OCCUPIED
  const req2 = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res2 = makeResponse();
  await callController(ctrl.addItemsToSession, req2, res2);
  assert.equal(res2.body.data._id, sessionId, "Water must join the same session");
  assert.equal(res2.body.data.status, "OCCUPIED");
  assert.equal(res2.body.data.items.length, 2, "Biryani + Water under one session");

  // ---- 3. PROCESSING ----
  // Manually mark the session processing (in real flow KDS pushes this)
  const procSession = store.sessions.find((s) => s._id === sessionId);
  procSession.status = "PROCESSING";
  assert.equal(procSession.status, "PROCESSING");

  // ---- 4. BILL_REQUESTED ----
  const billReq = { params: { id: sessionId }, user, body: {} };
  const billRes = makeResponse();
  const billErr = await callController(ctrl.requestBill, billReq, billRes);
  assert.equal(billErr, undefined, "bill request should succeed from PROCESSING");
  assert.equal(billRes.statusCode, 200);
  assert.equal(billRes.body.data.status, "BILL_REQUESTED");
  assert.ok(billRes.body.data.billRequestedAt, "billRequestedAt timestamp set");
  assert.ok(procSession.billId, "canonical Bill created lazily on request");

  // ---- 5. PAYMENT_PENDING ----
  const pendReq = { params: { id: sessionId }, user, body: {} };
  const pendRes = makeResponse();
  const pendErr = await callController(ctrl.markPaymentPending, pendReq, pendRes);
  assert.equal(pendErr, undefined, "payment-pending transition should succeed");
  assert.equal(pendRes.body.data.status, "PAYMENT_PENDING");

  // ---- 6 + 7. PAID → CLOSED ----
  const payReq = {
    params: { id: sessionId },
    user,
    body: {
      method: "CASH",
      amount: procSession.bills.totalWithTax,
      paymentStatus: "success",
      idempotencyKey: `pay-${sessionId}-1`,
    },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const payRes = makeResponse();
  const payErr = await callController(ctrl.recordSessionPayment, payReq, payRes);
  assert.equal(payErr, undefined, "payment should succeed");
  assert.equal(payRes.statusCode, 200);

  const settled = store.sessions.find((s) => s._id === sessionId);
  // The payment flow passes through PAID and lands on CLOSED
  assert.equal(settled.payment.status, "PAID", "1. payment marked successful");
  assert.equal(settled.payment.paidAt !== null, true, "paidAt set");
  assert.ok(settled.paymentHistory.length >= 1, "payment history preserved");
  assert.equal(settled.paymentHistory[settled.paymentHistory.length - 1].status, "PAID");
  assert.equal(settled.status, "CLOSED", "5. session closed");
  assert.ok(settled.closedAt, "closedAt timestamp set");

  // Bill record marked PAID
  const bill = store.bills.find((b) => b._id === settled.billId);
  assert.ok(bill, "bill record exists and is preserved");
  assert.equal(bill.status, "PAID", "2. bill marked PAID");

  // A settled table now enters its post-payment cooldown rather than going
  // straight back into service, so nobody is seated onto an uncleared table.
  // services/tableCooldownService returns it to "available" once availableAt
  // passes (or immediately, when the restaurant sets the wait to 0).
  const t = store.tables.find((x) => x._id === table._id);
  assert.equal(t.status, "cleaning", "6. table entered post-payment cooldown");
  assert.ok(t.availableAt instanceof Date, "cooldown deadline is stamped on the table");
  assert.ok(t.availableAt.getTime() > Date.now(), "and it is in the future");
  assert.equal(t.currentOccupancy, 0);

  // Orders preserved — NOT deleted
  const sessionOrders = store.orders.filter((o) => o.tableSessionId === sessionId);
  assert.ok(sessionOrders.length >= 2, "kitchen orders preserved after payment");
  sessionOrders.forEach((o) => {
    assert.notEqual(o.orderStatus, "cancelled", "historical order not cancelled/deleted");
  });

  // Timeline captures every step
  const events = settled.timeline.map((t) => t.event);
  assert.ok(events.includes("BILL_REQUESTED"));
  assert.ok(events.includes("PAYMENT_PENDING"));
  assert.ok(events.includes("PAYMENT_COMPLETED"));
  assert.ok(events.includes("SESSION_PAID"));
  assert.ok(events.includes("SESSION_CLOSED"));
});

// ============================================================
// 2. Direct happy-path: OCCUPIED → BILL_REQUESTED → PAYMENT_PENDING → PAID
// (customer requests bill straight from occupied, skips processing)
// ============================================================
test("direct lifecycle: OCCUPIED → BILL_REQUESTED → PAYMENT_PENDING → PAID → CLOSED", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  // Open + occupy via first order
  const req = {
    user,
    body: { tableId: table._id, items: [itemPayload(newId())], customerCount: 2 },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res = makeResponse();
  await callController(ctrl.addItemsToSession, req, res);
  const sessionId = res.body.data._id;
  assert.equal(res.body.data.status, "OCCUPIED");

  // Customer requests bill
  const billReq = { params: { id: sessionId }, user, body: {} };
  const billRes = makeResponse();
  await callController(ctrl.requestBill, billReq, billRes);
  assert.equal(billRes.body.data.status, "BILL_REQUESTED");

  // Customer selects payment
  const pendReq = { params: { id: sessionId }, user, body: {} };
  const pendRes = makeResponse();
  await callController(ctrl.markPaymentPending, pendReq, pendRes);
  assert.equal(pendRes.body.data.status, "PAYMENT_PENDING");

  // Pay
  const session = store.sessions.find((s) => s._id === sessionId);
  const payReq = {
    params: { id: sessionId },
    user,
    body: { method: "UPI", amount: session.bills.totalWithTax, paymentStatus: "success", idempotencyKey: `pay-${sessionId}-direct` },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const payRes = makeResponse();
  const payErr = await callController(ctrl.recordSessionPayment, payReq, payRes);
  assert.equal(payErr, undefined);
  assert.equal(store.sessions.find((s) => s._id === sessionId).status, "CLOSED");
});

// ============================================================
// 3. Bill display endpoint
// ============================================================
test("bill display returns all items, quantities, subtotal, taxes, charges, total, table number and session code", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable({ tableNumber: 4 });
  const user = makeUser();

  // Place two orders (Biryani ×2 then Water ×1) to build up the session
  const req = {
    user,
    body: {
      tableId: table._id,
      items: [{ menuItemId: "menu_biryani", quantity: 2 }],
      customerCount: 2,
    },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res = makeResponse();
  await callController(ctrl.addItemsToSession, req, res);
  const sessionId = res.body.data._id;

  const req2 = {
    user,
    body: {
      tableId: table._id,
      items: [{ menuItemId: "menu_water", quantity: 1 }],
      customerCount: 2,
    },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const res2 = makeResponse();
  await callController(ctrl.addItemsToSession, req2, res2);

  // Request bill so a canonical Bill exists
  await callController(ctrl.requestBill, { params: { id: sessionId }, user, body: {} }, makeResponse());

  // Fetch the bill
  const billReq = { params: { id: sessionId }, user };
  const billRes = makeResponse();
  const err = await callController(ctrl.getSessionBill, billReq, billRes);
  assert.equal(err, undefined, "bill fetch should not error");
  assert.equal(billRes.statusCode, 200);

  const data = billRes.body.data;
  assert.equal(data.sessionId, sessionId);
  assert.ok(data.sessionCode, "session/order number present");
  assert.ok(data.billNumber, "bill number present");
  assert.equal(data.table.tableNumber, 4, "table number present");
  assert.equal(data.table.id, table._id);
  assert.equal(data.customerCount, 2);
  assert.equal(data.sessionStatus, "BILL_REQUESTED");

  // Items preserved with quantities — line entries, not quantity-expanded rows
  assert.equal(data.items.length, 2, "Biryani + Water = 2 line entries with quantities");
  const biryani = data.items.find((i) => i.name === "Biryani");
  assert.equal(biryani.quantity, 2, "Biryani quantity shown");
  assert.equal(biryani.price, 250);
  assert.equal(biryani.total, 500, "Biryani line total = 250 × 2");
  const water = data.items.find((i) => i.name === "Water");
  assert.equal(water.quantity, 1);
  assert.equal(water.total, 20);

  // Server-side totals: subtotal = 250*2 + 20 = 520, tax 5% = 26, total = 546
  assert.equal(data.bills.subtotal, 520);
  assert.equal(data.bills.tax, 26);
  assert.equal(data.bills.totalWithTax, 546);
  // charges = 0 for this test (no additional charges configured)
  assert.equal(data.bills.charges, 0);
  // totals mirrors bills (server-side recalculated)
  assert.equal(data.totals.totalWithTax, 546);
  assert.ok(data.requestedAt, "bill request timestamp present");
});

// ============================================================
// 4. Invalid transitions — CLOSED → add item
// ============================================================
test("invalid transition: CLOSED session rejects adding items", async () => {
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

  // Settle via payment → CLOSED
  const session = store.sessions.find((s) => s._id === sessionId);
  const payReq = {
    params: { id: sessionId },
    user,
    body: { method: "CASH", amount: session.bills.totalWithTax, paymentStatus: "success", idempotencyKey: `pay-${sessionId}-close` },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const payRes = makeResponse();
  await callController(ctrl.recordSessionPayment, payReq, payRes);
  assert.equal(store.sessions.find((s) => s._id === sessionId).status, "CLOSED");

  // Try to add an item to the CLOSED session → must be rejected
  const addReq = {
    params: { id: sessionId },
    user,
    body: { items: [itemPayload(newId())] },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const addRes = makeResponse();
  const err = await callController(ctrl.addItemsToExistingSession, addReq, addRes);
  assert.ok(err, "CLOSED → add item must fail");
  assert.equal(err.status, 400);
  assert.match(err.message, /settled|CLOSED/);

  // Item count unchanged
  assert.equal(store.sessions.find((s) => s._id === sessionId).items.length, 1);
});

// ============================================================
// 5. Invalid transitions — PAID → add item
// ============================================================
test("invalid transition: PAID session rejects adding items", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  // Seed a session already in PAID state (mid-transition snapshot)
  const session = await seedSession({ table, user, status: "PAID", items: [itemPayload(newId())] });

  const addReq = {
    params: { id: session._id },
    user,
    body: { items: [itemPayload(newId())] },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const addRes = makeResponse();
  const err = await callController(ctrl.addItemsToExistingSession, addReq, addRes);
  assert.ok(err, "PAID → add item must fail");
  assert.equal(err.status, 400);
  assert.match(err.message, /settled|PAID/);

  // No items added
  assert.equal(store.sessions.find((s) => s._id === session._id).items.length, 1);
});

// ============================================================
// 6. Invalid transitions — CLOSED → pay again
// ============================================================
test("invalid transition: CLOSED session rejects paying again", async () => {
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

  // First payment → CLOSED
  const session = store.sessions.find((s) => s._id === sessionId);
  const payReq = {
    params: { id: sessionId },
    user,
    body: { method: "CASH", amount: session.bills.totalWithTax, paymentStatus: "success", idempotencyKey: `pay-${sessionId}-1` },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  await callController(ctrl.recordSessionPayment, payReq, makeResponse());
  assert.equal(store.sessions.find((s) => s._id === sessionId).status, "CLOSED");

  // Second attempt → must be rejected
  const againReq = {
    params: { id: sessionId },
    user,
    body: { method: "CASH", amount: session.bills.totalWithTax, paymentStatus: "success", idempotencyKey: `pay-${sessionId}-2` },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const againRes = makeResponse();
  const err = await callController(ctrl.recordSessionPayment, againReq, againRes);
  assert.ok(err, "CLOSED → pay again must fail");
  assert.equal(err.status, 400);
  assert.match(err.message, /Invalid state transition|already/);

  // Payment history unchanged — no double charge
  const settled = store.sessions.find((s) => s._id === sessionId);
  assert.equal(settled.paymentHistory.filter((p) => p.status === "PAID").length, 1, "only one successful payment recorded");
});

// ============================================================
// 7. Invalid transitions — PAID → pay again
// ============================================================
test("invalid transition: PAID session rejects paying again", async () => {
  resetStore();
  const ctrl = loadControllerWithMocks();
  const table = makeTable();
  const user = makeUser();

  // Seed a session in PAID state with an existing successful payment
  const session = await seedSession({ table, user, status: "PAID", items: [itemPayload(newId())] });
  session.payment = { method: "CASH", status: "PAID", transactionId: "txn-1", paidAt: new Date(), recordedBy: user._id };
  session.paymentHistory = [
    { method: "CASH", amount: session.bills.totalWithTax, status: "PAID", transactionId: "txn-1", idempotencyKey: `pay-${session._id}-done`, at: new Date(), recordedBy: user._id },
  ];

  const againReq = {
    params: { id: session._id },
    user,
    body: { method: "CASH", amount: session.bills.totalWithTax, paymentStatus: "success", idempotencyKey: `pay-${session._id}-again` },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  const againRes = makeResponse();
  const err = await callController(ctrl.recordSessionPayment, againReq, againRes);
  assert.ok(err, "PAID → pay again must fail");
  assert.equal(err.status, 400);
  assert.match(err.message, /settled|PAID|already paid/);
});

// ============================================================
// 8. Historical records preserved after payment
// ============================================================
test("historical order and bill remain available after payment (never deleted)", async () => {
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

  const ordersBefore = store.orders.filter((o) => o.tableSessionId === sessionId);
  assert.ok(ordersBefore.length >= 1, "kitchen order created at order time");

  // Request bill
  await callController(ctrl.requestBill, { params: { id: sessionId }, user, body: {} }, makeResponse());

  // Pay
  const session = store.sessions.find((s) => s._id === sessionId);
  const payReq = {
    params: { id: sessionId },
    user,
    body: { method: "CASH", amount: session.bills.totalWithTax, paymentStatus: "success", idempotencyKey: `pay-${sessionId}-hist` },
    ip: "1.2.3.4",
    get: () => "test-agent",
  };
  await callController(ctrl.recordSessionPayment, payReq, makeResponse());

  // Session remains (CLOSED but present)
  const closedSession = store.sessions.find((s) => s._id === sessionId);
  assert.ok(closedSession, "session record preserved");
  assert.equal(closedSession.status, "CLOSED");

  // Bill remains
  const bill = store.bills.find((b) => b._id === closedSession.billId);
  assert.ok(bill, "bill record preserved");
  assert.equal(bill.status, "PAID");

  // Orders remain
  const ordersAfter = store.orders.filter((o) => o.tableSessionId === sessionId);
  assert.equal(ordersAfter.length, ordersBefore.length, "no orders deleted");
  ordersAfter.forEach((o) => {
    assert.equal(o.isDeleted === true, false, "order not soft-deleted");
  });

  // Payment transactions preserved in the standalone ledger
  assert.ok(store.paymentTransactions.length >= 1, "payment transaction ledger preserved");
  const ledger = store.paymentTransactions.find((pt) => pt.tableSessionId === sessionId && pt.status === "PAID");
  assert.ok(ledger, "PAID transaction in ledger");
  assert.equal(ledger.amount, session.bills.totalWithTax);
});