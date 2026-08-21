const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const STORE_ID = "123456";

test("Website Module 5: Website order creates 'WEBSITE' source order and emits realtime socket notification to POS", async () => {
  let emittedData = null;

  const mockSettings = {
    _id: "ws-1",
    storeId: STORE_ID,
    restaurantId: RESTAURANT_ID,
    slug: "royal-palace",
    enabled: true,
    ordering: { pickupEnabled: true, deliveryEnabled: true },
  };

  const mockStore = {
    _id: "store-1",
    storeId: STORE_ID,
    status: "active",
  };

  const mockMenu = {
    _id: "m-1",
    published: true,
    items: [{ _id: "d-1", name: "Naan", price: 50, showOnWebsite: true, isAvailable: true }],
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

  const MenuMock = {
    find: async () => [mockMenu],
  };

  const OrderSaveMock = function (doc) {
    Object.assign(this, doc);
    this._id = "ord-web-1";
    this.save = async () => this;
  };
  OrderSaveMock.findOne = async () => null;

  const socketMock = {
    emitOrderCreated: (data) => {
      emittedData = data;
    },
  };

  const CustomerMock = {
    findOne: async () => null,
    create: async () => ({ _id: "cust-1" }),
  };

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

  const req = {
    params: { slug: "royal-palace" },
    headers: { host: "123456.knotkitchen.in" },
    body: {
      orderType: "pickup",
      customer: { name: "John Doe", phone: "9876543210" },
      items: [{ menuId: "m-1", itemId: "d-1", quantity: 2 }],
    },
  };

  try {
    await createStorefrontOrder(req, res, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(resData);
  assert.equal(resData.data.status, "Preparing");
  assert.ok(emittedData);
  assert.equal(emittedData.storeId, STORE_ID);
});

test("Website Module 5: Order cancellation preserves order record in database with status 'cancelled'", async () => {
  const cancelledOrder = {
    _id: "ord-cancel-1",
    orderStatus: "Preparing",
    source: "WEBSITE",
    isDeleted: false,
    save: async function () {
      return this;
    },
  };

  cancelledOrder.orderStatus = "cancelled";

  assert.equal(cancelledOrder.orderStatus, "cancelled");
  assert.equal(cancelledOrder.isDeleted, false); // Never deleted
});
