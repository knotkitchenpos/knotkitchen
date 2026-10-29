const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

/**
 * The menu CSV carries modifier groups (owner, 2026-10-29): the export lists
 * each product's groups and defines every group under the products; an import
 * puts them back, so a round trip no longer wipes the groups.
 */

const extraToppings = {
  name: "Extra Toppings",
  required: false,
  maxSelectionEnabled: false,
  maxSelections: 1,
  isActive: true,
  sortOrder: 0,
  options: [{ name: "Cheese", price: 30 }, { name: "Olives", price: 20 }],
};
const crust = {
  name: "Crust",
  required: true,
  maxSelectionEnabled: true,
  maxSelections: 1,
  isActive: true,
  sortOrder: 1,
  options: [{ name: "Thin", price: 0 }, { name: "Cheese Burst", price: 60 }],
};

/** The controller over an in-memory store: menus, the group list, and what the import writes. */
const load = (existingMenus, library) => {
  const saved = [];
  const upserts = [];
  let deleted = false;
  function Menu(doc) {
    Object.assign(this, doc);
    this.save = async () => saved.push(doc);
  }
  const chain = (rows) => ({ select: () => ({ lean: async () => rows }), sort: async () => rows, lean: async () => rows });
  Menu.find = () => chain(existingMenus);
  Menu.deleteMany = async () => { deleted = true; };
  const MenuGroup = {
    find: () => ({ sort: () => ({ lean: async () => library }), lean: async () => library }),
    countDocuments: async () => library.length,
    exists: async (q) => library.some((g) => g.name === q.name),
    updateOne: async (q, update) => upserts.push({ name: q.name, ...update.$set }),
  };
  const orig = Module._load;
  Module._load = function (request) {
    if (request === "../models/menuModel") return Menu;
    if (request === "../models/menuGroupModel") return MenuGroup;
    if (request === "../services/tenantContext") return { userScope: () => ({ restaurantId: "r1" }) };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../controllers/csvMenuController")];
  try {
    return { ctrl: require("../controllers/csvMenuController"), saved, upserts, wasDeleted: () => deleted };
  } finally {
    Module._load = orig;
  }
};

const user = { _id: "u1", restaurantId: "r1" };
const call = async (handler, body) => {
  const out = {};
  const res = {
    status: (code) => { out.code = code; return res; },
    json: (j) => { out.json = j; return res; },
    set: () => res,
    send: (text) => { out.text = text; return res; },
  };
  await handler({ body, user }, res, (err) => { out.err = err; });
  return out;
};

const menus = [
  {
    name: "Pizzas",
    items: [
      { name: "Margherita", price: 249, isVegetarian: true, modifierGroups: [{ ...crust, sortOrder: 0 }, { ...extraToppings, sortOrder: 1 }] },
      { name: "Garlic Bread", price: 99, isVegetarian: true, modifierGroups: [] },
    ],
  },
];

test("the export lists each product's groups in order and defines every group under the products", async () => {
  const { ctrl } = load(menus, [extraToppings, crust]);
  const { text } = await call(ctrl.exportCsv, {});
  const lines = text.split("\n");
  assert.equal(lines[0], "Category,Subcategory,Item Name,Description,Veg/Non-Veg,Price,Groups");
  assert.equal(lines[1], "Pizzas,,Margherita,,Veg,249,Crust | Extra Toppings");
  assert.equal(lines[2], "Pizzas,,Garlic Bread,,Veg,99,");
  const at = lines.indexOf("Group,Option,Option Price,Required,Max Selections,Active");
  assert.ok(at > 2, "the groups table follows the products");
  assert.deepEqual(lines.slice(at + 1), [
    "Extra Toppings,Cheese,30,No,,Yes",
    "Extra Toppings,Olives,20,No,,Yes",
    "Crust,Thin,0,Yes,1,Yes",
    "Crust,Cheese Burst,60,Yes,1,Yes",
  ]);
});

test("REGRESSION: importing that file puts every product's groups back, with their rules and options", async () => {
  const exported = (await call(load(menus, [extraToppings, crust]).ctrl.exportCsv, {})).text;
  // A fresh store: no groups yet, so everything comes from the file.
  const { ctrl, saved, upserts } = load([], []);
  const preview = await call(ctrl.previewCsvImport, { csvText: exported });
  assert.equal(preview.json.success, true);
  assert.deepEqual([preview.json.data.groupsCount, preview.json.data.extrasCount], [2, 4]);

  const out = await call(ctrl.confirmCsvImport, { csvText: exported });
  assert.equal(out.err, undefined);
  assert.match(out.json.message, /and 2 groups/);
  const items = Object.fromEntries(saved.flatMap((m) => m.items).map((i) => [i.name, i]));
  const groups = items.Margherita.modifierGroups;
  assert.deepEqual(groups.map((g) => [g.name, g.sortOrder]), [["Crust", 0], ["Extra Toppings", 1]]);
  assert.deepEqual([groups[0].required, groups[0].maxSelectionEnabled, groups[0].maxSelections], [true, true, 1]);
  assert.deepEqual(groups[0].options.map((o) => [o.name, o.price]), [["Thin", 0], ["Cheese Burst", 60]]);
  assert.equal(groups[1].maxSelectionEnabled, false, "no limit stays no limit");
  assert.deepEqual(items["Garlic Bread"].modifierGroups, []);
  // And the store's group list (Manage Menu's Groups tab) gets both.
  assert.deepEqual(upserts.map((u) => [u.name, u.required, u.options.length]), [["Extra Toppings", false, 2], ["Crust", true, 2]]);
});

test("an older CSV with no Groups column keeps each product's groups as they are", async () => {
  const { ctrl, saved } = load(menus, [extraToppings, crust]);
  const csvText = ["Category,Subcategory,Item Name,Description,Veg/Non-Veg,Price", "Pizzas,,Margherita,,Veg,259"].join("\n");
  const out = await call(ctrl.confirmCsvImport, { csvText });
  assert.equal(out.err, undefined);
  assert.deepEqual(saved[0].items[0].modifierGroups.map((g) => g.name), ["Crust", "Extra Toppings"]);
  assert.equal(saved[0].items[0].price, 259);
});

test("a product naming a group nobody has is refused before anything is replaced", async () => {
  const { ctrl, wasDeleted } = load(menus, [extraToppings]);
  const csvText = ["Category,Subcategory,Item Name,Description,Veg/Non-Veg,Price,Groups", "Pizzas,,Margherita,,Veg,249,Sauces"].join("\n");
  const out = await call(ctrl.confirmCsvImport, { csvText });
  assert.equal(out.code, 400);
  assert.match(out.json.errors[0], /Row 2: Group "Sauces" for "Margherita" is not in the Groups table or in Manage Menu\./);
  assert.equal(wasDeleted(), false, "the menu is untouched");
});

test("group rows are checked: price, Max Selections, Yes/No, and a required group needs an option", () => {
  const { ctrl } = load([], []);
  const { parseGroupSection } = ctrl.__csvForTest;
  const { errors } = parseGroupSection(
    [
      ["Group", "Option", "Option Price", "Required", "Max Selections", "Active"],
      ["Sauce", "Mayo", "-5", "Maybe", "0", "Yes"],
      ["Size", "", "", "Yes", "", ""],
    ],
    3,
  );
  assert.deepEqual(errors, [
    'Row 5: Invalid option price "-5". Must be numeric and non-negative.',
    "Row 5: Max Selections must be a whole number of 1 or more, or blank for no limit.",
    "Row 5: Required must be Yes or No.",
    'Group "Size": a required group needs at least one option.',
  ]);
});

test("a file saved from Excel, with the blank line turned into commas, still reads both tables", () => {
  const { ctrl } = load([], []);
  const { parseCsvLines, splitSections } = ctrl.__csvForTest;
  const rows = parseCsvLines(
    ["Category,Subcategory,Item Name,Description,Veg/Non-Veg,Price,Groups", "Pizzas,,Margherita,,Veg,249,Crust", ",,,,,,", "Group,Option,Option Price,Required,Max Selections,Active", "Crust,Thin,0,Yes,1,Yes"].join("\r\n"),
  );
  const { productRows, groupRows } = splitSections(rows);
  assert.equal(productRows.length, 2);
  assert.equal(groupRows.length, 2);
});

test("REGRESSION: a product that keeps its name keeps its id, so its inventory recipe still matches", async () => {
  // Every import gave every product a new _id, and recipes point at the _id:
  // after an import no sale took stock off (owner, 2026-10-29).
  const pizzaId = "6a0000000000000000000001";
  const chaiId = "6a0000000000000000000002";
  const store = [
    { name: "Pizzas", items: [{ _id: pizzaId, name: "Chicken Pizza", price: 299 }] },
    { name: "Drinks", items: [{ _id: chaiId, name: "Masala Chai", price: 40 }] },
  ];
  const { ctrl, saved } = load(store, []);
  const csvText = [
    "Category,Subcategory,Item Name,Description,Veg/Non-Veg,Price",
    "Pizzas,,Chicken Pizza,,Non-Veg,319", // same name, new price: same id
    "Beverages,,Masala Chai,,Veg,40", // moved category: same id
    "Pizzas,,Paneer Pizza,,Veg,279", // new product: a new id
  ].join("\n");
  const out = await call(ctrl.confirmCsvImport, { csvText });
  assert.equal(out.err, undefined);
  const items = Object.fromEntries(saved.flatMap((m) => m.items).map((i) => [i.name, i]));
  assert.equal(String(items["Chicken Pizza"]._id), pizzaId);
  assert.equal(String(items["Masala Chai"]._id), chaiId);
  assert.equal(items["Paneer Pizza"]._id, undefined);
});
