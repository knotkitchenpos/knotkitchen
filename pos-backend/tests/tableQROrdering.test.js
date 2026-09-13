const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const crypto = require("crypto");

beforeEach(() => {
  // Fresh per-test state — tables persist, all dynamic records reset
  for (const t of db.tables) {
    t.status = "available";
    t.currentOccupancy = 0;
    t.currentOrderId = null;
    t.waiterCallActive = false;
  }
  db.sessions = [];
  db.orders = [];
  db.bills = [];
  db.qrs = [];
});

// ============================================================
// In-memory store to simulate QR tokens, tables, sessions,
// kitchen orders and bills.
// ============================================================
const db = {
  qrs: [],
  tables: [],
  sessions: [],
  orders: [],
  bills: [],
  _nextId: 1,
};

const newId = () => {
  const hex = db._nextId.toString(16).padStart(24, "0");
  db._nextId++;
  return hex;
};

const makeToken = () => crypto.randomBytes(32).toString("hex");
const generateSessionAccessToken = () => crypto.randomBytes(24).toString("hex");

const TABLES = {
  4: { _id: newId(), tableNumber: 4, capacity: 4 },
  5: { _id: newId(), tableNumber: 5, capacity: 6 },
};

// Table 4 (capacity 4) and Table 5 (capacity 6) — QR ordering enabled
db.tables.push({
  _id: TABLES[4]._id,
  tableNumber: 4,
  capacity: 4,
  currentOccupancy: 0,
  status: "available",
  restaurantId: "rest-A",
  outletId: "outlet-A",
  qrEnabled: true,
  isDeleted: false,
});
db.tables.push({
  _id: TABLES[5]._id,
  tableNumber: 5,
  capacity: 6,
  currentOccupancy: 0,
  status: "available",
  restaurantId: "rest-A",
  outletId: "outlet-A",
  qrEnabled: true,
  isDeleted: false,
});

// ============================================================
// Model mocks (Module._load interception)
// ============================================================

/** Mongoose query-chain emulation: `Model.findOne(...).session(ms)`
 * and `await query` both work. */
