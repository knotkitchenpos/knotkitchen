/**
 * "The menu editor silently changes option rules."
 *
 * Saving a product, Add Group (bulk or in the product drawer) and deleting one
 * component all sent a group WITHOUT `maxSelectionEnabled`, and the server
 * read the silence as "Maximum Selection off". A choose-one Bread group became
 * choose-any, so a guest could order 2 breads on the website, Knot Eats and
 * table QR, and the server accepted it. The product save also swapped the
 * groups wholesale, so a switched-off group came back on and every position
 * reset to 0. Dragging one group in the Groups list re-sorted the groups on
 * all 18 sandwiches.
 *
 * Real controllers and models; only the database calls are stubbed, over
 * hydrated documents held in memory.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Menu = require("../models/menuModel");
const MenuGroup = require("../models/menuGroupModel");
const ctrl = require("../controllers/menuController");
const { toPublicProduct } = require("../controllers/storefrontController");
const { buildItemIndex, priceLine } = require("../services/orderPricingService");
const { calculateUnitPrice } = require("../services/price");

const oid = () => new mongoose.Types.ObjectId();
const user = { _id: oid(), role: "Owner", restaurantId: oid() };
const TZ = "Asia/Kolkata";

// Choose one bread; Rye is sold out.
const bread = () => ({
  _id: oid(),
  name: "Bread",
  required: true,
  minSelections: 1,
  maxSelections: 1,
  maxSelectionEnabled: true,
  groupType: "choice",
  isActive: true,
  sortOrder: 0,
  options: [
    { _id: oid(), name: "White", price: 0 },
    { _id: oid(), name: "Brown", price: 10 },
    { _id: oid(), name: "Rye", price: 10, isAvailable: false },
  ],
});
const extras = (sortOrder = 1) => ({
  _id: oid(),
  name: "Extras",
  maxSelections: 5,
  maxSelectionEnabled: false,
  isActive: true,
  sortOrder,
  options: [{ _id: oid(), name: "Cheese", price: 20 }],
});
// Switched off, and required: it must stay off.
const sauce = (sortOrder = 2) => ({
  _id: oid(),
  name: "Sauce",
  required: true,
  maxSelections: 1,
  maxSelectionEnabled: true,
  isActive: false,
  sortOrder,
  options: [{ _id: oid(), name: "Mayo", price: 0 }],
});

const LIBRARY = [
  { name: "Bread", required: true, maxSelectionEnabled: true, maxSelections: 1, isActive: true, sortOrder: 0, options: [{ name: "White", price: 0 }, { name: "Brown", price: 10 }, { name: "Rye", price: 10 }] },
  { name: "Extras", required: false, maxSelectionEnabled: false, maxSelections: 5, isActive: true, sortOrder: 1, options: [{ name: "Cheese", price: 20 }] },
  { name: "Sauce", required: true, maxSelectionEnabled: true, maxSelections: 1, isActive: false, sortOrder: 2, options: [{ name: "Mayo", price: 0 }] },
];

const makeMenus = () => [
  {
    _id: oid(),
    name: "Sandwiches",
    createdBy: user._id,
    restaurantId: user.restaurantId,
    items: Array.from({ length: 18 }, (_, i) => ({
      _id: oid(),
      name: `Sandwich ${i + 1}`,
      price: 100,
      category: "Sandwiches",
      modifierGroups: [bread(), extras(), sauce()],
    })),
  },
  {
    _id: oid(),
    name: "Mains",
    createdBy: user._id,
    restaurantId: user.restaurantId,
    items: [
      { _id: oid(), name: "Burger", price: 150, category: "Mains", modifierGroups: [{ ...sauce(0) }, { ...bread(), sortOrder: 1 }] },
      { _id: oid(), name: "Wrap", price: 120, category: "Mains", modifierGroups: [extras(0)] },
    ],
  },
].map((m) => Menu.hydrate(JSON.parse(JSON.stringify(m))));

const nameOf = (f) => f?.name;
const matches = (row, f) => {
  const n = nameOf(f);
  if (n === undefined) return true;
  return typeof n === "object" && n.$in ? n.$in.includes(row.name) : row.name === n;
};
// What a Mongoose query gives: awaitable, or .lean() for plain copies.
const query = (docs, plain = docs) => ({
  lean: async () => plain,
  then: (resolve, reject) => Promise.resolve(docs).then(resolve, reject),
});

/** An in-memory store behind the real Menu and MenuGroup models. */
const setup = (t, { library = LIBRARY } = {}) => {
  const menus = makeMenus();
  const rows = library.map((r) => JSON.parse(JSON.stringify(r)));
  const saved = [];
  const m = t.mock.method.bind(t.mock);

  m(Menu, "findOne", (f) => query(menus.find((x) => String(x._id) === String(f._id)) || null));
  m(Menu, "find", () => query(menus, menus.map((x) => x.toObject())));
  m(Menu, "exists", async (f) =>
    menus.some((x) => x.items.some((i) => i.modifierGroups.some((g) => g.name === f["items.modifierGroups.name"]))));
  m(Menu.prototype, "save", async function save() {
    saved.push(this.name);
    return this;
  });

  m(MenuGroup, "find", (f) => query(rows.filter((r) => matches(r, f))));
  m(MenuGroup, "findOne", (f) => query(rows.find((r) => matches(r, f)) || null));
  m(MenuGroup, "exists", async (f) => rows.some((r) => matches(r, f)));
  m(MenuGroup, "countDocuments", async () => rows.length);
  m(MenuGroup, "updateOne", async (f, u) => {
    let row = rows.find((r) => matches(r, f));
    if (!row) {
      row = { name: f.name, ...(u.$setOnInsert || {}) };
      rows.push(row);
    }
    Object.assign(row, u.$set || {});
  });
  m(MenuGroup, "deleteOne", async (f) => {
    const i = rows.findIndex((r) => matches(r, f));
    if (i >= 0) rows.splice(i, 1);
  });
  m(MenuGroup, "bulkWrite", async (ops) => {
    for (const { updateOne } of ops) {
      const row = rows.find((r) => matches(r, updateOne.filter));
      if (row) Object.assign(row, updateOne.update.$set);
    }
  });

  const item = (name) => menus.flatMap((x) => x.items).find((i) => i.name === name);
  const menuOf = (name) => menus.find((x) => x.items.some((i) => i.name === name));
  const group = (itemName, groupName) => item(itemName).modifierGroups.find((g) => g.name === groupName);
  return { menus, rows, saved, item, menuOf, group };
};

