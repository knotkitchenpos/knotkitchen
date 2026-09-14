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
      activeGateway: "cashfree",
      cashfree: {
        clientId: "cf_test_123",
        clientSecretMasked: "••••••••1234",
        clientSecretEncrypted: "c2VjcmV0X2tleV9kYXRh", // Sensitive encrypted secret
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
  assert.equal(settings.paymentGateways.cashfree.clientId, "cf_test_123");
  assert.equal(settings.paymentGateways.cashfree.clientSecretMasked, "••••••••1234");
  // Encrypted secret key MUST NOT be returned
  assert.equal(settings.paymentGateways.cashfree.clientSecretEncrypted, undefined);
});

test("Manage Website Security: Staff cannot configure payment gateway credentials (Owner Only)", async () => {
  const mockSettings = {
    storeId: "123456",
    paymentGateways: { activeGateway: "cashfree" },
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
  assert.match(errorCaught.message, /Only the Store Owner can configure payment gateways/);
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
    csdStaff: { _id: "csd-staff-1", name: "CSD" },
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

test("Manage Website Activity Log: publishing to the tills logs a Published event", async () => {
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
  // There is no website publish any more -- the customer site reads the live
  // menu. The tills still have one, and it is still audited.
  const { publishSystemCache } = require("../controllers/menuController");

  const res = {
    status: (code) => {
      assert.equal(code, 200);
      return res;
    },
    json: () => {},
  };

  const req = { user: ownerUser, csdStaff: { _id: "csd-staff-1", name: "CSD" } };

  try {
    await publishSystemCache(req, res, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(createdLog);
  assert.equal(createdLog.action, "Menu Published");
  assert.equal(createdLog.resource, "System Cache");
});

/**
 * REGRESSION (2026-09-01): a store with no payment gateway configured could
 * not save ANYTHING on the Website page.
 *
 * The editor PUTs the whole settings object, so `paymentGateways` rides along
 * on every save — including one where the operator only picked a logo. The
 * active-gateway guard fired on that unchanged echo: activeGateway defaults to
 * a gateway with isConfigured=false, so every new store's save 400'd before
 * ever reaching settings.save(). The symptom was "I upload a logo and it never
 * sticks", with no audit entry to show for it.
 *
 * The guards must key off an actual CHANGE, not the presence of the field.
 */
test("Website settings: an unchanged unconfigured activeGateway does not block an unrelated save", async () => {
  const mockSettings = {
    storeId: "123456",
    restaurantId: RESTAURANT_ID,
    slug: "my-store",
    version: 4,
    branding: {},
    paymentGateways: {
      activeGateway: "cashfree",
      cashfree: { keyId: "", isConfigured: false },
      cashfree: { isConfigured: false },
      phonepe: { isConfigured: false },
    },
    save: async () => {},
  };

  const MediaAssetMock = {
    findOne: async () => ({
      _id: "6a973d0555809ad56442458e",
      url: "https://cdn.example.com/logo.png",
      thumbnailUrl: "https://cdn.example.com/logo.png",
      altText: "",
    }),
  };

  const restaurantUpdates = [];
  const RestaurantMock = { updateOne: async (filter, update) => restaurantUpdates.push({ filter, update }) };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/websiteSettingsModel") return { findOne: async () => mockSettings };
    if (r === "../models/storeModel") return {};
    if (r === "../models/mediaAssetModel") return MediaAssetMock;
    if (r === "../models/restaurantModel") return RestaurantMock;
    // Unmocked, this reaches for a real Mongo connection and stalls the test
    // for the driver's full server-selection timeout before succeeding.
    if (r === "../services/auditService") return { logActivity: async () => {} };
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  delete require.cache[require.resolve("../services/auditService")];
  const { updateWebsiteSettings } = require("../controllers/websiteSettingsController");

  let errorCaught = null;
  let responded = null;
  const res = {
    status: () => res,
    json: (payload) => { responded = payload; },
  };

  // Exactly what the editor sends after picking a logo: new branding, plus the
  // untouched paymentGateways block it was handed by GET.
  const req = {
    user: ownerUser,
    csdStaff: { _id: "csd-staff-1", name: "CSD" },
    body: {
      branding: { logo: { mediaId: "6a973d0555809ad56442458e" } },
      paymentGateways: {
        activeGateway: "cashfree",
        cashfree: { clientId: "", isConfigured: false },
      },
    },
  };

  try {
    await updateWebsiteSettings(req, res, (err) => { errorCaught = err; });
  } finally {
    Module._load = orig;
  }

  assert.equal(
    errorCaught,
    null,
    `save must not be refused; got ${errorCaught && errorCaught.status}: ${errorCaught && errorCaught.message}`
  );
  assert.ok(responded, "the save should have produced a response");
  assert.equal(mockSettings.branding.logo.url, "https://cdn.example.com/logo.png");
  // The POS and receipts read the restaurant's copy; it must follow.
  assert.deepEqual(restaurantUpdates, [
    { filter: { _id: RESTAURANT_ID }, update: { $set: { "branding.logo": "https://cdn.example.com/logo.png" } } },
  ]);
});

test("Website settings: switching TO an unconfigured gateway is still refused", async () => {
  const mockSettings = {
    storeId: "123456",
    restaurantId: RESTAURANT_ID,
    version: 1,
    branding: {},
    paymentGateways: {
      activeGateway: "cashfree",
      cashfree: { isConfigured: true },
      phonepe: { isConfigured: false },
    },
    save: async () => {},
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/websiteSettingsModel") return { findOne: async () => mockSettings };
    if (r === "../models/storeModel") return {};
    if (r === "../models/mediaAssetModel") return {};
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  delete require.cache[require.resolve("../services/auditService")];
  const { updateWebsiteSettings } = require("../controllers/websiteSettingsController");

  let errorCaught = null;
  const req = {
    user: ownerUser,
    csdStaff: { _id: "csd-staff-1", name: "CSD" },
    body: { paymentGateways: { activeGateway: "phonepe" } },
  };

  try {
    await updateWebsiteSettings(req, { status: () => ({ json: () => {} }) }, (err) => { errorCaught = err; });
  } finally {
    Module._load = orig;
  }

  assert.ok(errorCaught, "switching to an unconfigured gateway must still 400");
  assert.equal(errorCaught.status, 400);
});