const makeThenable = (value) => {
  const q = {
    session() { return q; },
    lean() { return q; },
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

const TableQRMock = {
  async findOne(q) {
    const { token, status } = q;
    return (
      db.qrs.find(
        (x) => x.token === token && x.status === status && !x.isDeleted
      ) || null
    );
  },
  async create(doc) {
    const qr = {
      _id: newId(),
      ...doc,
      status: "ACTIVE",
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject() { return { ...this }; },
      async save() { return this; },
    };
    db.qrs.push(qr);
    return qr;
  },
};

const TableMock = {
  findOne(query) {
    const { _id } = query || {};
    const result = db.tables.find((t) => {
      if (_id && t._id !== _id) return false;
      return !t.isDeleted;
    });
    return makeThenable(result ? toLiveTable(result) : null);
  },
  async findOneAndUpdate() {
    return null;
  },
};

// A table QR serves the SYSTEM PUBLISHED snapshot, so these fixtures carry
// one — a category with only draft items is invisible to a diner by design
// (see services/menuCache.js). `items` mirrors the snapshot here because these
// categories have no unpublished edits pending.
const menuCategory = (id, name, price, category) => {
  const item = { _id: id, name, price, category, isAvailable: true };
  return {
    _id: id,
    name,
    price,
    category,
    restaurantId: "rest-A",
    outletId: "outlet-A",
    isDeleted: false,
    published: true,
    items: [item],
    hasPublishedToSystem: true,
    systemSnapshot: { name, items: [item] },
    hasPublishedToWebsite: true,
    websiteSnapshot: { name, items: [item] },
  };
};

const MenuMock = {
  async find() {
    return [
      menuCategory("menu_biryani", "Biryani", 250, "Main"),
      menuCategory("menu_water", "Water", 20, "Beverages"),
      menuCategory("menu_kebab", "Kebab", 300, "Starters"),
    ];
  },
};

const RestaurantMock = {
  findOne() {
    const doc = {
      _id: "rest-A",
      name: "Knot Kitchen",
      currency: "INR",
      branding: { primaryColor: "#5b45b0" },
      address: { line1: "1 Main Road", city: "Kolkata" },
      isDeleted: false,
    };
    return makeThenable(doc); // supports `.lean()` chain
  },
};

const TableSessionMock = {
  findOne(query) {
    const { tableId, restaurantId, status, isDeleted } = query || {};
    const result = db.sessions.find((s) => {
      if (tableId && s.tableId !== tableId) return false;
      if (restaurantId && s.restaurantId !== restaurantId) return false;
      if (isDeleted) {
        if (isDeleted.$ne === true && s.isDeleted === true) return false;
      }
      if (status) {
        if (Array.isArray(status.$in)) {
          if (!status.$in.includes(s.status)) return false;
        } else if (s.status !== status) return false;
      }
      return true;
    });
    // Returns thenable chain (`.session(ms)`, `.lean()`, `await`) like Mongoose
    return makeThenable(result ? toLiveSession(result) : null);
  },

  async find() {
    return db.sessions.slice().map((s) => JSON.parse(JSON.stringify(s)));
  },

  async create(docs) {
    const arr = Array.isArray(docs) ? docs : [docs];
    const created = arr.map((doc) => {
      const s = toLiveSession({
        _id: newId(),
        sessionCode: doc.sessionCode,
        // The diner's claim on this session. Allowlisted here like every
        // other field: a mock that silently dropped it would let a route
        // which never stores it pass.
        accessToken: doc.accessToken || "",
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
        payment: doc.payment || { method: "", status: "PENDING", transactionId: "", paidAt: null },
        paymentHistory: [],
        timeline: doc.timeline || [],
        openedAt: new Date(),
        openedBy: null,
        closedBy: null,
        closedAt: null,
        billRequestedAt: null,
        paymentRequestedAt: null,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      db.sessions.push(s);
      return s;
    });
    return created;
  },

  async save() {},
};

/**
 * Orders created during a test, so the "is this table already mid-meal?"
 * lookup can find one. QR additions must land on the SAME order rather than
 * opening a second ticket for one table.
 */
const orderStore = [];

const OrderMock = {
  // Chainable: the route does findOne(...).sort(...).session(...).
  findOne(query = {}) {
    const chain = {
      sort: () => chain,
      session: () => chain,
      then: (resolve, reject) => Promise.resolve(chain._resolve()).then(resolve, reject),
      _resolve() {
        // Only the open-order lookup passes tableSessionId; everything else
        // (the requestId dedupe) still finds nothing, as before.
        if (!query.tableSessionId) return null;
        return (
          orderStore.find((o) => String(o.tableSessionId) === String(query.tableSessionId)) || null
        );
      },
    };
    return chain;
  },
  async create(docs) {
    const arr = Array.isArray(docs) ? docs : [docs];
    const created = arr.map((d) => ({
      _id: newId(),
      ...d,
      items: d.items.map((it) => ({ _id: newId(), ...it })),
      createdAt: new Date(),
      updatedAt: new Date(),
      async save() { return this; },
    }));
    orderStore.push(...created);
    return created;
  },
  async findById(id) {
    return orderStore.find((o) => String(o._id) === String(id)) || null;
  },
};

const BillMock = {
  async findOne() {
    return null;
  },
  async create(docs) {
    const arr = Array.isArray(docs) ? docs : [docs];
    return arr.map((d) => ({
      _id: newId(),
      ...d,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  },
};

// ============================================================
// Service + mongoose mocks
// ============================================================
const priceMock = {
  async resolveMenuItem({ menuItemId, restaurantId }) {
    const all = await MenuMock.find();
    const found = all.find(
      (m) => m._id === menuItemId && m.restaurantId === restaurantId
    );
    if (!found) {
      const err = new Error(`Menu item ${menuItemId} not found!`);
      err.status = 404;
      throw err;
    }
    return { item: found };
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

const fakeMongoSession = {
  startTransaction() {},
  async commitTransaction() {},
  async abortTransaction() {},
  endSession() {},
};

const mongooseMock = {
  Types: {
    ObjectId: {
      isValid: (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id),
    },
  },
  async startSession() {
    return { ...fakeMongoSession };
  },
};

// ============================================================
// Session controller helpers (same logic as the real controller,
// simplified for unit testing)
// ============================================================
const generateSessionCode = () =>
  `TS_TEST_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const validateCapacity = (table, customerCount) => {
  const capacity = Number(table.capacity) || 4;
  let count = Number(customerCount);
  if (isNaN(count) || count < 1) count = 1;
  if (count > capacity) {
    const err = new Error(
      `Table ${table.tableNumber} has a maximum capacity of ${capacity} customers.`
    );
    err.status = 400;
    throw err;
  }
  return count;
};

const enrichItems = async ({ items, restaurantId, outletId, addedBy = "SYSTEM" }) => {
  if (!items || !items.length) {
    const err = new Error("At least one item is required!");
    err.status = 400;
    throw err;
  }
  const validated = [];
  for (const rawItem of items) {
    if (!rawItem.menuItemId) {
      const err = new Error("Each item must have menuItemId!");
      err.status = 400;
      throw err;
    }
    if (!rawItem.quantity || rawItem.quantity < 1) {
      const err = new Error("Quantity must be at least 1!");
      err.status = 400;
      throw err;
    }
    const { item } = await priceMock.resolveMenuItem({
      menuItemId: rawItem.menuItemId,
      restaurantId,
      outletId,
    });
    const { unitPrice, modifiers } = priceMock.calculateUnitPrice({ item });
    validated.push({
      menuItemId: item._id,
      name: item.name,
      quantity: Number(rawItem.quantity),
      price: unitPrice,
      total: Math.round(unitPrice * Number(rawItem.quantity) * 100) / 100,
      modifiers,
      note: rawItem.note || "",
      addedBy,
      status: "pending",
    });
  }
  return validated;
};

const recalculateSessionBill = async (session) => {
  const bills = priceMock.calculateBill({
    items: session.items
      .filter((i) => i.status !== "cancelled")
      .map((i) => ({ price: i.price, quantity: i.quantity })),
    discount: session.bills?.discount || 0,
    additionalCharges: session.bills?.charges || 0,
  });
  session.bills = bills;
  await session.save();
  return session;
};

const runWithSessionRetry = async (work) => {
  const mongoSession = await mongooseMock.startSession();
  mongoSession.startTransaction();
  try {
    const result = await work(mongoSession);
    await mongoSession.commitTransaction();
    return { result, mongoSession };
  } finally {
    mongoSession.endSession();
  }
};

const sessionControllerMock = {
  findActiveSessionByTable: async ({ tableId, restaurantId }) => {
    const s = db.sessions.find(
      (x) =>
        x.tableId === tableId &&
        x.restaurantId === restaurantId &&
        ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"].includes(x.status) &&
        !x.isDeleted
    );
    return s || null;
  },
  validateCapacity,
  enrichItems,
  recalculateSessionBill,
  runWithSessionRetry,
  generateSessionCode,
  generateSessionAccessToken,
};

// ============================================================
// Auth middleware mock — resolves table scope from token only,
// exactly like the real resolveTableScope.
// ============================================================
const resolveTableScopeMock = async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!token) {
      const err = new Error("QR token is required.");
      err.status = 400;
      return next(err);
    }
    const qr = db.qrs.find((x) => x.token === token && x.status === "ACTIVE" && !x.isDeleted);
    if (!qr) {
      const err = new Error("Invalid QR code.");
      err.status = 404;
      return next(err);
    }
    const table = db.tables.find((t) => t._id === qr.tableId && !t.isDeleted);
    if (!table) {
      const err = new Error("Table not found!");
      err.status = 404;
      return next(err);
    }
    req.scope = {
      restaurantId: qr.restaurantId || table.restaurantId,
      outletId: qr.outletId || table.outletId,
      table,
    };
    next();
  } catch (error) {
    next(error);
  }
};

const tokenVerificationMock = {
  isVerifiedUser: async (req, res, next) => next(),
  resolveTableScope: resolveTableScopeMock,
};

// ============================================================
// Load the actual qrRoute with mocked dependencies
// ============================================================
function loadQrRoute() {
  const orig = Module._load;
  Module._load = function (r, p, m) {
    // No pre-bookings in these scenarios.
    if (/tableBookingController$/.test(r)) return { findActiveBlock: async () => null, blockedError: () => new Error("blocked"), formatTimeOf: () => "", upcomingBookingsByTable: async () => ({}) };
    if (r === "../middlewares/tokenVerification") return tokenVerificationMock;
    if (r === "../models/tableModel") return TableMock;
    if (r === "../models/menuModel") return MenuMock;
    if (r === "../models/orderModel") return OrderMock;
    if (r === "../models/tableSessionModel") return TableSessionMock;
    if (r === "../models/billModel") return BillMock;
    if (r === "../models/restaurantModel") return RestaurantMock;
    if (r === "../models/tableQRModel") return TableQRMock;
    if (r === "../services/price") return priceMock;
    if (r === "mongoose") return mongooseMock;
    if (r === "../controllers/tableSessionController") return sessionControllerMock;
    return orig.apply(this, arguments);
  };
  const router = require("../routes/qrRoute");
  Module._load = orig;
  return router;
}

/**
 * Executes the full Express route chain for a path+method — including
 * middleware (resolveTableScope). Runs each handler in sequence with
 * an Express-style `next(err)` continuation.
 */
async function callRoute(router, path, method, req) {
  const res = {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; },
  };
  const entry = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  assert.ok(entry, `Route ${method.toUpperCase()} ${path} not found`);
  const handlers = entry.route.stack
    .filter((h) => h.method === method)
    .map((h) => h.handle);

  let error = null;
  let terminated = false;
  const next = (err) => {
    if (err) {
      error = err;
      terminated = true;
    }
  };

  for (const h of handlers) {
    terminated = false;
    // Middleware like resolveTableScope calls next() to continue the chain;
    // terminal handlers simply complete (async) without calling next.
    await h(req, res, next);
    if (error) throw error;
    if (terminated) break; // chain short-circuited (final res.json or error)
  }
  return { statusCode: res.statusCode, body: res.body };
}

const createQrForTable = async (tableId) => {
  const token = makeToken();
  await TableQRMock.create({
    token,
    restaurantId: "rest-A",
    outletId: "outlet-A",
    tableId,
    status: "ACTIVE",
    qrUrl: `http://localhost:5173/order?table=${token}`,
    label: "Table X",
  });
  return token;
};

const seedSession = async ({
  tableId,
  status = "OCCUPIED",
  items = [],
  customerCount = 1,
}) => {
  const [session] = await TableSessionMock.create([
    {
      sessionCode: generateSessionCode(),
      accessToken: generateSessionAccessToken(),
      restaurantId: "rest-A",
      outletId: "outlet-A",
      tableId,
      source: "QR",
      status,
      customerCount,
      customerName: "",
      customerPhone: "",
      items,
      bills: { subtotal: 0, tax: 0, discount: 0, charges: 0, totalWithTax: 0 },
    },
  ]);
  await recalculateSessionBill(session);
  return session;
};

// ============================================================
// Tests
// ============================================================

test("GET /table/:token returns restaurant + menu + full active session (Flow 1: table first)", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id);

  // Seed an active session with a Biryani item — e.g. opened from POS or a prior QR order
  const biryani = await enrichItems({
    items: [{ menuItemId: "menu_biryani", quantity: 2 }],
    restaurantId: "rest-A",
    outletId: "outlet-A",
    addedBy: "QR",
  });
  const session = await seedSession({
    tableId: TABLES[4]._id,
    items: biryani,
    customerCount: 2,
  });

  const { statusCode, body } = await callRoute(router, "/table/:token", "get", {
    params: { token },
  });

  assert.equal(statusCode, 200);
  assert.equal(body.data.table.tableNumber, 4);
  assert.equal(body.data.table.capacity, 4);
  assert.equal(body.data.restaurant.name, "Knot Kitchen");
  assert.equal(body.data.menu.length, 3);
  assert.ok(body.data.activeSession, "activeSession should be present");
  assert.equal(body.data.activeSession.status, "OCCUPIED");
  assert.equal(body.data.activeSession.customerCount, 2);
  assert.equal(body.data.activeSession.items.length, 1);
  assert.equal(body.data.activeSession.items[0].name, "Biryani");
  assert.equal(body.data.activeSession.items[0].quantity, 2);
  assert.ok(body.data.activeSession.bills.totalWithTax > 0, "running total should be > 0");
  assert.equal(session.status, "OCCUPIED");
});

test("GET /table/:token returns activeSession null when table is idle", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[5]._id);
  const { body } = await callRoute(router, "/table/:token", "get", {
    params: { token },
  });
  assert.equal(body.data.activeSession, null);
});

test("POST /session/items/:token creates a session and stays OCCUPIED (Flow 2: items first)", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id);

  const { statusCode, body } = await callRoute(
    router,
    "/session/items/:token",
    "post",
    {
      params: { token },
      body: {
        items: [{ menuItemId: "menu_biryani", quantity: 1 }],
        customerCount: 2,
        customerName: "Rahul",
        customerPhone: "9876543210",
        requestId: crypto.randomUUID(),
      },
    }
  );

  assert.equal(statusCode, 201);
  assert.equal(body.success, true);
  assert.equal(body.data.created, true);
  assert.equal(body.data.session.status, "OCCUPIED");
  assert.equal(body.data.session.customerCount, 2);
  assert.equal(body.data.session.items.length, 1);
  assert.equal(body.data.session.items[0].name, "Biryani");
  assert.ok(body.data.session.bills.totalWithTax > 0);

  // Table must be marked occupied
  const table = db.tables.find((t) => t._id === TABLES[4]._id);
  assert.equal(table.status, "occupied");

  // Exactly ONE session exists for table 4
  const sessionsForTable = db.sessions.filter((s) => s.tableId === TABLES[4]._id);
  assert.equal(sessionsForTable.length, 1);
});