const call = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      status(code) {
        this.code = code;
        return this;
      },
      json(body) {
        resolve({ code: this.code, body });
      },
    };
    handler({ user, params: {}, body: {}, ...req }, res, (err) => (err ? reject(err) : resolve(null)));
  });

const rulesOf = (g) => ({
  required: g.required,
  minSelections: g.minSelections,
  maxSelectionEnabled: g.maxSelectionEnabled,
  maxSelections: g.maxSelections,
  groupType: g.groupType,
  isActive: g.isActive,
});
const CHOOSE_ONE = { required: true, minSelections: 1, maxSelectionEnabled: true, maxSelections: 1, groupType: "choice", isActive: true };

/** Two breads must be refused on every server path a guest orders through. */
const assertTwoBreadsRefused = (s, itemName) => {
  const menu = s.menuOf(itemName).toObject();
  const item = menu.items.find((i) => i.name === itemName);
  const g = item.modifierGroups.find((x) => x.name === "Bread");
  const [white, brown] = g.options;
  const pick = (...opts) => opts.map((o) => ({ groupId: String(g._id), optionId: String(o._id), quantity: 1 }));
  const line = (opts) => ({ menuId: String(menu._id), itemId: String(item._id), quantity: 1, modifierSelections: pick(...opts) });
  const index = buildItemIndex([menu]);

  // Website and Knot Eats.
  assert.doesNotThrow(() => priceLine(line([white]), index, TZ), `${itemName}: one bread is fine`);
  assert.throws(() => priceLine(line([white, brown]), index, TZ), /at most 1/, `${itemName}: website took 2 breads`);
  // Table QR.
  assert.throws(
    () => calculateUnitPrice({ item, modifierSelections: pick(white, brown) }),
    /Maximum 1/,
    `${itemName}: table QR took 2 breads`,
  );
};

