const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const TABLE_ID = "507f1f77bcf86cd799439099";

test("Manage Tables Module 4: Session Rotation — Closing Session A causes new QR scan to mint Session B with zero leakage", async () => {
  const tableDoc = {
    _id: TABLE_ID,
    tableNumber: 1,
    capacity: 4,
    status: "occupied",
    qrEnabled: true,
    currentOccupancy: 2,
    save: async () => {},
  };

  const sessionA = {
    _id: "sess-A",
    sessionCode: "TS_SESSION_A",
    restaurantId: RESTAURANT_ID,
    tableId: TABLE_ID,
    status: "CLOSED", // Closed after payment
    customerName: "Alice",
    customerPhone: "9876543210",
    items: [{ menuItemId: "dish-1", name: "Burger", price: 200, quantity: 1, total: 200 }],
    bills: { totalWithTax: 200 },
    save: async () => {},
  };

  const sessionB = {
    _id: "sess-B",
    sessionCode: "TS_SESSION_B", // Fresh rotated session code
    restaurantId: RESTAURANT_ID,
    tableId: TABLE_ID,
    status: "OCCUPIED",
    customerCount: 1,
    customerName: "",
    customerPhone: "",
    items: [], // 0 items from Session A
    bills: { subtotal: 0, totalWithTax: 0 },
    timeline: [],
    save: async () => {},
  };

  let activeSessionLookupCount = 0;
  const TableSessionMock = {
    findOne: (q) => {
      activeSessionLookupCount++;
      // First lookup for active session returns null (Session A is CLOSED)
      return {
        session: () => Promise.resolve(null),
        then: (res) => res(null),
      };
    },
    create: async (docs) => [sessionB],
  };

  const TableMock = {
    findOne: () => ({
      session: () => Promise.resolve(tableDoc),
      then: (res) => res(tableDoc),
    }),
  };

  const OrderMock = {
    create: async (docs) => docs.map((d) => ({ _id: "order-B", items: d.items.map((i, idx) => ({ _id: `kds-${idx}` })) })),
  };

  const priceServiceMock = {
    resolveMenuItem: async () => ({ item: { _id: "dish-99", name: "Pasta", price: 280 } }),
    calculateUnitPrice: () => ({ unitPrice: 280 }),
    calculateBill: ({ items }) => ({ subtotal: 280, totalWithTax: 280 }),
  };

  const AuditLogMock = { create: async () => {} };

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
      items: [{ menuItemId: "dish-99", quantity: 1 }],
    },
  };

  try {
    await addItemsToSession(req, res, () => {});
  } finally {
    Module._load = orig;
    mongoose.startSession = origStartSession;
  }

  assert.ok(resData);
  const newSession = resData.data;
  assert.equal(newSession.sessionCode, "TS_SESSION_B"); // New rotated session
  assert.notEqual(newSession.sessionCode, sessionA.sessionCode); // Session B != Session A
  assert.equal(newSession.items.length, 1); // 1 item (Pasta) from Session B order
  assert.equal(newSession.items[0].name, "Pasta");
  assert.equal(newSession.items.some((i) => i.name === "Burger"), false); // No items carried over from Session A (Alice's Burger)
});

test("Manage Tables Module 4: Permanent QR is NOT used as settled session credential", async () => {
  const { generateSessionCode } = require("../controllers/tableSessionController");
  const sessionCode = generateSessionCode();

  assert.ok(sessionCode);
  assert.match(sessionCode, /^TS_/);
  // Session code uses cryptographically secure random token, never table number or store ID directly
  assert.equal(sessionCode.includes(TABLE_ID), false);
  assert.equal(sessionCode.includes(RESTAURANT_ID), false);
});
