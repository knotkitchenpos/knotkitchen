const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const TABLE_ID = "507f1f77bcf86cd799439099";

test("Manage Tables Module 3: Session Continuation appends items to same active session without creating duplicates", async () => {
  const existingSession = {
    _id: "session-1",
    sessionCode: "TS_TEST_1",
    restaurantId: RESTAURANT_ID,
    tableId: TABLE_ID,
    status: "OCCUPIED",
    customerCount: 2,
    items: [{ menuItemId: "dish-1", name: "Burger", quantity: 1, price: 200, total: 200 }],
    bills: { subtotal: 200, totalWithTax: 200 },
    timeline: [],
    save: async () => {},
  };

  const mockMongoSession = {
    startTransaction: () => {},
    commitTransaction: async () => {},
    abortTransaction: async () => {},
    endSession: () => {},
  };

  const TableSessionMock = {
    findOne: () => ({
      session: () => Promise.resolve(existingSession),
      then: (res) => res(existingSession),
    }),
  };

  const TableMock = {
    findOne: () => ({
      session: () => Promise.resolve({ _id: TABLE_ID, tableNumber: 1, capacity: 4, qrEnabled: true, save: async () => {} }),
      then: (res) => res({ _id: TABLE_ID, tableNumber: 1, capacity: 4, qrEnabled: true, save: async () => {} }),
    }),
  };

  const OrderMock = {
    findOne: async () => null,
    create: async (docs) => docs.map((d) => ({ _id: "order-2", items: d.items.map((i, idx) => ({ _id: `kds-${idx}` })) })),
  };

  const priceServiceMock = {
    resolveMenuItem: async () => ({ item: { _id: "dish-2", name: "Pizza", price: 350 } }),
    calculateUnitPrice: () => ({ unitPrice: 350 }),
    calculateBill: ({ items }) => {
      const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
      return { subtotal, totalWithTax: subtotal };
    },
  };

  const AuditLogMock = { create: async () => {} };

  const mongoose = require("mongoose");
  const origStartSession = mongoose.startSession;
  mongoose.startSession = async () => mockMongoSession;

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableSessionModel") return TableSessionMock;
    if (r === "../models/tableModel") return TableMock;
    if (r === "../models/orderModel") return OrderMock;
    if (r === "../models/auditLogModel") return AuditLogMock;
    if (r === "../services/price") return priceServiceMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableSessionController")];
  delete require.cache[require.resolve("../services/auditService")];
  const { addItemsToSession } = require("../controllers/tableSessionController");

  let resData = null;
  const res = {
    status: (code) => {
      assert.equal(code, 200);
      return res;
    },
    json: (payload) => {
      resData = payload;
    },
  };

  const req = {
    user: { restaurantId: RESTAURANT_ID, _id: "u1" },
    body: {
      tableId: TABLE_ID,
      items: [{ menuItemId: "dish-2", quantity: 1, price: 9999 }], // Tampered client price (9999)
    },
  };

  try {
    await addItemsToSession(req, res, () => {});
  } finally {
    Module._load = orig;
    mongoose.startSession = origStartSession;
  }

  assert.ok(resData);
  const session = resData.data;
  assert.equal(session.items.length, 2); // Appended to existing session
  assert.equal(session.items[1].name, "Pizza");
  assert.equal(session.items[1].price, 350); // Server-side recalculated price (350 instead of 9999)
});

test("Manage Tables Module 3: Settled session (CLOSED/PAID) rejects adding items", async () => {
  const VALID_SESSION_ID = "507f1f77bcf86cd799439088";
  const settledSession = {
    _id: VALID_SESSION_ID,
    status: "CLOSED",
  };

  const mockMongoSession = {
    startTransaction: () => {},
    commitTransaction: async () => {},
    abortTransaction: async () => {},
    endSession: () => {},
  };

  const TableSessionMock = {
    findOne: () => ({
      session: () => Promise.resolve(settledSession),
      then: (res) => res(settledSession),
    }),
  };

  const TableMock = {
    findOne: () => ({
      session: () => Promise.resolve({ _id: TABLE_ID, capacity: 4 }),
      then: (res) => res({ _id: TABLE_ID, capacity: 4 }),
    }),
  };

  const mongoose = require("mongoose");
  const origStartSession = mongoose.startSession;
  mongoose.startSession = async () => mockMongoSession;

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableSessionModel") return TableSessionMock;
    if (r === "../models/tableModel") return TableMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableSessionController")];
  delete require.cache[require.resolve("../services/auditService")];
  const { addItemsToExistingSession } = require("../controllers/tableSessionController");

  let errorCaught = null;
  const req = {
    user: { restaurantId: RESTAURANT_ID, _id: "u1" },
    params: { id: VALID_SESSION_ID },
    body: { items: [{ menuItemId: "dish-1", quantity: 1 }] },
  };

  try {
    await addItemsToExistingSession(req, {}, (err) => {
      errorCaught = err;
    });
  } finally {
    Module._load = orig;
    mongoose.startSession = origStartSession;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught.status || errorCaught.statusCode, 400);
  assert.ok(errorCaught.message.includes("already settled"));
});