/** The payload the product drawer sent before this fix, still sent by older app builds. */
const lossyGroup = (name) => {
  const lib = LIBRARY.find((g) => g.name === name);
  return { name, required: lib.required, maxSelections: lib.maxSelections, options: lib.options };
};

test("REGRESSION: saving a product keeps every group exactly as stored", async (t) => {
  const s = setup(t);
  const before = s.group("Sandwich 1", "Bread").toObject();
  const menu = s.menuOf("Sandwich 1");

  await call(ctrl.updateDish, {
    params: { menuId: String(menu._id), itemId: String(s.item("Sandwich 1")._id) },
    body: { price: 110, modifierGroups: ["Bread", "Extras", "Sauce"].map(lossyGroup) },
  });

  const breadNow = s.group("Sandwich 1", "Bread");
  assert.deepEqual(rulesOf(breadNow), CHOOSE_ONE, "Bread must stay choose-one");
  assert.equal(String(breadNow._id), String(before._id), "the group keeps its id");
  assert.equal(breadNow.options.find((o) => o.name === "Rye").isAvailable, false, "sold-out Rye stays off");
  assert.equal(s.group("Sandwich 1", "Sauce").isActive, false, "a switched-off group stays off");
  assert.deepEqual(s.item("Sandwich 1").modifierGroups.map((g) => g.sortOrder), [0, 1, 2]);
  assert.equal(s.item("Sandwich 1").price, 110, "the edit itself still lands");
  assertTwoBreadsRefused(s, "Sandwich 1");
});

test("moving a group in one product's drawer changes only that product, and no option order", async (t) => {
  const s = setup(t);
  const optionOrder = s.group("Sandwich 1", "Bread").options.map((o) => o.name);

  await call(ctrl.updateDish, {
    params: { menuId: String(s.menuOf("Sandwich 1")._id), itemId: String(s.item("Sandwich 1")._id) },
    body: { modifierGroups: ["Extras", "Bread", "Sauce"].map(lossyGroup) },
  });

  assert.deepEqual(s.item("Sandwich 1").modifierGroups.map((g) => `${g.name}:${g.sortOrder}`), ["Extras:0", "Bread:1", "Sauce:2"]);
  assert.deepEqual(s.group("Sandwich 1", "Bread").options.map((o) => o.name), optionOrder);
  for (let i = 2; i <= 18; i += 1) {
    assert.deepEqual(s.item(`Sandwich ${i}`).modifierGroups.map((g) => g.name), ["Bread", "Extras", "Sauce"], `Sandwich ${i}`);
  }
  assert.deepEqual(rulesOf(s.group("Sandwich 1", "Bread")), CHOOSE_ONE);
});

test("REGRESSION: a group ticked on a product joins with the store's rules, not the payload's silence", async (t) => {
  const s = setup(t);
  await call(ctrl.updateDish, {
    params: { menuId: String(s.menuOf("Wrap")._id), itemId: String(s.item("Wrap")._id) },
    body: { modifierGroups: ["Extras", "Bread", "Sauce"].map(lossyGroup) },
  });
  const g = s.group("Wrap", "Bread");
  assert.equal(g.maxSelectionEnabled, true, "Bread added to Wrap must be choose-one");
  assert.equal(g.required, true);
  assert.equal(g.sortOrder, 1);
  assert.equal(s.group("Wrap", "Sauce").isActive, false, "the list has Sauce switched off");
  assertTwoBreadsRefused(s, "Wrap");
});

