const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const USER_ID = "507f1f77bcf86cd799439022";
const TABLE_ID = "507f1f77bcf86cd799439099";

const mockUser = {
  _id: USER_ID,
  role: "Owner",
  phone: "9876543210",
  restaurantId: RESTAURANT_ID,
  storeId: "123456",
};

test("Manage Tables Module 2: generateSecureToken creates 64-char non-guessable hex string", () => {
  const { generateSecureToken } = require("../controllers/tableQRController");
  const token1 = generateSecureToken();
  const token2 = generateSecureToken();

  assert.equal(token1.length, 64);
  assert.equal(token2.length, 64);
  assert.notEqual(token1, token2);
  assert.match(token1, /^[a-f0-9]{64}$/i);
});

test("Manage Tables Module 2: QR URL is opaque and does NOT leak table keyword or store credentials", async () => {
  const activeToken = "a".repeat(64);
  const mockTable = {
    _id: TABLE_ID,
    tableNumber: 1,
    displayId: "GF-T1",
    capacity: 4,
    restaurantId: RESTAURANT_ID,
  };
  const mockQr = {
    _id: "qr-1",
    token: activeToken,
    status: "ACTIVE",
    label: "Table 1",
    qrUrl: `http://localhost:5173/t/${activeToken}`,
    tableId: TABLE_ID,
    restaurantId: RESTAURANT_ID,
    toObject: () => ({ token: activeToken, status: "ACTIVE", qrUrl: `http://localhost:5173/t/${activeToken}` }),
  };

  const TableQR = {
    findOne: async () => mockQr,
  };
  const Table = {
    findOne: async () => mockTable,
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableQRModel") return TableQR;
    if (r === "../models/tableModel") return Table;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableQRController")];
  const { resolveQrToken } = require("../controllers/tableQRController");

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

  try {
    await resolveQrToken({ params: { token: activeToken } }, res, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(resData);
  assert.equal(resData.data.token, activeToken);
  // Verify opaque URL does NOT leak "GF-T1" in the URL string
  assert.equal(resData.data.qrUrl.includes("GF-T1"), false);
  assert.equal(resData.data.qrUrl.includes(RESTAURANT_ID), false);
});

test("Manage Tables Module 2: QR regeneration revokes old ACTIVE QR and invalidates previous token", async () => {
  let revokedCount = 0;
  let createdNewQr = null;

  const mockTable = {
    _id: TABLE_ID,
    tableNumber: 1,
    displayId: "GF-T1",
    capacity: 4,
    restaurantId: RESTAURANT_ID,
  };

  const TableQRMock = {
    updateMany: async (filter, update) => {
      if (filter.status === "ACTIVE") revokedCount++;
    },
    create: async (doc) => {
      createdNewQr = doc;
      return { _id: "qr-new", toObject: () => doc, ...doc };
    },
  };

  const TableMock = {
    findOne: async () => mockTable,
    updateOne: async () => {},
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableQRModel") return TableQRMock;
    if (r === "../models/tableModel") return TableMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableQRController")];
  const { regenerateQr } = require("../controllers/tableQRController");

  let resData = null;
  const res = {
    status: (code) => {
      assert.equal(code, 201);
      return res;
    },
    json: (payload) => {
      resData = payload;
    },
  };

  const req = {
    user: mockUser,
    params: { tableId: TABLE_ID },
  };

  try {
    await regenerateQr(req, res, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(resData);
  assert.equal(revokedCount, 1); // Old QR revoked
  assert.ok(createdNewQr);
  assert.equal(createdNewQr.token.length, 64);
  assert.equal(createdNewQr.status, "ACTIVE");
});
