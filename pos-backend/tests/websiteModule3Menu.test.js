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

  // A Menu document is a CATEGORY holding items — the previous fixture modelled
  // each menu as a bare dish, which is not a shape production ever returns.
  //
  // The public menu endpoint serves the LIVE menu, so the fixture carries a
  // stale websiteSnapshot at a different price. A response quoting 999 would
  // mean a read path had gone back to the snapshot, and every store that ever
  // pressed the old Publish Website button would start serving whatever it
  // held on that day.
  const paneer = {
    _id: "d1",
    name: "Paneer Tikka",
    description: "Cottage cheese grilled in tandoor",
    price: 280,
    isVegetarian: true,
    showOnWebsite: true,
    isAvailable: true,
  };
  const chicken = {
    _id: "d2",
    name: "Chicken Tikka",
    description: "Spicy grilled chicken kebab",
    price: 350,
    isVegetarian: false,
    showOnWebsite: true,
    isAvailable: true,
  };

  const mockMenus = [
    {
      _id: "m1",
      name: "Starters",
      published: true,
      isDeleted: false,
      items: [paneer, chicken],
      hasPublishedToWebsite: true,
      websiteSnapshot: {
        name: "Starters",
        items: [{ ...paneer, price: 999 }, { ...chicken, price: 999 }],
      },
    },
  ];

  const StoreMock = {
    findOne: async (query) => (query.storeId === STORE_ID ? mockStore : null),
  };

  const MenuMock = {
    find: async (query) => {
      // Visibility is expressed as an $or now — `published: true` OR the
      // per-surface showOnWebsite override — so the old `query.published`
      // check no longer describes what the controller asks for.
      const clauses = query.$or || [];
      const scopesToPublished = clauses.some((c) => c.published !== undefined);
      const honoursOverride = clauses.some((c) => c.showOnWebsite === true);
      if (query.restaurantId === RESTAURANT_ID && scopesToPublished && honoursOverride) {
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
  const categories = resData.data;
  assert.equal(categories.length, 1);

  const items = categories[0].items;
  assert.equal(items.length, 2);
  const vegItem = items.find((i) => i.isVegetarian === true);
  const nonVegItem = items.find((i) => i.isVegetarian === false);
  assert.equal(vegItem.name, "Paneer Tikka");
  assert.equal(nonVegItem.name, "Chicken Tikka");

  // Live prices, not the 999 left behind in the retired snapshot.
  assert.equal(vegItem.price, 280);
  assert.equal(nonVegItem.price, 350);
});
