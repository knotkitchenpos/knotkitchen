const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const STORE_ID = "123456";

test("Website Module 2: Storefront endpoint returns complete dynamic Homepage sections payload", async () => {
  const mockSettings = {
    _id: "ws-1",
    storeId: STORE_ID,
    restaurantId: RESTAURANT_ID,
    slug: "royal-palace",
    enabled: true,
    displayName: "Royal Palace",
    branding: {
      siteTitle: "Royal Palace — Order Online",
      tagline: "Authentic Indian Cuisine",
      logo: "https://example.com/logo.png",
      coverImage: "https://example.com/cover.jpg",
    },
    contact: {
      phone: "+91 9876543210",
      email: "contact@royalpalace.com",
    },
    paymentGateways: {
      activeGateway: "Cashfree",
      cashfreeConfigured: true,
      cashfreeConfigured: false,
      phonepeConfigured: false,
    },
  };

  const mockStore = {
    _id: "store-1",
    storeId: STORE_ID,
    name: "Royal Palace",
    status: "active",
    appUrl: "https://play.google.com/store/apps/details?id=com.royalpalace",
  };

  const mockRestaurant = {
    _id: RESTAURANT_ID,
    name: "Royal Palace",
    isActive: true,
  };

  const storefrontResolverMock = {
    resolveStorefront: async () => ({
      ok: true,
      settings: mockSettings,
      store: mockStore,
      restaurant: mockRestaurant,
      restaurantId: RESTAURANT_ID,
      storeId: STORE_ID,
    }),
  };

  const MenuMock = {
    find: () => ({
      lean: async () => [
        { _id: "m1", name: "Paneer Butter Masala", price: 300, isPopular: true, category: "Main Course" },
      ],
    }),
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../services/storefrontResolver") return storefrontResolverMock;
    if (r === "../models/menuModel") return MenuMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/publicStoreController")];
  const { getPublicStoreByDomain } = require("../controllers/publicStoreController");

  let resData = null;
  const res = {
    set: () => res,
    status: (code) => {
      assert.equal(code, 200);
      return res;
    },
    json: (payload) => {
      resData = payload;
    },
  };

  const req = {
    params: { slug: "royal-palace" },
    query: {},
    headers: { host: "123456.knotkitchen.in" },
  };

  try {
    await getPublicStoreByDomain(req, res, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(resData);
  const data = resData.data;
  assert.equal(data.name, "Royal Palace");
  assert.equal(data.siteTitle, "Royal Palace — Order Online");
  assert.equal(data.tagline, "Authentic Indian Cuisine");
});
