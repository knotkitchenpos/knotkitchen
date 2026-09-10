const { test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const config = require("../config/config");
const { requireOwnerOnly, requireProtectedAction } = require("../middlewares/requirePermission");

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

test("Owner Access: Owner user automatically allowed for owner-only actions", async () => {
  const req = { user: ownerUser, csdStaff: { _id: "csd-staff-1", name: "CSD" } };
  let calledNext = false;
  let errorCaught = null;

  await requireOwnerOnly(req, {}, (err) => {
    if (err) errorCaught = err;
    else calledNext = true;
  });

  assert.equal(calledNext, true);
  assert.equal(errorCaught, null);
});

test("Staff Access: Staff user DENIED for owner-only actions even if authenticated", async () => {
  const req = { user: staffUser };
  let calledNext = false;
  let errorCaught = null;

  await requireOwnerOnly(req, {}, (err) => {
    if (err) errorCaught = err;
    else calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 403);
  assert.ok(errorCaught.message.includes("restricted to the Store Owner only"));
});

test("Owner Access: Owner user automatically allowed for protected actions", async () => {
  const req = { user: ownerUser, headers: {} };
  let calledNext = false;
  let errorCaught = null;

  await requireProtectedAction(req, {}, (err) => {
    if (err) errorCaught = err;
    else calledNext = true;
  });

  assert.equal(calledNext, true);
  assert.equal(errorCaught, null);
});

test("Staff Access: Protected action DENIED for staff without PIN or token", async () => {
  const req = { user: staffUser, headers: {}, body: {} };
  let calledNext = false;
  let errorCaught = null;

  await requireProtectedAction(req, {}, (err) => {
    if (err) errorCaught = err;
    else calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 403);
  assert.ok(errorCaught.message.includes("PIN authorization required"));
});

test("Staff Access: Protected action ALLOWED for staff with valid PIN token", async () => {
  const pinToken = jwt.sign(
    { userId: STAFF_ID, restaurantId: RESTAURANT_ID, elevated: true },
    config.accessTokenSecret,
    { expiresIn: "15m" }
  );

  const req = {
    user: staffUser,
    headers: { "x-staff-pin-token": pinToken },
    body: {},
  };
  let calledNext = false;
  let errorCaught = null;

  await requireProtectedAction(req, {}, (err) => {
    if (err) errorCaught = err;
    else calledNext = true;
  });

  assert.equal(calledNext, true);
  assert.equal(errorCaught, null);
});

test("Staff Access: Staff with valid PIN token STILL DENIED for owner-only actions", async () => {
  const pinToken = jwt.sign(
    { userId: STAFF_ID, restaurantId: RESTAURANT_ID, elevated: true },
    config.accessTokenSecret,
    { expiresIn: "15m" }
  );

  const req = {
    user: staffUser,
    headers: { "x-staff-pin-token": pinToken },
    body: {},
  };
  let calledNext = false;
  let errorCaught = null;

  await requireOwnerOnly(req, {}, (err) => {
    if (err) errorCaught = err;
    else calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 403);
  assert.ok(errorCaught.message.includes("restricted to the Store Owner only"));
});

test("Backend Enforcement: Staff cannot modify payment gateways in website settings", async () => {
  const RestaurantMock = {
    findOne: async () => ({ _id: RESTAURANT_ID, securityPin: null }),
  };
  const WebsiteSettingsMock = {
    findOne: async () => ({
      storeId: "123456",
      paymentGateways: {},
      version: 1,
      save: async () => {},
    }),
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/restaurantModel") return RestaurantMock;
    if (r === "../models/websiteSettingsModel") return WebsiteSettingsMock;
    if (r === "../models/mediaAssetModel") return {};
    if (r === "../models/storeModel") return {};
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  const { updateWebsiteSettings } = require("../controllers/websiteSettingsController");

  let errorCaught = null;
  const req = {
    user: staffUser,
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

test("Backend Enforcement: Staff cannot modify owner info in store properties", async () => {
  const RestaurantMock = {
    findOne: async () => ({
      _id: RESTAURANT_ID,
      securityPin: null,
      save: async () => {},
    }),
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/restaurantModel") return RestaurantMock;
    if (r === "../models/websiteSettingsModel") return {};
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/restaurantController")];
  const { updateStoreProperties } = require("../controllers/restaurantController");

  let errorCaught = null;
  const req = {
    user: staffUser,
    body: { pin: "8796", ownerName: "Hacked Owner" },
  };

  try {
    await updateStoreProperties(req, {}, (err) => {
      errorCaught = err;
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 403);
  assert.ok(errorCaught.message.includes("Only the Store Owner can modify owner contact information"));
});
