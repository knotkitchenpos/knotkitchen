const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_A_ID = "507f1f77bcf86cd799439011";
const RESTAURANT_B_ID = "507f1f77bcf86cd799439022";
const STORE_A_ID = "123456";
const STORE_B_ID = "654321";

test("Website Module 1: Subdomain (123456.knotkitchen.in) resolves Store 123456 authoritatively", async () => {
  const websiteSettingsA = {
    _id: "ws-A",
    storeId: STORE_A_ID,
    restaurantId: RESTAURANT_A_ID,
    slug: "royal-palace",
    subdomain: "123456.knotkitchen.in",
    customDomain: "",
    enabled: true,
  };

  const storeA = {
    _id: "store-doc-A",
    storeId: STORE_A_ID,
    status: "active",
  };

  const restaurantA = {
    _id: RESTAURANT_A_ID,
    name: "Royal Palace",
    isActive: true,
  };

  const WebsiteSettingsMock = {
    findOne: async (query) => {
      if (query.storeId === STORE_A_ID || query.subdomain === "123456.knotkitchen.in") {
        return websiteSettingsA;
      }
      return null;
    },
  };

  const StoreMock = {
    findOne: async (query) => (query.storeId === STORE_A_ID ? storeA : null),
  };

  const RestaurantMock = {
    findById: async (id) => (id === RESTAURANT_A_ID ? restaurantA : null),
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/websiteSettingsModel") return WebsiteSettingsMock;
    if (r === "../models/storeModel") return StoreMock;
    if (r === "../models/restaurantModel") return RestaurantMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../services/storefrontResolver")];
  const { resolveStorefront } = require("../services/storefrontResolver");

  let result;
  try {
    result = await resolveStorefront({ host: "123456.knotkitchen.in" });
  } finally {
    Module._load = orig;
  }

  assert.ok(result.ok);
  assert.equal(result.storeId, STORE_A_ID);
  assert.equal(result.restaurant.name, "Royal Palace");
});

test("Website Module 1: Custom Domain (www.myrestaurant.com) maps to correct restaurant", async () => {
  const websiteSettingsCustom = {
    _id: "ws-custom",
    storeId: STORE_B_ID,
    restaurantId: RESTAURANT_B_ID,
    slug: "spice-hub",
    customDomain: "myrestaurant.com",
    enabled: true,
  };

  const storeB = {
    _id: "store-doc-B",
    storeId: STORE_B_ID,
    status: "active",
  };

  const restaurantB = {
    _id: RESTAURANT_B_ID,
    name: "Spice Hub",
    isActive: true,
  };

  const WebsiteSettingsMock = {
    findOne: async (query) => {
      if (query.customDomain === "myrestaurant.com") {
        return websiteSettingsCustom;
      }
      return null;
    },
  };

  const StoreMock = {
    findOne: async (query) => (query.storeId === STORE_B_ID ? storeB : null),
  };

  const RestaurantMock = {
    findById: async (id) => (id === RESTAURANT_B_ID ? restaurantB : null),
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/websiteSettingsModel") return WebsiteSettingsMock;
    if (r === "../models/storeModel") return StoreMock;
    if (r === "../models/restaurantModel") return RestaurantMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../services/storefrontResolver")];
  const { resolveStorefront } = require("../services/storefrontResolver");

  let result;
  try {
    result = await resolveStorefront({ host: "www.myrestaurant.com" });
  } finally {
    Module._load = orig;
  }

  assert.ok(result.ok);
  assert.equal(result.storeId, STORE_B_ID);
  assert.equal(result.restaurant.name, "Spice Hub");
});

test("Website Module 1: Duplicate custom domain claiming returns 409 Conflict", async () => {
  const existingClaim = {
    _id: "ws-existing",
    storeId: STORE_A_ID,
    customDomain: "myrestaurant.com",
  };

  const WebsiteSettingsMock = {
    findOne: async (query) => {
      if (query.customDomain === "myrestaurant.com" && query.isDeleted?.$ne === true) {
        return existingClaim;
      }
      return { storeId: STORE_B_ID, customDomain: "" };
    },
  };

  const AuditLogMock = { create: async () => {} };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/websiteSettingsModel") return WebsiteSettingsMock;
    if (r === "../models/auditLogModel") return AuditLogMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  delete require.cache[require.resolve("../services/auditService")];
  const { updateWebsiteSettings } = require("../controllers/websiteSettingsController");

  let errorCaught = null;
  const req = {
    user: { restaurantId: RESTAURANT_B_ID, storeId: STORE_B_ID, role: "Owner" },
    body: { customDomain: "myrestaurant.com" },
  };

  try {
    await updateWebsiteSettings(req, {}, (err) => {
      errorCaught = err;
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught.status || errorCaught.statusCode, 409);
  assert.ok(errorCaught.message.includes("already claimed"));
});