test("REGRESSION: groups ticked while creating a product are saved, choose-one intact", async (t) => {
  const s = setup(t);
  const menu = s.menuOf("Wrap");
  await call(ctrl.addDish, {
    body: { menuId: String(menu._id), name: "Club", price: 180, category: "Mains", modifierGroups: [lossyGroup("Bread")] },
  });
  const g = s.group("Club", "Bread");
  assert.ok(g, "Club was saved with no groups");
  assert.equal(g.maxSelectionEnabled, true);
  assertTwoBreadsRefused(s, "Club");
});

test("REGRESSION: bulk Add Group attaches choose-one as choose-one, after the product's groups", async (t) => {
  const s = setup(t);
  // The bulk payload as it was sent: no maxSelectionEnabled.
  await call(ctrl.bulkAddGroupToDishes, {
    body: { groupName: "Bread", dishIds: [String(s.item("Wrap")._id)], required: true, maxSelections: 1, options: LIBRARY[0].options },
  });
  const g = s.group("Wrap", "Bread");
  assert.equal(g.maxSelectionEnabled, true);
  assert.equal(g.sortOrder, 1, "lands after Wrap's Extras instead of colliding at 0");
  assertTwoBreadsRefused(s, "Wrap");
});

test("a group from before the store's list existed joins as its products have it", async (t) => {
  // No list row for Bread (the list arrived on 2026-09-25 with no backfill),
  // and an older app build sending the payload without the flag.
  const s = setup(t, { library: LIBRARY.filter((g) => g.name !== "Bread") });
  await call(ctrl.bulkAddGroupToDishes, {
    body: { groupName: "Bread", dishIds: [String(s.item("Wrap")._id)], required: true, maxSelections: 1, options: LIBRARY[0].options },
  });
  assert.equal(s.group("Wrap", "Bread").maxSelectionEnabled, true, "bulk add");
  assertTwoBreadsRefused(s, "Wrap");

  const menu = s.menuOf("Wrap");
  await call(ctrl.addDish, {
    body: { menuId: String(menu._id), name: "Club", price: 180, category: "Mains", modifierGroups: [lossyGroup("Bread")] },
  });
  assert.equal(s.group("Club", "Bread").maxSelectionEnabled, true, "ticked in the product drawer");
});

test("REGRESSION: deleting one component leaves every product's rules alone", async (t) => {
  const s = setup(t);
  const dishIds = s.menus.flatMap((m) => m.items).filter((i) => i.modifierGroups.some((g) => g.name === "Bread")).map((i) => String(i._id));
  assert.equal(dishIds.length, 19);

  // What Manage Menu sent (and older app builds still send): rules, but no flag.
  await call(ctrl.saveModifierGroupToDishes, {
    body: { groupName: "Bread", required: true, maxSelections: 1, options: [{ name: "Brown", price: 10 }, { name: "Rye", price: 10 }], dishIds },
  });

  for (const id of dishIds) {
    const item = s.menus.flatMap((m) => m.items).find((i) => String(i._id) === id);
    const g = item.modifierGroups.find((x) => x.name === "Bread");
    assert.equal(g.maxSelectionEnabled, true, `${item.name}: Bread turned choose-any`);
    assert.deepEqual(g.options.map((o) => o.name), ["Brown", "Rye"]);
    assert.equal(g.options.find((o) => o.name === "Rye").isAvailable, false, `${item.name}: sold-out Rye came back`);
  }
  assert.equal(s.rows.find((r) => r.name === "Bread").maxSelectionEnabled, true, "the store's list keeps it too");
});

test("an explicit rule change in the group editor still applies to every product", async (t) => {
  const s = setup(t);
  const dishIds = s.menus.flatMap((m) => m.items).filter((i) => i.modifierGroups.some((g) => g.name === "Extras")).map((i) => String(i._id));
  await call(ctrl.saveModifierGroupToDishes, {
    body: { groupName: "Extras", maxSelectionEnabled: true, maxSelections: 2, options: [{ name: "Cheese", price: 20 }], dishIds },
  });
  assert.equal(s.group("Sandwich 7", "Extras").maxSelectionEnabled, true);
  assert.equal(s.group("Wrap", "Extras").maxSelections, 2);
  assert.equal(s.rows.find((r) => r.name === "Extras").maxSelectionEnabled, true);
});

