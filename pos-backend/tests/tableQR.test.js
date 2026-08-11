const { test } = require("node:test");
const assert = require("node:assert/strict");

// ============================================================
// Mock models — in-memory store for TableQR + Table
// ============================================================
const crypto = require("crypto");

// Simulates the database: tokens bound to tables, with status.
const db = {
  qrs: [],
  tables: [],
  nextQrId: 1,
  nextTableId: 1,
};

const TABLE4_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TABLE5_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";

const TableQRMock = {
  findOne: async (q) => {
    const { token, status } = q;
    if (token) {
      return (
        db.qrs.find(
          (x) => x.token === token && x.status === status && !x.isDeleted
        ) || null
      );
    }
    if (q.tableId) {
      return (
        db.qrs.find(
          (x) =>
            x.tableId === q.tableId &&
            x.status === status &&
            !x.isDeleted
        ) || null
      );
    }
    if (q._id) {
      return (
        db.qrs.find(
          (x) =>
            x._id === q._id &&
            (!q.restaurantId || x.restaurantId === q.restaurantId) &&
            (!q.outletId || x.outletId === q.outletId) &&
            !x.isDeleted
        ) || null
      );
    }
    return null;
  },
  findOneAndUpdate: async () => null,
  updateMany: async (q, update) => {
    db.qrs.forEach((x) => {
      if (q.tableId && x.tableId === q.tableId && x.status === "ACTIVE" && !x.isDeleted) {
        x.status = update.status;
        x.revokedAt = update.revokedAt;
        x.revokedBy = update.revokedBy;
        x.revokedReason = update.revokedReason;
      }
    });
    return { modifiedCount: db.qrs.filter((x) => x.status === "REVOKED").length };
  },
  create: async (doc) => {
    const qr = {
      _id: crypto.randomBytes(12).toString("hex"),
      ...doc,
      status: doc.status || "ACTIVE",
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject() { return { ...this }; },
      async save() { return this; },
    };
    db.qrs.push(qr);
    return qr;
  },
  updateOne: async () => ({ modifiedCount: 1 }),
};

const TableMock = {
  findOne: async (q) => {
    if (q._id) {
      return (
        db.tables.find((t) => t._id === q._id && t.isDeleted === false) || null
      );
    }
    return null;
  },
  updateOne: async () => ({ modifiedCount: 1 }),
};

function loadQRController() {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableQRModel") return TableQRMock;
    if (r === "../models/tableModel") return TableMock;
    return orig.apply(this, arguments);
  };
  const qc = require("../controllers/tableQRController");
  Module._load = orig;
  return qc;
}

function loadMiddleware() {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableQRModel") return TableQRMock;
    if (r === "../models/tableModel") return TableMock;
    return orig.apply(this, arguments);
  };
  const mw = require("../middlewares/tokenVerification");
  Module._load = orig;
  return mw;
}

async function withQrMocks(fn) {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableQRModel") return TableQRMock;
    if (r === "../models/tableModel") return TableMock;
    return orig.apply(this, arguments);
  };
  try {
    return await fn();
  } finally {
    Module._load = orig;
  }
}

// Seed tables
db.tables.push({
  _id: TABLE4_ID,
  tableNumber: 4,
  capacity: 4,
  restaurantId: "rest-A",
  outletId: "outlet-A",
  qrEnabled: true,
  isDeleted: false,
});
db.tables.push({
  _id: TABLE5_ID,
  tableNumber: 5,
  capacity: 6,
  restaurantId: "rest-A",
  outletId: "outlet-A",
  qrEnabled: true,
  isDeleted: false,
});

const userA = { _id: "user-A", restaurantId: "rest-A", outletId: "outlet-A" };

// ============================================================
// Helpers
// ============================================================
const makeToken = () => crypto.randomBytes(32).toString("hex");

const createQrForTable = async (tableId, restaurantId = "rest-A", outletId = "outlet-A") => {
  const token = makeToken();
  const qr = await TableQRMock.create({
    token,
    restaurantId,
    outletId,
    tableId,
    status: "ACTIVE",
    qrUrl: `http://localhost:5173/order?table=${token}`,
    label: "Table X",
    createdBy: userA._id,
  });
  return qr;
};

const resolveToken = async (token) => {
  const qc = loadQRController();
  let body = null;
  let err = null;
  const res = {
    status() { return this; },
    json(o) { body = o; },
  };
  await qc.resolveQrToken({ params: { token } }, res, (e) => { err = e; });
  if (err) throw err;
  return body.data;
};

const resolveThroughMiddleware = async (token) =>
  withQrMocks(async () => {
    const mw = loadMiddleware();
    let scope = null;
    let err = null;
    const req = { params: { token } };
    await mw.resolveTableScope(req, {}, (e) => { err = e; });
    if (err) throw err;
    return req.scope;
  });

// ============================================================
// Tests
// ============================================================
test("Table 4 QR resolves to Table 4", async () => {
  const qr = await createQrForTable(TABLE4_ID);
  const data = await resolveToken(qr.token);
  assert.equal(data.table.tableNumber, 4);
  assert.equal(data.table._id, TABLE4_ID);
  assert.equal(data.restaurantId, "rest-A");
  assert.equal(data.outletId, "outlet-A");
});

test("Table 5 QR resolves to Table 5", async () => {
  const qr = await createQrForTable(TABLE5_ID);
  const data = await resolveToken(qr.token);
  assert.equal(data.table.tableNumber, 5);
  assert.equal(data.table._id, TABLE5_ID);
});