test("adding additional items reuses the SAME active session (Water added to Biryani)", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id);

  // First order: Biryani
  await callRoute(router, "/session/items/:token", "post", {
    params: { token },
    body: {
      items: [{ menuItemId: "menu_biryani", quantity: 1 }],
      customerCount: 2,
      customerName: "Rahul",
      customerPhone: "9876543210",
      requestId: crypto.randomUUID(),
    },
  });

  const firstSession = db.sessions.find((s) => s.tableId === TABLES[4]._id);
  assert.ok(firstSession, "first order should create a session");
  const firstItemCount = firstSession.items.length;

  // Second order later: Water — must append to the SAME session
  await callRoute(router, "/session/items/:token", "post", {
    params: { token },
    body: {
      items: [{ menuItemId: "menu_water", quantity: 1 }],
      customerCount: 2,
      customerName: "Rahul",
      customerPhone: "9876543210",
      requestId: crypto.randomUUID(),
    },
  });

  const sessionsForTable = db.sessions.filter((s) => s.tableId === TABLES[4]._id);
  assert.equal(sessionsForTable.length, 1, "must NOT create a second session");
  const session = sessionsForTable[0];
  assert.equal(session._id, firstSession._id, "same session id must remain active");
  assert.equal(session.items.length, firstItemCount + 1, "Water should be appended");
  assert.equal(session.items[firstItemCount].name, "Water");
  assert.equal(session.status, "OCCUPIED");
  assert.ok(session.bills.totalWithTax > 0, "running total includes both items");
});