test("REGRESSION: renaming a group renames it in place instead of adding a copy", async (t) => {
  const s = setup(t);
  const dishIds = s.menus.flatMap((m) => m.items).filter((i) => i.modifierGroups.some((g) => g.name === "Bread")).map((i) => String(i._id));
  await call(ctrl.saveModifierGroupToDishes, {
    body: { groupName: "Bread Choice", oldGroupName: "Bread", options: LIBRARY[0].options, dishIds },
  });
  assert.deepEqual(s.item("Sandwich 1").modifierGroups.map((g) => g.name), ["Bread Choice", "Extras", "Sauce"]);
  assert.deepEqual(rulesOf(s.group("Sandwich 1", "Bread Choice")), CHOOSE_ONE);
  assert.deepEqual(s.rows.map((r) => r.name).sort(), ["Bread Choice", "Extras", "Sauce"]);
});

test("REGRESSION: dragging a group in the Groups list reorders the list only, not any product", async (t) => {
  const s = setup(t);
  const before = s.menus.map((m) => JSON.stringify(m.toObject().items.map((i) => i.modifierGroups)));

  await call(ctrl.reorderGroupsInDishes, { body: { groupOrder: ["Extras", "Bread", "Sauce"] } });

  assert.deepEqual(s.saved, [], "no product may be saved by a Groups-list drag");
  assert.deepEqual(s.menus.map((m) => JSON.stringify(m.toObject().items.map((i) => i.modifierGroups))), before);
  assert.deepEqual(
    [...s.rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.name),
    ["Extras", "Bread", "Sauce"],
  );
});

test("a group from before the store's list existed gets a row on drag, ruled as on its products", async (t) => {
  const s = setup(t, { library: LIBRARY.filter((g) => g.name !== "Bread") });
  await call(ctrl.reorderGroupsInDishes, { body: { groupOrder: ["Bread", "Extras", "Sauce"] } });
  const row = s.rows.find((r) => r.name === "Bread");
  assert.ok(row, "the drag of a group with no row did nothing");
  assert.equal(row.sortOrder, 0);
  assert.equal(row.maxSelectionEnabled, true);
  assert.equal(row.required, true);
  assert.deepEqual(s.saved, []);
});

test("a switched-off group is not offered on the website or Knot Eats", (t) => {
  const s = setup(t);
  const menu = s.menuOf("Sandwich 1").toObject();
  const product = toPublicProduct(menu.items[0], menu, TZ);
  assert.deepEqual(product.modifierGroups.map((g) => g.name), ["Bread", "Extras"]);
});

// ---------------------------------------------------------------------------
// Products the old bug already turned choose-any, and the server paths a guest
// or a till could still use to take 2 breads.
// ---------------------------------------------------------------------------

/** Production today: the list row says choose-one, every sandwich's Bread says choose-any. */
const damageBread = (s) => {
  for (let i = 1; i <= 18; i += 1) s.group(`Sandwich ${i}`, "Bread").maxSelectionEnabled = false;
};

test("REGRESSION: Edit Group, then Save, repairs products an old save turned choose-any", async (t) => {
  const s = setup(t);
  damageBread(s);
  const dishIds = s.menus.flatMap((m) => m.items).filter((i) => i.modifierGroups.some((g) => g.name === "Bread")).map((i) => String(i._id));
  // What the group editor sends now (utils/modifierGroups groupEditorPayload):
  // every rule as the form shows it, here unchanged from the list row.
  await call(ctrl.saveModifierGroupToDishes, {
    body: { groupName: "Bread", oldGroupName: "Bread", required: true, maxSelectionEnabled: true, maxSelections: 1, options: LIBRARY[0].options, dishIds },
  });
  for (let i = 1; i <= 18; i += 1) assert.deepEqual(rulesOf(s.group(`Sandwich ${i}`, "Bread")), CHOOSE_ONE, `Sandwich ${i}`);
  assertTwoBreadsRefused(s, "Sandwich 1");
});

