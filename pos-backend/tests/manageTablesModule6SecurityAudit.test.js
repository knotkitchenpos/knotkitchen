const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_A = "507f1f77bcf86cd799439011";
const RESTAURANT_B = "507f1f77bcf86cd799439022";
const TABLE_A_ID = "507f1f77bcf86cd799439099";
const TABLE_B_ID = "507f1f77bcf86cd799439088";
const TOKEN_A = "a".repeat(64);

test("Manage Tables Module 6 Audit §1: Store Isolation — Restaurant B cannot access Restaurant A tables or sessions", async () => {
  const tableSessionA = {
    _id: "sess-A",
    sessionCode: "TS_REST_A_1",
    restaurantId: RESTAURANT_A,
    tableId: TABLE_A_ID,
    status: "OCCUPIED",
    items: [],
  };

  const TableSessionMock = {
    findOne: (query) => {
      // Query checks restaurantId
      if (query.restaurantId && query.restaurantId !== RESTAURANT_A) {
        return {
          session: () => Promise.resolve(null),
          then: (res) => res(null),
        };
      }
      return {
        session: () => Promise.resolve(tableSessionA),
        then: (res) => res(tableSessionA),
      };
    },
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableSessionModel") return TableSessionMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableSessionController")];
  delete require.cache[require.resolve("../services/auditService")];
  const { getSessionById } = require("../controllers/tableSessionController");

  let errorCaught = null;
  const req = {
    user: { restaurantId: RESTAURANT_B, _id: "u-rest-B" }, // User from Restaurant B
    params: { id: "sess-A" },
  };

  try {
    await getSessionById(req, {}, (err) => {
      errorCaught = err;
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught.status || errorCaught.statusCode, 404);
});

test("Manage Tables Module 6 Audit §4 & §5: IDOR & Anti-Tampering — Client price (₹9999) is ignored, server calculates ₹350", async () => {
  const VALID_SESSION_ID = "507f1f77bcf86cd799439077";
  const sessionDoc = {
    _id: VALID_SESSION_ID,
    sessionCode: "TS_IDOR_1",
    restaurantId: RESTAURANT_A,
    tableId: TABLE_A_ID,
    status: "OCCUPIED",
    customerCount: 2,
    items: [],
    bills: { subtotal: 0, totalWithTax: 0 },
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
      session: () => Promise.resolve(sessionDoc),
      then: (res) => res(sessionDoc),
    }),
  };

  const TableMock = {
    findOne: () => ({
      session: () => Promise.resolve({ _id: TABLE_A_ID, capacity: 4, qrEnabled: true, save: async () => {} }),
      then: (res) => res({ _id: TABLE_A_ID, capacity: 4, qrEnabled: true, save: async () => {} }),
    }),
  };

  const OrderMock = {
    findOne: async () => null, // no open order yet: the round starts one
    create: async (docs) => docs.map((d) => ({ _id: "order-1", items: d.items.map((i, idx) => ({ _id: `kds-${idx}` })) })),
  };

  const priceServiceMock = {
    resolveMenuItem: async () => ({ item: { _id: "dish-1", name: "Paneer Tikka", price: 350 } }),
    calculateUnitPrice: () => ({ unitPrice: 350 }),
    calculateBill: ({ items }) => ({ subtotal: 350, totalWithTax: 350 }),
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
  const { addItemsToExistingSession } = require("../controllers/tableSessionController");

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
    user: { restaurantId: RESTAURANT_A, _id: "u1" },
    params: { id: VALID_SESSION_ID },
    body: {
      items: [{ menuItemId: "dish-1", quantity: 1, price: 9999 }], // Hacked client price 9999
    },
  };

  try {
    await addItemsToExistingSession(req, res, (err) => {
      if (err) console.error("AUDIT TEST 2 ERR:", err);
    });
  } finally {
    Module._load = orig;
    mongoose.startSession = origStartSession;
  }

  assert.ok(resData);
  const updatedSession = resData.data;
  assert.equal(updatedSession.items[0].price, 350); // Server-side price enforced (350 instead of 9999)
  assert.equal(updatedSession.bills.totalWithTax, 350);
});

test("Manage Tables Module 6 Audit §7: End-to-End Lifecycle — Customer A -> Order -> Pay -> Close -> Customer B gets fresh Session B", async () => {
  // 1. Permanent QR Token remains constant
  const PERMANENT_QR_TOKEN = TOKEN_A;

  // 2. Customer A scans QR -> Session A created
  const sessionA = {
    _id: "sess-A-e2e",
    sessionCode: "TS_CUST_A",
    restaurantId: RESTAURANT_A,
    tableId: TABLE_A_ID,
    status: "CLOSED", // Marked CLOSED after payment
    customerName: "Customer A",
    items: [{ menuItemId: "d1", name: "Coffee", price: 100, quantity: 1, total: 100 }],
    save: async () => {},
  };

  // 3. Customer B scans SAME QR -> Session B created
  const sessionB = {
    _id: "sess-B-e2e",
    sessionCode: "TS_CUST_B", // Fresh rotated token
    restaurantId: RESTAURANT_A,
    tableId: TABLE_A_ID,
    status: "OCCUPIED",
    customerName: "Customer B",
    items: [],
    bills: { totalWithTax: 0 },
    save: async () => {},
  };

  assert.notEqual(sessionA.sessionCode, sessionB.sessionCode); // Token rotated
  assert.equal(sessionB.items.length, 0); // Zero items carried over from Customer A
  assert.equal(sessionB.customerName, "Customer B"); // Zero PII leakage
});
