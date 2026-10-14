// Menu rules across channels (QA roadmap 10, N036-N040). Run against a backend:
//   cd pos-backend && node --test tests/menuRulesAcrossChannels.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const BE = path.join(__dirname, "..");
const r = (p) => require(path.join(BE, p));
const mongoose = r("node_modules/mongoose");
const sift = r("node_modules/sift").default;
const Module = require("module");

const Menu = r("models/menuModel");
const Restaurant = r("models/restaurantModel");
const { resolveMenuItem } = r("services/price");
const { projectMenus, AUDIENCES } = r("services/menuCache");

const oid = () => new mongoose.Types.ObjectId();
const RID = oid();
// A category as Publish System leaves it: live doc and both snapshots agree.
const published = (cat, item) => {
  const it = { _id: oid(), name: item.name, price: 100, category: cat.name, isAvailable: true, ...item };
  const snap = { name: cat.name, items: [it], published: cat.published ?? true, showOnPos: cat.showOnPos ?? false, dispatchType: cat.dispatchType };
  return new Menu({ name: cat.name, createdBy: oid(), restaurantId: RID, ...cat, items: [it], hasPublishedToSystem: true, systemSnapshot: snap, hasPublishedToWebsite: true, websiteSnapshot: snap });
};

const sells = async (t, menu) => {
  // Honours the query, so a filter on the live draft flag shows up.
  const plain = (x) => JSON.parse(JSON.stringify(x));
  t.mock.method(Menu, "findOne", async (q) => (sift(plain(q))(plain(menu.toObject())) ? menu : null));
  t.mock.method(Restaurant, "findById", () => ({ select: () => ({ lean: async () => ({ timezone: "Asia/Kolkata" }) }) }));
  try {
    await resolveMenuItem({ menuItemId: menu.systemSnapshot.items[0]._id, restaurantId: RID });
    return true;
  } catch (e) {
    return false;
  }
};

test("N036/N038: a POS table and the table QR sell exactly what the till shows", async (t) => {
  assert.equal(await sells(t, published({ name: "Mains" }, { name: "Dal" })), true, "control");
  assert.equal(await sells(t, published({ name: "Staff", published: false, showOnPos: true }, { name: "Staff meal" })), true, "POS-only category");
  assert.equal(await sells(t, published({ name: "A" }, { name: "Rescued", isAvailable: false, visibleOnPosWhenOff: true })), true, "Display OFF + POS Visibility");
  assert.equal(await sells(t, published({ name: "B" }, { name: "Web only", displayTarget: "website" })), false, "Website Only product");
  assert.equal(await sells(t, published({ name: "C" }, { name: "Box", dispatchType: { collection: true, delivery: true, table: false } })), false, "product Table off");
  assert.equal(await sells(t, published({ name: "D", dispatchType: { collection: true, delivery: false, table: false } }, { name: "Collect" })), false, "category Collection only");
  const hidden = published({ name: "E", published: false }, { name: "Hidden" });
  hidden.published = true; // Display ON in the draft, not yet published: the tills still hide it
  assert.equal(await sells(t, hidden), false, "published Display OFF wins over the draft");
});

test("N038: a Website Only product is not served to the tills or the table QR", () => {
  const menus = projectMenus([published({ name: "Mix" }, { name: "Web only", displayTarget: "website" })], AUDIENCES.SYSTEM);
  assert.deepEqual(menus.flatMap((m) => m.items.map((i) => i.name)), []);
});

test("N037: a subcategory's Dispatch Type reaches its products", async (t) => {
  const { updateSubcategory } = r("controllers/menuController");
  const menu = new Menu({
    name: "Burgers", createdBy: oid(), restaurantId: RID, subcategories: [{ name: "Chicken" }],
    items: [{ name: "Zinger", price: 150, category: "Burgers", subcategory: "Chicken" }, { name: "Veg", price: 90, category: "Burgers" }],
  });
  t.mock.method(Menu, "findOne", async () => menu);
  t.mock.method(menu, "save", async () => menu);
  const res = { status: () => res, json: () => res };
  let failed;
  await updateSubcategory(
    { user: { _id: oid(), restaurantId: RID }, body: { menuId: menu._id, subcategoryId: menu.subcategories[0]._id, name: "Chicken", dispatchType: { collection: true, delivery: false, table: true } } },
    res,
    (e) => (failed = e),
  );
  assert.equal(failed, undefined);
  assert.equal(menu.items[0].dispatchType.delivery, false, "Zinger is in Chicken");
  assert.equal(menu.items[1].dispatchType.delivery, true, "Veg is not");
});