test("migration 013 lists and repairs products whose rules differ from the group list, published copies included", () => {
  const { repairsFor, unlistedMixed } = require("../migrations/013-repair-group-rules");
  const menu = JSON.parse(JSON.stringify(makeMenus()[0].toObject()));
  menu.items[0].modifierGroups[0].maxSelectionEnabled = false; // damaged draft
  menu.items[1].modifierGroups[0].maxSelectionEnabled = false;
  // Tills sell the damaged copies; the website copy of item 2 is already right.
  menu.systemSnapshot = { items: JSON.parse(JSON.stringify(menu.items)) };
  menu.websiteSnapshot = { items: JSON.parse(JSON.stringify(menu.items)) };
  menu.websiteSnapshot.items[1].modifierGroups[0].maxSelectionEnabled = true;
  // Item 3: draft right, published copy different = an unpublished edit, left alone.
  menu.systemSnapshot.items[2].modifierGroups[0].maxSelectionEnabled = false;

  const rows = new Map(LIBRARY.map((r) => [r.name, r]));
  const { set, lines } = repairsFor(menu, rows);
  assert.equal(lines.length, 5, lines.join("\n"));
  assert.equal(set["items.0.modifierGroups.0.maxSelectionEnabled"], true);
  assert.equal(set["items.0.modifierGroups.0.maxSelections"], 1);
  assert.equal(set["systemSnapshot.items.1.modifierGroups.0.maxSelectionEnabled"], true);
  assert.equal(set["websiteSnapshot.items.0.modifierGroups.0.maxSelectionEnabled"], true);
  assert.equal("websiteSnapshot.items.1.modifierGroups.0.maxSelectionEnabled" in set, false);
  assert.equal("systemSnapshot.items.2.modifierGroups.0.maxSelectionEnabled" in set, false);
  assert.match(lines[0], /Sandwich 1 \/ Bread \[draft\]: required, any number -> required, max 1/);

  // Re-run after the repair: nothing left.
  for (const [path, v] of Object.entries(set)) {
    const keys = path.split(".");
    keys.slice(0, -1).reduce((o, k) => o[k], menu)[keys.at(-1)] = v;
  }
  assert.equal(repairsFor(menu, rows).lines.length, 0);
  // With no list row nothing says which copy is right: listed, never changed.
  assert.deepEqual(unlistedMixed([menu], new Map()), []);
  menu.items[0].modifierGroups[0].maxSelectionEnabled = false;
  assert.deepEqual(unlistedMixed([menu], new Map()).map((l) => l.split(":")[0]), ["Bread"]);
});

test("REGRESSION: Add Group of a switched-off group with no list row keeps it off on every product", async (t) => {
  const s = setup(t, { library: LIBRARY.filter((g) => g.name !== "Sauce") });
  await call(ctrl.bulkAddGroupToDishes, { body: { groupName: "Sauce", dishIds: [String(s.item("Wrap")._id)] } });
  assert.equal(s.group("Wrap", "Sauce").isActive, false);
  assert.equal(s.rows.find((r) => r.name === "Sauce").isActive, false, "the new list row came on");

  const menu = s.menuOf("Wrap");
  await call(ctrl.addDish, { body: { menuId: String(menu._id), name: "Club", price: 180, category: "Mains" } });
  await call(ctrl.bulkAddGroupToDishes, { body: { groupName: "Sauce", dishIds: [String(s.item("Club")._id)] } });
  assert.equal(s.group("Club", "Sauce").isActive, false, "guests ordering Club had to pick a sauce");
});

