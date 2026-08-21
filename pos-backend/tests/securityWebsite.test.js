const { test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const config = require("../config/config");
const { requireProtectedAction, requireOwnerOnly } = require("../middlewares/requirePermission");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const OWNER_ID = "507f1f77bcf86cd799439022";
const STAFF_ID = "507f1f77bcf86cd799439033";

const ownerUser = {
  _id: OWNER_ID,
  role: "Owner",
  phone: "9876543210",
  restaurantId: RESTAURANT_ID,
  storeId: "123456",
};

const staffUser = {
  _id: STAFF_ID,
  role: "Staff",
  phone: "9123456789",
  restaurantId: RESTAURANT_ID,
  storeId: "123456",
};

test("Manage Website Security: Secret keys are NEVER exposed in GET /settings payload", async () => {
  const mockSettings = {
    storeId: "123456",
    restaurantId: RESTAURANT_ID,
    slug: "my-store",
    paymentGateways: {
      activeGateway: "razorpay",
      razorpay: {
        keyId: "rzp_test_123",
        keySecretMasked: "••••••••1234",
        keySecretEncrypted: "c2VjcmV0X2tleV9kYXRh", // Sensitive encrypted secret
        isConfigured: true,
      },
    },
  };

  const WebsiteSettingsMock = {
    findOne: async () => mockSettings,
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/websiteSettingsModel") return WebsiteSettingsMock;
    if (r === "../models/storeModel") return {};
    if (r === "../models/mediaAssetModel") return {};
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  const { getWebsiteSettings } = require("../controllers/websiteSettingsController");

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
    await getWebsiteSettings({ user: ownerUser }, res, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(resData);
  const settings = resData.data.settings;
  assert.equal(settings.paymentGateways.razorpay.keyId, "rzp_test_123");
  assert.equal(settings.paymentGateways.razorpay.keySecretMasked, "••••••••1234");
  // Encrypted secret key MUST NOT be returned
  assert.equal(settings.paymentGateways.razorpay.keySecretEncrypted, undefined);
});

test("Manage Website Security: Staff cannot configure payment gateway credentials (Owner Only)", async () => {
  const mockSettings = {
    storeId: "123456",
    paymentGateways: { activeGateway: "razorpay" },
    save: async () => {},
  };

  const WebsiteSettingsMock = {
    findOne: async () => mockSettings,
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/websiteSettingsModel") return WebsiteSettingsMock;
    if (r === "../models/storeModel") return {};
    if (r === "../models/mediaAssetModel") return {};
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  delete require.cache[require.resolve("../services/auditService")];
  const { updateWebsiteSettings } = require("../controllers/websiteSettingsController");

  let errorCaught = null;
  const req = {
    user: staffUser, // Staff attempt
    body: { paymentGateways: { activeGateway: "phonepe" } },
  };

  try {
    await updateWebsiteSettings(req, {}, (err) => {
      errorCaught = err;
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 403);
  assert.ok(errorCaught.message.includes("Only the Store Owner can configure payment gateways"));
});

test("Manage Website Activity Log: Domain change logs Domain Changed event", async () => {
  let createdLog = null;

  const mockSettings = {
    storeId: "123456",
    customDomain: "old-domain.com",
    version: 1,
    save: async () => {},
  };

  const WebsiteSettingsMock = {
    findOne: async () => mockSettings,
  };

  const AuditLogMock = {
    create: async (doc) => {
      createdLog = doc;
      return doc;
    },
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/websiteSettingsModel") return WebsiteSettingsMock;
    if (r === "../models/auditLogModel") return AuditLogMock;
    if (r === "../models/storeModel") return {};
    if (r === "../models/mediaAssetModel") return {};
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  delete require.cache[require.resolve("../services/auditService")];
  const { updateWebsiteSettings } = require("../controllers/websiteSettingsController");

  const res = {
    status: (code) => {
      assert.equal(code, 200);
      return res;
    },
    json: () => {},
  };

  const req = {
    user: ownerUser,
    body: { customDomain: "new-restaurant.com" },
  };

  try {
    await updateWebsiteSettings(req, res, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(createdLog);
  assert.equal(createdLog.action, "Domain Changed");
  assert.equal(createdLog.previousValue, "old-domain.com");
  assert.equal(createdLog.newValue, "new-restaurant.com");
});

test("Manage Website Activity Log: Website publish logs Website Published event", async () => {
  let createdLog = null;

  const MenuMock = {
    find: async () => [
      { _id: "m1", version: 1, items: [], set: () => {}, save: async () => {} },
    ],
  };

  const AuditLogMock = {
    create: async (doc) => {
      createdLog = doc;
      return doc;
    },
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/menuModel") return MenuMock;
    if (r === "../models/auditLogModel") return AuditLogMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/menuController")];
  delete require.cache[require.resolve("../services/auditService")];
  const { publishWebsiteCache } = require("../controllers/menuController");

  const res = {
    status: (code) => {
      assert.equal(code, 200);
      return res;
    },
    json: () => {},
  };

  const req = { user: ownerUser };

  try {
    await publishWebsiteCache(req, res, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(createdLog);
  assert.equal(createdLog.action, "Website Published");
  assert.equal(createdLog.resource, "Website Cache");
});
