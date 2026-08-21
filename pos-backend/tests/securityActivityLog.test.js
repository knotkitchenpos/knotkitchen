const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const USER_ID = "507f1f77bcf86cd799439022";

const mockUser = {
  _id: USER_ID,
  role: "Staff",
  phone: "9876543210",
  name: "John Staff",
  restaurantId: RESTAURANT_ID,
  storeId: "123456",
};

test("Activity Log: logActivity formats record with user, phone, role, and formatted timestamp", async () => {
  let createdDoc = null;

  const AuditLogMock = {
    create: async (doc) => {
      createdDoc = doc;
      return doc;
    },
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/auditLogModel") return AuditLogMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../services/auditService")];
  const { logActivity } = require("../services/auditService");

  try {
    await logActivity({
      user: mockUser,
      action: "Updated Delivery Charge",
      resource: "Delivery Charge",
      previousValue: "0–3 km = ₹20",
      newValue: "0–3 km = ₹30",
      description: "Delivery charge updated",
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(createdDoc);
  assert.equal(createdDoc.storeId, "123456");
  assert.equal(createdDoc.userId, USER_ID);
  assert.equal(createdDoc.phone, "9876543210");
  assert.equal(createdDoc.role, "Staff");
  assert.equal(createdDoc.action, "Updated Delivery Charge");
  assert.equal(createdDoc.previousValue, "0–3 km = ₹20");
  assert.equal(createdDoc.newValue, "0–3 km = ₹30");
  assert.ok(createdDoc.dateFormatted);
  assert.ok(createdDoc.timeFormatted);
});

test("Activity Log: Secrets and PINs are automatically masked in log values", async () => {
  let createdDoc = null;

  const AuditLogMock = {
    create: async (doc) => {
      createdDoc = doc;
      return doc;
    },
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/auditLogModel") return AuditLogMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../services/auditService")];
  const { logActivity } = require("../services/auditService");

  try {
    await logActivity({
      user: mockUser,
      action: "Updated Gateway",
      resource: "Payment Gateway",
      previousValue: { keySecret: "raw_secret_123", pin: "8796" },
      newValue: { keySecret: "raw_secret_456", pin: "9999" },
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(createdDoc);
  assert.equal(createdDoc.previousValue.keySecret, "••••••••");
  assert.equal(createdDoc.previousValue.pin, "••••••••");
  assert.equal(createdDoc.newValue.keySecret, "••••••••");
  assert.equal(createdDoc.newValue.pin, "••••••••");
});

test("Activity Log: Failed authorization returns 403 and does NOT create a change log", async () => {
  let createdDoc = null;

  const AuditLogMock = {
    create: async (doc) => {
      createdDoc = doc;
      return doc;
    },
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/auditLogModel") return AuditLogMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/restaurantController")];
  const { addStaffMember } = require("../controllers/restaurantController");

  let errorCaught = null;
  const req = {
    user: mockUser, // Staff user attempting owner-only action
    body: { name: "Unauthorized Staff", phone: "9999999999" },
  };

  try {
    await addStaffMember(req, {}, (err) => {
      errorCaught = err;
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 403);
  assert.equal(createdDoc, null); // Audit log for creation was NOT created
});
