const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const TABLE_ID = "507f1f77bcf86cd799439099";

test("Manage Tables Module 5: QR order triggers realtime socket event emission on POS", async () => {
  let emittedOrder = null;

  const mockMongoSession = {
    startTransaction: () => {},
    commitTransaction: async () => {},
    abortTransaction: async () => {},
    endSession: () => {},
  };

  const TableSessionMock = {
    findOne: () => ({
      session: () => Promise.resolve(null),
      then: (res) => res(null),
    }),
    create: async (docs) => [
      {
        _id: "s-5",
        sessionCode: "TS_M5_1",
        restaurantId: RESTAURANT_ID,
        outletId: "out-1",
        tableId: TABLE_ID,
        customerCount: 2,
        status: "OCCUPIED",
        items: [],
        bills: { totalWithTax: 150 },
        timeline: [],
        save: async () => {},
      },
    ],
  };

  const TableMock = {
    findOne: () => ({
      session: () => Promise.resolve({ _id: TABLE_ID, tableNumber: 5, capacity: 4, save: async () => {} }),
      then: (res) => res({ _id: TABLE_ID, tableNumber: 5, capacity: 4, save: async () => {} }),
    }),
  };

  const OrderMock = {
    create: async (docs) => docs.map((d) => ({ _id: "ord-m5", ...d })),
  };

  const priceServiceMock = {
    resolveMenuItem: async () => ({ item: { _id: "d1", name: "Naan", price: 50 } }),
    calculateUnitPrice: () => ({ unitPrice: 50 }),
    calculateBill: () => ({ subtotal: 100, totalWithTax: 100 }),
  };

  const socketMock = {
    emitOrderCreated: ({ order }) => {
      emittedOrder = order;
    },
    emitOrderStatusChanged: () => {},
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
    if (r === "../services/socket") return socketMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableSessionController")];
  delete require.cache[require.resolve("../services/auditService")];
  delete require.cache[require.resolve("../services/socket")];
  delete require.cache[require.resolve("../models/auditLogModel")];
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
      items: [{ menuItemId: "d1", quantity: 2 }],
    },
  };

  try {
    await addItemsToSession(req, res, () => {});
  } finally {
    Module._load = orig;
    mongoose.startSession = origStartSession;
  }

  assert.ok(resData);
  assert.ok(emittedOrder); // Verified realtime socket event emitted to POS
  assert.equal(emittedOrder.table, TABLE_ID);
});

test("Manage Tables Module 5: Table settlement releases table to Available and preserves historical order", async () => {
  let updatedTableStatus = null;
  let orderStatusUpdated = null;

  const VALID_SESSION_ID = "507f1f77bcf86cd799439077";
  const sessionDoc = {
    _id: VALID_SESSION_ID,
    sessionCode: "TS_SETTLED_1",
    restaurantId: RESTAURANT_ID,
    tableId: TABLE_ID,
    status: "BILL_REQUESTED",
    bills: { totalWithTax: 500 },
    paymentHistory: [],
    timeline: [],
    items: [],
    toObject: function() { return this; },
    save: async () => {},
  };

  const TableMock = {
    findOneAndUpdate: async (q, u) => {
      updatedTableStatus = u.status;
      return { _id: TABLE_ID, status: u.status };
    },
  };

  const TableSessionMock = {
    findOne: () => ({
      session: () => Promise.resolve(sessionDoc),
      then: (res) => res(sessionDoc),
    }),
  };

  const PaymentTransactionMock = {
    create: async () => [],
    updateMany: async () => {},
  };

  const BillMock = {
    create: async () => [{ _id: "b1" }],
    findOneAndUpdate: async () => {},
  };

  const OrderMock = {
    updateMany: async (q, u) => {
      orderStatusUpdated = u.$set.orderStatus; // Marked "paid" for history
    },
  };

  const mockMongoSession = {
    startTransaction: () => {},
    commitTransaction: async () => {},
    abortTransaction: async () => {},
    endSession: () => {},
  };

  const mongoose = require("mongoose");
  const origStartSession = mongoose.startSession;
  mongoose.startSession = async () => mockMongoSession;

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableSessionModel") return TableSessionMock;
    if (r === "../models/tableModel") return TableMock;
    if (r === "../models/paymentTransactionModel") return PaymentTransactionMock;
    if (r === "../models/billModel") return BillMock;
    if (r === "../models/orderModel") return OrderMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableSessionController")];
  delete require.cache[require.resolve("../services/auditService")];
  delete require.cache[require.resolve("../services/socket")];
  delete require.cache[require.resolve("../models/auditLogModel")];
  const { recordSessionPayment } = require("../controllers/tableSessionController");

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
    params: { id: VALID_SESSION_ID },
    body: { method: "CASH", amount: 500, paymentStatus: "success" },
  };

  try {
    await recordSessionPayment(req, res, (err) => {
      if (err) console.error("RECORD SESSION PAYMENT ERROR:", err);
    });
  } finally {
    Module._load = orig;
    mongoose.startSession = origStartSession;
  }

  assert.ok(resData);
  assert.equal(sessionDoc.status, "CLOSED"); // Session marked CLOSED
  // Released straight back into service -- the post-payment cleaning wait was
  // removed, so the next party can be seated immediately.
  assert.equal(updatedTableStatus, "available");
  assert.equal(orderStatusUpdated, "paid"); // Historical kitchen order marked paid (never deleted)
});
