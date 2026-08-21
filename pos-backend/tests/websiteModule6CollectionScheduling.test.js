const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const STORE_ID = "123456";

test("Website Module 6: Scheduled collection order within current business day & 5-hr window succeeds", async () => {
  const mockSettings = {
    _id: "ws-1",
    storeId: STORE_ID,
    restaurantId: RESTAURANT_ID,
    slug: "royal-palace",
    enabled: true,
    ordering: { pickupEnabled: true, deliveryEnabled: true, pickupWindowHours: 5 },
  };

  const mockStore = {
    _id: "store-1",
    storeId: STORE_ID,
    status: "active",
  };

  const mockMenu = {
    _id: "m-1",
    published: true,
    items: [{ _id: "d-1", name: "Biryani", price: 200, showOnWebsite: true, isAvailable: true }],
  };

  const storefrontResolverMock = {
    resolveStorefront: async () => ({
      ok: true,
      settings: mockSettings,
      store: mockStore,
      restaurantId: RESTAURANT_ID,
      storeId: STORE_ID,
    }),
  };

  const MenuMock = { find: async () => [mockMenu] };

  let savedOrder = null;
  const OrderSaveMock = function (doc) {
    Object.assign(this, doc);
    this._id = "ord-sched-1";
    this.save = async () => {
      savedOrder = this;
      return this;
    };
  };
  OrderSaveMock.findOne = async () => null;

  const socketMock = { emitOrderCreated: () => {} };
  const CustomerMock = { findOne: async () => null, create: async () => ({ _id: "c1" }) };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../services/storefrontResolver") return storefrontResolverMock;
    if (r === "../models/menuModel") return MenuMock;
    if (r === "../models/orderModel") return OrderSaveMock;
    if (r === "../models/customerModel") return CustomerMock;
    if (r === "../services/socket") return socketMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/storefrontController")];
  const { createStorefrontOrder } = require("../controllers/storefrontController");

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

  // Schedule 15 minutes ahead from now (guaranteed current business day)
  const scheduledTime = new Date(Date.now() + 15 * 60 * 1000);

  const req = {
    params: { slug: "royal-palace" },
    headers: { host: "123456.knotkitchen.in" },
    body: {
      orderType: "pickup",
      customer: { name: "Jane Doe", phone: "9876543210" },
      items: [{ menuId: "m-1", itemId: "d-1", quantity: 1 }],
      scheduledFor: scheduledTime.toISOString(),
    },
  };

  try {
    await createStorefrontOrder(req, res, (err) => {
      if (err) console.error("SCHED TEST 1 ERR:", err);
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(resData);
  assert.ok(savedOrder);
  assert.equal(new Date(savedOrder.scheduledFor).toISOString(), scheduledTime.toISOString());
  assert.equal(Boolean(savedOrder.readyDueAt), false); // Pre-order skips immediate auto-ready deadline
});

test("Website Module 6: Collection order scheduled for tomorrow or in the past is rejected", async () => {
  const mockSettings = {
    _id: "ws-1",
    storeId: STORE_ID,
    restaurantId: RESTAURANT_ID,
    slug: "royal-palace",
    enabled: true,
    ordering: { pickupEnabled: true, pickupWindowHours: 5 },
  };

  const storefrontResolverMock = {
    resolveStorefront: async () => ({
      ok: true,
      settings: mockSettings,
      store: { storeId: STORE_ID, status: "active" },
      restaurantId: RESTAURANT_ID,
      storeId: STORE_ID,
    }),
  };

  const MenuMock = {
    find: async () => [{ _id: "m-1", published: true, items: [{ _id: "d-1", price: 200, showOnWebsite: true, isAvailable: true }] }],
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../services/storefrontResolver") return storefrontResolverMock;
    if (r === "../models/menuModel") return MenuMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/storefrontController")];
  const { createStorefrontOrder } = require("../controllers/storefrontController");

  // Tomorrow date
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  let errorCaught = null;
  const req = {
    params: { slug: "royal-palace" },
    headers: { host: "123456.knotkitchen.in" },
    body: {
      orderType: "pickup",
      customer: { name: "Jane", phone: "9876543210" },
      items: [{ menuId: "m-1", itemId: "d-1", quantity: 1 }],
      scheduledFor: tomorrow.toISOString(),
    },
  };

  try {
    await createStorefrontOrder(req, {}, (err) => {
      errorCaught = err;
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught.status || errorCaught.statusCode, 400);
  assert.ok(errorCaught.message.includes("current business day"));
});