test("REGRESSION: renaming a group keeps its place in the list and its on/off", async (t) => {
  const dips = { name: "Dips", required: false, maxSelectionEnabled: false, maxSelections: 1, isActive: false, sortOrder: 0, options: [] };
  const s = setup(t, { library: [dips, ...LIBRARY.map((r) => ({ ...r, sortOrder: r.sortOrder + 1 }))] });

  // No products: the row is renamed in place.
  await call(ctrl.saveMenuGroup, { body: { groupName: "Dip", oldGroupName: "Dips", options: [] } });
  const dip = s.rows.find((r) => r.name === "Dip");
  assert.deepEqual([dip.sortOrder, dip.isActive], [0, false]);
  assert.equal(s.rows.some((r) => r.name === "Dips"), false);

  // Sauce (off, last) renamed on Burger only: Sauce stays, and the copy keeps its place and off.
  await call(ctrl.saveModifierGroupToDishes, {
    body: { groupName: "Sauces", oldGroupName: "Sauce", options: LIBRARY[2].options, dishIds: [String(s.item("Burger")._id)] },
  });
  const sauces = s.rows.find((r) => r.name === "Sauces");
  assert.deepEqual([sauces.sortOrder, sauces.isActive], [3, false]);
  assert.ok(s.rows.some((r) => r.name === "Sauce"), "18 sandwiches still carry Sauce");
  assert.equal(s.group("Burger", "Sauces").isActive, false);
});

test("REGRESSION: a crafted table QR selection cannot take 2 breads or money off", (t) => {
  const s = setup(t);
  const item = s.menuOf("Sandwich 1").toObject().items[0];
  const [bread, extrasGroup] = item.modifierGroups;
  const [white, brown] = bread.options;
  const cheese = extrasGroup.options[0];
  const sel = (g, o, extra = {}) => ({ groupId: String(g._id), optionId: o ? String(o._id) : undefined, quantity: 1, ...extra });
  const price = (modifierSelections) => calculateUnitPrice({ item, modifierSelections });

  // One entry naming two breads (id White, name Brown) is one bread: White.
  assert.deepEqual(price([sel(bread, white, { optionName: "Brown" })]).modifiers.map((m) => m.name), ["White"]);
  for (const crafted of [
    [sel(bread, white, { quantity: 0.5 }), sel(bread, brown, { quantity: 0.5 })],
    [sel(bread, white), sel(bread, brown), sel(bread, null, { optionName: "zzz", quantity: -1 })],
    [sel(bread, null, { optionName: "zzz" })], // a made-up option does not answer "required"
    [sel(bread, white), sel(extrasGroup, cheese, { quantity: -4 })],
  ]) {
    assert.throws(() => price(crafted), /Invalid selection/, JSON.stringify(crafted));
  }
  // Whole units still work: 2x Cheese bills twice.
  assert.equal(price([sel(bread, white), sel(extrasGroup, cheese, { quantity: 2 })]).unitPrice, 100 + 40);
});

test("REGRESSION: the till cannot ring up 2 breads in a choose-one group; an offline sale is kept", async () => {
  const { runAddOrder, gstWith } = require("./addOrderHarness");
  const menu = makeMenus()[0].toObject();
  menu.hasPublishedToSystem = true;
  menu.systemSnapshot = { name: menu.name, items: menu.items };
  const item = menu.items[0];
  const [white, brown] = item.modifierGroups[0].options;
  const pick = (...o) => o.map((x) => ({ groupName: "Bread", optionName: x.name, quantity: 1, price: x.price }));
  const body = (opts) => ({
    orderType: "collection",
    paymentMethod: "cash",
    items: [{ menuItemId: String(item._id), name: item.name, quantity: 1, price: 110, modifierSelections: pick(...opts) }],
    bills: { subtotal: 110, total: 110, tax: 0, totalWithTax: 110 },
  });
  const mocks = {
    "../models/menuModel": { find: () => ({ lean: async () => [menu] }) },
    "../services/gst": gstWith({ applicable: false, rate: 0, percent: 0, inclusive: false }),
  };

  const two = await runAddOrder({ body: body([white, brown]), mocks });
  assert.equal(two.error?.status, 400);
  assert.match(two.error.message, /Maximum 1 selection\(s\) for "Bread"/);
  assert.equal(two.saved.length, 0);

  const one = await runAddOrder({ body: body([brown]), mocks });
  assert.equal(one.status, 201, one.error?.message);

  const offline = await runAddOrder({ body: body([white, brown]), mocks, idempotencyKey: "offline:2breads" });
  assert.equal(offline.status, 201, "already sold and paid: kept, and logged");
});