test("REGRESSION M3: a category or subcategory save that leaves Dispatch Type as it was keeps each product's own", async (t) => {
  const { updateCategory, updateSubcategory } = r("controllers/menuController");
  const all = { collection: true, delivery: true, table: true };
  const tableOnly = { collection: false, delivery: false, table: true };
  const menu = new Menu({
    name: "Drinks", createdBy: oid(), restaurantId: RID, dispatchType: all, subcategories: [{ name: "Bottles", dispatchType: all }],
    items: [{ name: "Beer", price: 300, category: "Drinks", subcategory: "Bottles", dispatchType: tableOnly }],
  });
  t.mock.method(Menu, "findOne", async () => menu);
  t.mock.method(menu, "save", async () => menu);
  const res = { status: () => res, json: () => res };
  const user = { _id: oid(), restaurantId: RID };
  const fail = (e) => { throw e; };
  // CategoryDrawer sends dispatchType on every save.
  await updateCategory({ user, body: { menuId: menu._id, name: "Drinks", description: "Cold ones", dispatchType: all } }, res, fail);
  await updateSubcategory({ user, body: { menuId: menu._id, subcategoryId: menu.subcategories[0]._id, name: "Bottled", dispatchType: all } }, res, fail);
  assert.deepEqual({ ...menu.items[0].dispatchType.toObject?.() ?? menu.items[0].dispatchType }, tableOnly, "Beer stays Table only");
  assert.equal(menu.items[0].subcategory, "Bottled");
  // A real change still reaches every product.
  await updateCategory({ user, body: { menuId: menu._id, name: "Drinks", dispatchType: { ...all, delivery: false } } }, res, fail);
  assert.equal(menu.items[0].dispatchType.delivery, false);
  assert.equal(menu.items[0].dispatchType.collection, true);
});

test("REGRESSION: a category outside its own schedule is neither listed on the table QR nor sold to a table", async (t) => {
  const { nowInTimezone } = r("services/businessHours");
  const today = nowInTimezone("Asia/Kolkata").day;
  // "Breakfast" runs all day, every day but today: the till hides it now.
  const schedule = { enabled: true, startTime: "00:00", endTime: "23:59", daysOfWeek: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== today) };
  const breakfast = published({ name: "Breakfast", schedule }, { name: "Poha" });
  assert.equal(await sells(t, breakfast), false, "resolveMenuItem refuses it");
  assert.equal(await sells(t, published({ name: "Breakfast", schedule: { ...schedule, daysOfWeek: [today] } }, { name: "Poha" })), true, "in schedule: sold");

  const mains = published({ name: "Mains" }, { name: "Dal" });
  const fakes = {
    "../models/menuModel": { find: async () => [breakfast, mains] },
    "./tableSessionController": { findActiveSessionByTable: async () => null },
    "../models/restaurantModel": {
      findOne: () => ({ lean: async () => ({ timezone: "Asia/Kolkata" }) }),
      findById: () => ({ select: () => ({ lean: async () => ({ timezone: "Asia/Kolkata" }) }) }),
    },
    "../models/websiteSettingsModel": { findOne: () => ({ select: () => ({ lean: async () => null }) }) },
    "../services/paymentGateway": { resolveGateway: async () => ({ enabled: false }), isOnlinePaymentEnabled: async () => false, PROVIDERS: {} },
  };
  const qrPath = path.join(BE, "controllers/qrController");
  const orig = Module._load;
  Module._load = function (req) {
    return Object.prototype.hasOwnProperty.call(fakes, req) ? fakes[req] : orig.apply(this, arguments);
  };
  let body;
  try {
    delete require.cache[require.resolve(qrPath)];
    const { getTableByToken } = require(qrPath);
    const res = { status: () => res, json: (b) => ((body = b), res) };
    await getTableByToken({ scope: { table: { _id: oid(), tableNumber: 1 }, restaurantId: RID, outletId: null }, query: {} }, res, (e) => { throw e; });
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve(qrPath)];
  }
  assert.deepEqual(body.data.menu.map((m) => m.name), ["Mains"]);
});