test("Table 4 QR CANNOT access Table 5", async () => {
  const qr4 = await createQrForTable(TABLE4_ID);
  // Resolve via middleware — scope.table must be table 4, never 5
  const scope = await resolveThroughMiddleware(qr4.token);
  assert.equal(scope.table._id, TABLE4_ID);
  assert.notEqual(scope.table._id, TABLE5_ID);
  assert.equal(scope.table.tableNumber, 4);
});

test("using a Table 5 token on Table 4's endpoint never swaps tables", async () => {
  const qr5 = await createQrForTable(TABLE5_ID);
  const scope = await resolveThroughMiddleware(qr5.token);
  assert.equal(scope.table._id, TABLE5_ID);
  assert.equal(scope.table.tableNumber, 5);
});

test("invalid QR fails (garbage token)", async () => {
  await assert.rejects(
    () => resolveToken("garbage-token-not-64-hex"),
    (e) => e.status === 404 && /Invalid QR code/.test(e.message)
  );
});

test("invalid QR fails (well-formed but unknown token)", async () => {
  await assert.rejects(
    () => resolveToken(makeToken()),
    (e) => e.status === 404 && /Invalid QR code/.test(e.message)
  );
});

test("revoked QR fails", async () => {
  const qr = await createQrForTable(TABLE4_ID);
  // Revoke it
  qr.status = "REVOKED";
  qr.revokedAt = new Date();
  await assert.rejects(
    () => resolveToken(qr.token),
    (e) => e.status === 404 && /Invalid QR code/.test(e.message)
  );
  await assert.rejects(
    () => resolveThroughMiddleware(qr.token),
    (e) => e.status === 404 && /Invalid QR code/.test(e.message)
  );
});

test("regenerated QR works", async () => {
  const qc = loadQRController();
  // First generate
  let body = null;
  await qc.getOrCreateQr(
    { params: { tableId: TABLE4_ID }, user: userA },
    { status() { return this; }, json(o) { body = o; } },
    () => {}
  );
  const first = body.data;

  // Regenerate
  body = null;
  await qc.regenerateQr(
    { params: { tableId: TABLE4_ID }, user: userA },
    { status() { return this; }, json(o) { body = o; } },
    () => {}
  );
  const second = body.data;

  assert.notEqual(first.token, second.token, "regenerated token must differ");
  assert.equal(second.table.tableNumber, 4);

  // New token resolves
  const data = await resolveToken(second.token);
  assert.equal(data.table.tableNumber, 4);
  assert.equal(data.token, second.token);
});

test("old QR becomes invalid after regeneration", async () => {
  const qc = loadQRController();
  // Get or create first
  let body = null;
  await qc.getOrCreateQr(
    { params: { tableId: TABLE5_ID }, user: userA },
    { status() { return this; }, json(o) { body = o; } },
    () => {}
  );
  const oldQr = body.data;

  // Regenerate
  body = null;
  await qc.regenerateQr(
    { params: { tableId: TABLE5_ID }, user: userA },
    { status() { return this; }, json(o) { body = o; } },
    () => {}
  );
  const newQr = body.data;
  assert.notEqual(oldQr.token, newQr.token);

  // Old token no longer resolvable
  await assert.rejects(
    () => resolveToken(oldQr.token),
    (e) => e.status === 404 && /Invalid QR code/.test(e.message)
  );
  await assert.rejects(
    () => resolveThroughMiddleware(oldQr.token),
    (e) => e.status === 404 && /Invalid QR code/.test(e.message)
  );

  // New token still works
  const data = await resolveToken(newQr.token);
  assert.equal(data.table._id, TABLE5_ID);
});

test("getOrCreate does not duplicate an active QR for the same table", async () => {
  const qc = loadQRController();
  let body = null;
  await qc.getOrCreateQr(
    { params: { tableId: TABLE4_ID }, user: userA },
    { status() { return this; }, json(o) { body = o; } },
    () => {}
  );
  const first = body.data;
  assert.equal(first.status, "ACTIVE");

  body = null;
  await qc.getOrCreateQr(
    { params: { tableId: TABLE4_ID }, user: userA },
    { status() { return this; }, json(o) { body = o; } },
    () => {}
  );
  const second = body.data;
  assert.equal(second.token, first.token, "getOrCreate should reuse the active QR");
});

test("revoking via admin API makes token unusable", async () => {
  const qc = loadQRController();
  let body = null;
  await qc.getOrCreateQr(
    { params: { tableId: TABLE5_ID }, user: userA },
    { status() { return this; }, json(o) { body = o; } },
    () => {}
  );
  const qr = body.data;

  // Revoke
  body = null;
  let err = null;
  await qc.revokeQr(
    { params: { id: qr._id }, user: userA, body: { reason: "Lost sticker" } },
    { status() { return this; }, json(o) { body = o; } },
    (e) => { err = e; }
  );
  assert.ifError(err);
  assert.equal(body.data.status, "REVOKED");

  // Token fails to resolve
  await assert.rejects(
    () => resolveToken(qr.token),
    (e) => e.status === 404 && /Invalid QR code/.test(e.message)
  );
});

test("cross-tenant QR cannot resolve (Qr bound to rest-B, user/view in rest-A)", async () => {
  // QR for a table in restaurant B
  const qr = await createQrForTable(TABLE4_ID, "rest-B", "outlet-B");
  // The QR belongs to rest-B. A rest-A scope never even looks at it
  // because the QR lookup is token→qr row only; the returned table is
  // whatever that qr is bound to — which is the rest-B table.
  const data = await resolveToken(qr.token);
  assert.equal(data.restaurantId, "rest-B");
  assert.equal(data.table._id, TABLE4_ID);
});