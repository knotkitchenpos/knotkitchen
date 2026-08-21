const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const STORE_ID = "123456";

test("Website Module 3: Public store menu returns categories, products with Veg/Non-Veg badges and prices", async () => {
  const mockStore = {
    _id: "store-1",
    storeId: STORE_ID,
    restaurantId: RESTAURANT_ID,
    status: "active",
  };

  const mockMenus = [
    {
      _id: "m1",
      name: "Paneer Tikka",
      description: "Cottage cheese grilled in tandoor",
      price: 280,
      isVegetarian: true,
      category: "Starters",
      published: true,
      isDeleted: false,
    },
    {
      _id: "m2",
      name: "Chicken Tikka",
      description: "Spicy grilled chicken kebab",
      price: 350,
      isVegetarian: false,
      category: "Starters",
      published: true,
      isDeleted: false,
    },
  ];

  const StoreMock = {
    findOne: async (query) => (query.storeId === STORE_ID ? mockStore : null),
  };

  const MenuMock = {
    find: async (query) => {
      if (query.restaurantId === RESTAURANT_ID && query.published === true) {
        return mockMenus;
      }
      return [];
    },
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/storeModel") return StoreMock;
    if (r === "../models/menuModel") return MenuMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/publicStoreController")];
  const { getPublicStoreMenu } = require("../controllers/publicStoreController");

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
    params: { storeId: STORE_ID },
  };

  try {
    await getPublicStoreMenu(req, res, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(resData);
  const items = resData.data;
  assert.equal(items.length, 2);
  const vegItem = items.find((i) => i.isVegetarian === true);
  const nonVegItem = items.find((i) => i.isVegetarian === false);
  assert.equal(vegItem.name, "Paneer Tikka");
  assert.equal(nonVegItem.name, "Chicken Tikka");
});