test("POST /session/items/:token rejects customerCount above capacity", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id); // capacity 4

  let error = null;
  try {
    await callRoute(router, "/session/items/:token", "post", {
      params: { token },
      body: {
        items: [{ menuItemId: "menu_biryani", quantity: 1 }],
        customerCount: 5, // exceeds capacity 4
        customerName: "Rahul",
        customerPhone: "9876543210",
        requestId: crypto.randomUUID(),
      },
    });
  } catch (e) {
    error = e;
  }

  assert.ok(error, "capacity violation must throw");
  assert.equal(error.status, 400);
  assert.match(error.message, /maximum capacity of 4/);

  // No session should be created on failure
  assert.equal(db.sessions.filter((s) => s.tableId === TABLES[4]._id).length, 0);
});

test("GET /session/:token returns full active session for re-scan (existing items, bill, status)", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id);

  const items = await enrichItems({
    items: [
      { menuItemId: "menu_biryani", quantity: 1 },
      { menuItemId: "menu_water", quantity: 2 },
    ],
    restaurantId: "rest-A",
    outletId: "outlet-A",
    addedBy: "QR",
  });
  await seedSession({ tableId: TABLES[4]._id, items, customerCount: 2 });

  const { statusCode, body } = await callRoute(router, "/session/:token", "get", {
    params: { token },
  });

  assert.equal(statusCode, 200);
  assert.equal(body.data.session.status, "OCCUPIED");
  assert.equal(body.data.session.customerCount, 2);
  assert.equal(body.data.session.items.length, 2);
  const names = body.data.session.items.map((i) => i.name).sort();
  assert.deepEqual(names, ["Biryani", "Water"]);
  assert.ok(body.data.session.bills.subtotal > 0);
  assert.ok(body.data.session.bills.totalWithTax > 0);

  // Not exposing internal tenant/outlet fields
  assert.equal(body.data.session.restaurantId, undefined);
  assert.equal(body.data.session.outletId, undefined);
  assert.equal(body.data.session.tableId, undefined);
});

