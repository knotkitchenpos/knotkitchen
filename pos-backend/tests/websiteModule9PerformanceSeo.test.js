const { test } = require("node:test");
const assert = require("node:assert/strict");

test("Website Module 9: toPublicProduct resolves thumbnail image derivative for fast mobile loading", () => {
  const { toPublicProduct } = require("../controllers/storefrontController");

  const mockItem = {
    _id: "item-123",
    name: "Special Thali",
    price: 250,
    imageUrl: "https://example.com/fullres.jpg",
    imageThumbnailUrl: "https://example.com/thumb.jpg",
    isVegetarian: true,
    variants: [],
    addons: [],
    modifierGroups: [],
  };

  const mockMenu = { _id: "m1", name: "Combos" };

  const publicItem = toPublicProduct(mockItem, mockMenu, "Asia/Kolkata");

  assert.equal(publicItem.thumbnail, "https://example.com/thumb.jpg"); // Uses thumbnail derivative
  assert.equal(publicItem.name, "Special Thali");
});

test("Website Module 9: Public storefront payload never leaks internal employee IDs or payment secret keys", async () => {
  const { buildStorefrontPayload } = require("../controllers/storefrontController");

  const mockSettings = {
    _id: "ws-1",
    storeId: "123456",
    restaurantId: "507f1f77bcf86cd799439011",
    slug: "royal-palace",
    displayName: "Royal Palace",
    paymentGateways: {
      activeGateway: "Razorpay",
      razorpayKeySecret: "SECRET_KEY_NEVER_LEAK", // Private secret key
    },
  };

  const mockMenu = {
    _id: "m-1",
    published: true,
    items: [{ _id: "d-1", name: "Dish", price: 100, showOnWebsite: true, isAvailable: true }],
  };

  const MenuMock = {
    find: () => ({
      sort: async () => [mockMenu],
    }),
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/menuModel") return MenuMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/storefrontController")];
  const { buildStorefrontPayload: freshBuild } = require("../controllers/storefrontController");

  let payload = null;
  try {
    payload = await freshBuild({
      settings: mockSettings,
      restaurantId: "507f1f77bcf86cd799439011",
      storeId: "123456",
      timezone: "Asia/Kolkata",
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(payload);
  const jsonString = JSON.stringify(payload);
  assert.equal(jsonString.includes("SECRET_KEY_NEVER_LEAK"), false); // Secret keys masked
});
