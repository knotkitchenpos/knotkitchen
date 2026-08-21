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

test("Manage Tables: addTable creates table with custom Display ID, custom floor/area & capacity", async () => {
  let createdTable = null;

  const TableMock = function (doc) {
    this._id = TABLE_ID;
    Object.assign(this, doc);
    this.save = async () => {
      createdTable = this;
      return this;
    };
  };
  TableMock.findOne = () => ({
    sort: () => Promise.resolve(null),
    then: (resolve) => resolve(null),
  });

  const AuditLogMock = { create: async () => {} };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableModel") return TableMock;
    if (r === "../models/auditLogModel") return AuditLogMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableController")];
  delete require.cache[require.resolve("../services/auditService")];
  delete require.cache[require.resolve("../models/auditLogModel")];
  const { addTable } = require("../controllers/tableController");

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
    body: {
      displayId: "GF-T1",
      area: "Ground Floor",
      capacity: 6,
      isEnabled: true,
    },
  };

  try {
    await addTable(req, res, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(resData);
  assert.equal(createdTable.displayId, "GF-T1");
  assert.equal(createdTable.area, "Ground Floor");
  assert.equal(createdTable.capacity, 6);
  assert.equal(createdTable.isEnabled, true);
  assert.ok(createdTable.qrToken);
});

test("Manage Tables: addTable rejects duplicate display ID or table number", async () => {
  const existingTable = { _id: TABLE_ID, displayId: "GF-T1", tableNumber: 1 };

  const TableMock = function () {};
  TableMock.findOne = async () => existingTable;

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableModel") return TableMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableController")];
  const { addTable } = require("../controllers/tableController");

  let errorCaught = null;
  const req = {
    user: mockUser,
    body: { displayId: "GF-T1", tableNo: 1 },
  };

  try {
    await addTable(req, {}, (err) => {
      errorCaught = err;
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 400);
  assert.ok(errorCaught.message.includes("already exists"));
});

test("Manage Tables: updateTable preserves immutable internal _id when display ID changes", async () => {
  const existingTable = {
    _id: TABLE_ID,
    displayId: "GF-T1",
    area: "Ground Floor",
    capacity: 4,
    currentOccupancy: 0,
  };

  const TableMock = {
    findOne: async () => existingTable,
    findOneAndUpdate: async (q, u) => ({ ...existingTable, ...u }),
  };
  const AuditLogMock = { create: async () => {} };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableModel") return TableMock;
    if (r === "../models/auditLogModel") return AuditLogMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableController")];
  delete require.cache[require.resolve("../services/auditService")];
  const { updateTable } = require("../controllers/tableController");

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
    user: mockUser,
    params: { id: TABLE_ID },
    body: { displayId: "GF-T5", area: "VIP Area", capacity: 8 },
  };

  try {
    await updateTable(req, res, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(resData);
  const updated = resData.data;
  assert.equal(updated._id, TABLE_ID); // Immutable internal ID preserved
  assert.equal(updated.displayId, "GF-T5");
  assert.equal(updated.area, "VIP Area");
  assert.equal(updated.capacity, 8);
});

test("Manage Tables: deleteTable REJECTS deletion if table has an active session", async () => {
  const TableSessionMock = {
    findOne: async () => ({ _id: "s1", status: "OCCUPIED" }), // Active session exists
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableSessionModel") return TableSessionMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableController")];
  const { deleteTable } = require("../controllers/tableController");

  let errorCaught = null;
  const req = {
    user: mockUser,
    params: { id: TABLE_ID },
  };

  try {
    await deleteTable(req, {}, (err) => {
      errorCaught = err;
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 400);
  assert.ok(errorCaught.message.includes("active session"));
});