test("GET /session/:token returns 404 when no active session", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[5]._id);
  const { statusCode, body } = await callRoute(router, "/session/:token", "get", {
    params: { token },
  });
  assert.equal(statusCode, 404);
  assert.equal(body.message, "No active session for this table.");
});

test("POST /request-bill/:token is token-scoped — cannot touch another table's session (no IDOR)", async () => {
  const router = loadQrRoute();

  // Table 4 session: Biryani
  const token4 = await createQrForTable(TABLES[4]._id);
  const items4 = await enrichItems({
    items: [{ menuItemId: "menu_biryani", quantity: 1 }],
    restaurantId: "rest-A",
    outletId: "outlet-A",
    addedBy: "QR",
  });
  const session4 = await seedSession({ tableId: TABLES[4]._id, items: items4, customerCount: 2 });

  // Table 5 session — must remain untouched
  const token5 = await createQrForTable(TABLES[5]._id);
  const items5 = await enrichItems({
    items: [{ menuItemId: "menu_kebab", quantity: 1 }],
    restaurantId: "rest-A",
    outletId: "outlet-A",
    addedBy: "QR",
  });
  const session5 = await seedSession({ tableId: TABLES[5]._id, items: items5, customerCount: 2 });

  // Customer at Table 4 requests bill; client tries to forge another sessionId
  // in the body — the handler must IGNORE it and resolve from the token.
  await callRoute(router, "/request-bill/:token", "post", {
    params: { token: token4 },
    body: { sessionId: session5._id }, // malicious forge attempt
  });

  // Table 4 session got the bill request
  const updated4 = db.sessions.find((s) => s._id === session4._id);
  assert.equal(updated4.status, "BILL_REQUESTED");

  // Table 5 session was NOT modified
  const updated5 = db.sessions.find((s) => s._id === session5._id);
  assert.equal(updated5.status, "OCCUPIED");

  // Fresh resolution of table 4's token still hits table 4's session
  assert.equal(updated4.tableId, TABLES[4]._id);
});