// The controller's lazy requires (socket, Knot Eats), faked for one call.
const withFakes = async (fakes, fn) => {
  const orig = Module._load;
  Module._load = function (req) {
    return Object.prototype.hasOwnProperty.call(fakes, req) ? fakes[req] : orig.apply(this, arguments);
  };
  try {
    return await fn();
  } finally {
    Module._load = orig;
  }
};

test("D6/M10: the sold-out switch goes live on the tills, QR, website and Knot Eats without a Publish", async (t) => {
  const { toggleDishAvailability } = r("controllers/menuController");
  const menu = published({ name: "Mains" }, { name: "Biryani" });
  const itemId = menu.items[0]._id;
  t.mock.method(Menu, "findOne", async () => menu);
  t.mock.method(menu, "save", async () => menu);
  const emitted = [];
  let invalidated = 0;
  const fakes = {
    "../services/socket": { emitToRestaurant: (rid, event, payload) => emitted.push({ rid, event, payload }) },
    "../services/knotEats": { invalidateListing: () => (invalidated += 1) },
  };
  let failed;
  const res = { status: () => res, json: () => res };
  await withFakes(fakes, () =>
    toggleDishAvailability({ params: { menuId: String(menu._id), itemId: String(itemId) }, user: { _id: oid(), restaurantId: RID } }, res, (e) => (failed = e)),
  );
  assert.equal(failed, undefined);
  assert.equal(menu.items[0].isAvailable, false, "draft");
  assert.equal(menu.systemSnapshot.items.id(itemId).isAvailable, false, "tills and table QR");
  assert.equal(menu.websiteSnapshot.items.id(itemId).isAvailable, false, "website and Knot Eats");
  assert.deepEqual(projectMenus([menu], AUDIENCES.SYSTEM)[0].items.map((i) => i.isAvailable), [false]);
  assert.equal(invalidated, 1, "Knot Eats listing rebuilt");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, "menu:updated");
  assert.equal(String(emitted[0].rid), String(RID));
  assert.deepEqual(Object.keys(emitted[0].payload).sort(), ["count", "publishedAt", "target"], "same shape as a Publish");
});

test("V6: a required option group needs at least one option; an optional one may be empty", async (t) => {
  const MenuGroup = r("models/menuGroupModel");
  const { saveMenuGroup } = r("controllers/menuController");
  t.mock.method(MenuGroup, "findOne", () => ({ lean: async () => null }));
  t.mock.method(MenuGroup, "exists", async () => null);
  t.mock.method(MenuGroup, "countDocuments", async () => 0);
  const writes = t.mock.method(MenuGroup, "updateOne", async () => ({}));
  const save = async (body) => {
    let error;
    await saveMenuGroup({ body, user: { _id: oid(), restaurantId: RID } }, { status: () => ({ json: () => {} }) }, (e) => (error = e));
    return error;
  };
  const refused = await save({ groupName: "Choose bread", required: true, options: [] });
  assert.equal(refused?.status, 400);
  assert.equal(refused?.message, "Add at least one option to this group.");
  assert.equal(writes.mock.callCount(), 0, "nothing saved");
  assert.equal(await save({ groupName: "Extras", required: false, options: [] }), undefined, "optional empty group");
  assert.equal(await save({ groupName: "Choose bread", required: true, options: [{ name: "Roti", price: 0 }] }), undefined);
  assert.equal(writes.mock.callCount(), 2);
});