test("POST /payment-intent/:token moves session to PAYMENT_PENDING WITHOUT settling the table (bill stays open)", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id);

  const items = await enrichItems({
    items: [{ menuItemId: "menu_biryani", quantity: 2 }],
    restaurantId: "rest-A",
    outletId: "outlet-A",
    addedBy: "QR",
  });
  const session = await seedSession({ tableId: TABLES[4]._id, items, customerCount: 2 });
  const before = session.bills.totalWithTax;

  const { statusCode, body } = await callRoute(
    router,
    "/payment-intent/:token",
    "post",
    {
      params: { token },
    }
  );

  assert.equal(statusCode, 200);
  assert.equal(body.data.sessionId, session._id);
  assert.equal(body.data.amount, before, "payable amount matches running total");
  assert.equal(body.data.paymentStatus, "PENDING");

  // Payment selected by the customer → PAYMENT_PENDING, but NOT settled.
  // The table remains occupied and the bill stays open.
  const after = db.sessions.find((s) => s._id === session._id);
  assert.equal(after.status, "PAYMENT_PENDING", "customer selecting payment moves session to PAYMENT_PENDING");
  assert.ok(["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"].includes(after.status));
  assert.equal(after.status === "PAID", false, "session must NOT be PAID");
  assert.equal(after.status === "CLOSED", false, "session must NOT be CLOSED");
  assert.equal(after.bills.totalWithTax, before, "bill totals unchanged");
  assert.equal(after.payment.status, "PENDING");
});

test("QR token for Table 4 can never resolve to Table 5's session", async () => {
  const router = loadQrRoute();

  const token4 = await createQrForTable(TABLES[4]._id);
  const items4 = await enrichItems({
    items: [{ menuItemId: "menu_biryani", quantity: 1 }],
    restaurantId: "rest-A",
    outletId: "outlet-A",
    addedBy: "QR",
  });
  await seedSession({ tableId: TABLES[4]._id, items: items4, customerCount: 2 });

  const items5 = await enrichItems({
    items: [{ menuItemId: "menu_kebab", quantity: 1 }],
    restaurantId: "rest-A",
    outletId: "outlet-A",
    addedBy: "QR",
  });
  await seedSession({ tableId: TABLES[5]._id, items: items5, customerCount: 2 });

  const { body } = await callRoute(router, "/session/:token", "get", {
    params: { token: token4 },
  });

  // Even though Table 5 has its own session, Table 4's token only ever
  // returns the session bound to Table 4.
  const returnedSession = db.sessions.find((s) => s._id === body.data.session._id);
  assert.equal(returnedSession.tableId, TABLES[4]._id);
  assert.equal(body.data.session.items[0].name, "Biryani");
});
test("REGRESSION: a second QR round appends to the SAME order, never a new one", async () => {
  // Every submission used to call Order.create, giving one table two kitchen
  // tickets and two POS cards against a single bill.
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[5]._id);
  const before = orderStore.length;

  // Opening the table carries the diner's details; the second round below
  // deliberately carries none, because a scan that JOINS an open session is
  // never asked for them again.
  const first = await callRoute(router, "/session/items/:token", "post", {
    params: { token },
    body: {
      items: [{ menuItemId: "menu_biryani", quantity: 1 }],
      customerName: "Asmit",
      customerPhone: "9876543210",
    },
  });
  assert.equal(first.statusCode, 201);
  const createdOrders = orderStore.length - before;
  assert.equal(createdOrders, 1, "the first round opens exactly one order");
  const orderId = String(orderStore[orderStore.length - 1]._id);

  const second = await callRoute(router, "/session/items/:token", "post", {
    params: { token },
    body: { items: [{ menuItemId: "menu_water", quantity: 1 }] },
  });
  assert.equal(second.statusCode, 201);
  assert.equal(orderStore.length - before, 1, "the second round must NOT create another order");

  const order = orderStore.find((o) => String(o._id) === orderId);
  assert.equal(order.items.length, 2, "both rounds live on one ticket");

  // The addition waits for the till rather than going straight to the kitchen.
  const pending = order.items.filter((i) => i.status === "pending");
  assert.equal(pending.length, 2, "added items arrive as a request");
});


// ============================================================
// The session claim
//
// The QR stuck to the table is permanent, so the link it opens is permanent
// too. A diner who ate here last week still has that link on their phone, and
// it used to open whatever session was live at that table: the current
// party's name, phone and running bill, with the ability to add dishes to it,
// request its bill and open a payment against it.
//
// A session now mints an accessToken. It names ONE session and dies with it.
// ============================================================

test("REGRESSION: a saved link from an earlier sitting cannot read the party sitting there now", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id);

  // Last week's diner. Their session was settled and is gone.
  const spentClaim = generateSessionAccessToken();

  // Tonight's party, with their name, phone and running bill on the table.
  await seedSession({
    tableId: TABLES[4]._id,
    items: await enrichItems({
      items: [{ menuItemId: "menu_biryani", quantity: 2 }],
      restaurantId: "rest-A",
      outletId: "outlet-A",
      addedBy: "QR",
    }),
  });

  const { statusCode, body } = await callRoute(router, "/table/:token", "get", {
    params: { token },
    query: { s: spentClaim },
  });

  assert.equal(statusCode, 200, "the menu still loads -- only the session is withheld");
  assert.equal(body.data.activeSession, null, "the current party's order must not be readable");
  assert.equal(body.data.sessionExpired, true);
  assert.equal(body.data.sessionToken, "", "and no claim is handed to them");
});

test("a fresh scan carries no claim, joins the live session, and is issued its token", async () => {
  // A second phone at the same table orders onto the same bill. This is the
  // case that must NOT break, and the reason an absent claim is not refused.
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id);
  const session = await seedSession({ tableId: TABLES[4]._id });

  const { body } = await callRoute(router, "/table/:token", "get", { params: { token } });

  assert.ok(body.data.activeSession, "the live session is visible to a fresh scan");
  assert.equal(body.data.sessionExpired, false);
  assert.equal(body.data.sessionToken, session.accessToken);
});

test("the right claim still sees everything", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id);
  const session = await seedSession({ tableId: TABLES[4]._id, customerCount: 3 });

  const { body } = await callRoute(router, "/table/:token", "get", {
    params: { token },
    query: { s: session.accessToken },
  });

  assert.equal(body.data.sessionExpired, false);
  assert.equal(body.data.activeSession.customerCount, 3);
});

test("REGRESSION: a spent claim cannot add dishes to the next party's bill", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id);
  const session = await seedSession({ tableId: TABLES[4]._id });
  const itemsBefore = session.items.length;

  const err = await callRoute(router, "/session/items/:token", "post", {
    params: { token },
    body: {
      items: [{ menuItemId: "menu_biryani", quantity: 1 }],
      sessionToken: generateSessionAccessToken(),
    },
  }).then(() => null, (e) => e);

  assert.ok(err, "the write must be refused");
  assert.equal(err.status || err.statusCode, 409);
  assert.match(err.message, /scan the QR code again/i);
  assert.equal(session.items.length, itemsBefore, "and nothing reaches the bill");
});

test("REGRESSION: a spent claim does not open a brand new session either", async () => {
  // The table is empty. Without the check the stale link would simply start a
  // session of its own -- a party that is not in the restaurant, opening a
  // table nobody is sitting at.
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[5]._id);
  const before = db.sessions.length;

  const err = await callRoute(router, "/session/items/:token", "post", {
    params: { token },
    body: {
      items: [{ menuItemId: "menu_biryani", quantity: 1 }],
      customerName: "Old Customer",
      customerPhone: "9876543210",
      sessionToken: generateSessionAccessToken(),
    },
  }).then(() => null, (e) => e);

  assert.ok(err);
  assert.equal(err.status || err.statusCode, 409);
  assert.equal(db.sessions.length, before, "no session was opened");
});

test("opening a table mints a claim, and a later session gets a different one", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id);

  const first = await callRoute(router, "/session/items/:token", "post", {
    params: { token },
    body: {
      items: [{ menuItemId: "menu_biryani", quantity: 1 }],
      customerName: "First Party",
      customerPhone: "9000000001",
    },
  });
  assert.equal(first.statusCode, 201);
  const firstClaim = first.body.data.sessionToken;
  assert.match(firstClaim, /^[a-f0-9]{48}$/, "a real secret, not a guessable code");

  // They pay and leave.
  const settled = db.sessions.find((x) => x.accessToken === firstClaim);
  settled.status = "PAID";

  const second = await callRoute(router, "/session/items/:token", "post", {
    params: { token },
    body: {
      items: [{ menuItemId: "menu_water", quantity: 1 }],
      customerName: "Second Party",
      customerPhone: "9000000002",
    },
  });
  assert.equal(second.statusCode, 201);
  assert.notEqual(second.body.data.sessionToken, firstClaim, "the claim changes with the party");
});

test("the claim is NOT the sessionCode, which is printed on the bill", async () => {
  // BL_<sessionCode> goes on the customer's receipt. Reusing it as the claim
  // would hand it to anyone who saw a printed bill.
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id);
  const session = await seedSession({ tableId: TABLES[4]._id });

  const { body } = await callRoute(router, "/table/:token", "get", { params: { token } });
  assert.notEqual(body.data.sessionToken, session.sessionCode);

  const withCode = await callRoute(router, "/table/:token", "get", {
    params: { token },
    query: { s: session.sessionCode },
  });
  assert.equal(withCode.body.data.activeSession, null, "a receipt does not buy access");
  assert.equal(withCode.body.data.sessionExpired, true);
});

test("a spent claim cannot force the bill or start a payment on someone else's table", async () => {
  const router = loadQrRoute();
  const token = await createQrForTable(TABLES[4]._id);
  const session = await seedSession({ tableId: TABLES[4]._id });
  const spent = generateSessionAccessToken();

  for (const path of ["/request-bill/:token", "/payment-intent/:token"]) {
    const err = await callRoute(router, path, "post", {
      params: { token },
      body: { sessionToken: spent },
    }).then(() => null, (e) => e);
    assert.ok(err, path + " accepted a spent claim");
    assert.equal(err.status || err.statusCode, 409);
  }
  assert.equal(session.status, "OCCUPIED", "the party's session is untouched");
});
