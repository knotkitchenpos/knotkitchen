import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UNITS, unitsLike, unitLabel, recipeForSave, STATUS, stockShortfalls, shortfallText, convertQty } from "../src/utils/inventory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// Inventory Management: a Settings option below Manage Menu, a dashboard with
// a status per item, a Recipe section in the product form, and a POS alert
// when an item needs restocking.

test("Inventory Management is option 5, directly below Manage Menu, on the POS plan", () => {
  const menu = SRC("src/constants/settingsMenu.js");
  const lines = menu.split("\n").filter((l) => /^\s*\{ id: "/.test(l));
  const ids = lines.map((l) => /id: "([^"]+)"/.exec(l)[1]);
  assert.equal(ids[ids.indexOf("menu") + 1], "inventory");
  assert.match(menu, /\{ id: "inventory", title: "5\. Inventory Management", [^\n]*mode: "view", feature: "pos" \}/);
  // Shown always now, not behind the later-features switch.
  const later = menu.slice(menu.indexOf("...(SHOW_LATER_FEATURES"), menu.indexOf(": []),"));
  assert.doesNotMatch(later, /id: "inventory"/);
  // Numbered 1..16 with no gap or repeat.
  const numbers = lines.map((l) => /title: "(\d+)\. /.exec(l)?.[1]).filter(Boolean).map(Number);
  assert.deepEqual(numbers, Array.from({ length: numbers.length }, (_, i) => i + 1));
  assert.match(SRC("src/pages/Settings.jsx"), /view === "inventory" \? \(\s*<InventoryView \/>/);
});

test("units: a dropdown offers only units of the item's kind", () => {
  assert.deepEqual(unitsLike("kg").map((u) => u.code), ["g", "kg"]);
  assert.deepEqual(unitsLike("L").map((u) => u.label), ["ML", "Litre"]);
  assert.deepEqual(unitsLike("pcs").map((u) => u.code), ["pcs", "dozen"]);
  assert.equal(unitLabel("pcs"), "Piece");
  assert.deepEqual(UNITS.map((u) => u.code).sort(), ["L", "dozen", "g", "kg", "ml", "pack", "pcs"], "the server's list");
  assert.deepEqual(Object.values(STATUS).map((s) => s.label), ["In Stock", "Low Stock", "Out of Stock", "Maximum Stock Reached"]);
});

test("the dashboard shows the counts and every item's stock, minimum, maximum, cost price and status", () => {
  const view = SRC("src/components/settings/InventoryView.jsx");
  for (const label of ["Total items", "Low stock", "Out of stock", "At maximum stock"]) assert.match(view, new RegExp(`label="${label}"`));
  for (const col of ["Current stock", "Min", "Max", "Cost price", "Status"]) assert.match(view, new RegExp(`>${col}</th>`));
  assert.match(view, /<StatusBadge status=\{i\.status\} \/>/, "the status the server worked out");
  // Stock entry: quantity, a unit of the item's kind, and the total cost.
  assert.match(view, /unitsLike\(item\.unit\)\.map/);
  assert.match(view, /totalCost: type === "purchase" && cost !== "" \? Number\(cost\) : undefined/);
  assert.match(view, /Total cost price \(₹\)/);
  // Minimum and maximum on the item form, with the range checked.
  assert.match(view, /Minimum stock \(\{u\}\)/);
  assert.match(view, /Maximum stock \(\{u\}\)/);
  assert.match(view, /const badRange = max > 0 && max <= min;/);
});

test("the product form's Recipe sits below the price and is sent with the product", () => {
  const drawer = SRC("src/components/dashboard/manageMenu/ProductDrawer.jsx");
  const price = drawer.indexOf("Same Price for All Channels");
  const recipe = drawer.indexOf("<RecipeSection");
  const save = drawer.indexOf("onClick={handleSaveProduct}");
  assert.ok(price > 0 && recipe > price && save > recipe, "price, then Recipe, then Save");
  assert.match(drawer, /recipe: recipeForSave\(recipe\),/);
  const section = SRC("src/components/dashboard/manageMenu/RecipeSection.jsx");
  assert.match(section, /features\?\.pos !== false/, "hidden on a plan without inventory");
  assert.match(section, /unitsLike\(unitOf\(r\.ingredientId\)\)/, "each line in a unit of its item's kind");
  assert.match(section, /refetchOnMount: "always"/, "never the recipe from before the last save");
  assert.match(section, /onChange\(null\); \/\/ never the last product's recipe while this one loads/);
});

test("recipeForSave: sent when on, or when switching a saved one off; otherwise left out", () => {
  const rows = [
    { ingredientId: "dough", quantity: "1", unit: "pcs" },
    { ingredientId: "cheese", quantity: "20", unit: "g" },
    { ingredientId: "", quantity: "5", unit: "" },
    { ingredientId: "sausage", quantity: "", unit: "g" },
  ];
  assert.deepEqual(recipeForSave({ enabled: true, existed: false, rows }), {
    enabled: true,
    ingredients: [
      { ingredientId: "dough", quantity: 1, unit: "pcs" },
      { ingredientId: "cheese", quantity: 20, unit: "g" },
    ],
  });
  assert.equal(recipeForSave({ enabled: false, existed: true, rows }).enabled, false, "switching a saved recipe off reaches the server");
  assert.equal(recipeForSave({ enabled: false, existed: false, rows }), undefined, "a product that never had one sends nothing");
  assert.equal(recipeForSave(null), undefined, "not loaded yet: the server keeps what it has");
});

test("the POS shows a restock alert, live and on open, only on the POS plan", () => {
  const alert = SRC("src/components/dashboard/RestockAlert.jsx");
  assert.match(alert, /socket\.on\("inventory:restock", onRestock\);/);
  assert.match(alert, /socket\.off\("inventory:restock", onRestock\);/);
  assert.match(alert, /getRestockAlerts\(\)/, "what already needs restocking when the POS opens");
  assert.match(alert, /navigate\("\/settings\?view=inventory"\)/);
  assert.match(SRC("src/App.jsx"), /\{tableService && <RestockAlert \/>\}/);
  assert.match(SRC("src/https/index.js"), /export const getRestockAlerts = \(\) => axiosWrapper\.get\("\/api\/inventory\/alerts"\);/);
});

// ---------------------------------------------------------------------------
// Stock never below 0 (owner, 2026-10-28): 2 Pizza Dough, 1 per pizza,
// minimum 1. The first pizza leaves 1; the second asks "Only 1 in stock. Do
// you want to continue?"; at 0 the till offers to turn the pizzas off.
// ---------------------------------------------------------------------------

const stockOf = (dough, cheese = 1) => ({
  items: [
    { _id: "dough", name: "Pizza Dough", unit: "pcs", stockQuantity: dough },
    { _id: "cheese", name: "Mozzarella Cheese", unit: "kg", stockQuantity: cheese },
  ],
  recipes: [
    { menuItemId: "pizza", yield: 1, ingredients: [{ ingredientId: "dough", quantity: 1, unit: "pcs" }, { ingredientId: "cheese", quantity: 20, unit: "g" }] },
    { menuItemId: "margherita", yield: 1, ingredients: [{ ingredientId: "dough", quantity: 1, unit: "pcs" }] },
  ],
});

test("a pizza that would use up the last dough asks first; one that leaves some does not", () => {
  assert.deepEqual(stockShortfalls([], { menuItemId: "pizza", quantity: 1 }, stockOf(2)), [], "2 dough, 1 pizza: 1 left");
  const short = stockShortfalls([], { menuItemId: "pizza", quantity: 1 }, stockOf(1));
  assert.deepEqual(short.map((i) => [i.name, i.stockQuantity]), [["Pizza Dough", 1]]);
  assert.equal(shortfallText(short[0]), "Only 1 Pizza Dough in stock.");
});

test("the whole cart counts: a pizza already in it, or another dish on the same dough", () => {
  const stock = stockOf(2);
  assert.deepEqual(stockShortfalls([{ menuItemId: "pizza", quantity: 1 }], { menuItemId: "pizza", quantity: 1 }, stock).map((i) => i.name), ["Pizza Dough"]);
  assert.deepEqual(stockShortfalls([{ menuItemId: "margherita", quantity: 1 }], { menuItemId: "pizza", quantity: 1 }, stock).map((i) => i.name), ["Pizza Dough"]);
  // The recipe's 20 g comes off a shelf counted in kg: 0.02 kg left is used up by one pizza.
  const cheese = stockShortfalls([], { menuItemId: "pizza", quantity: 1 }, stockOf(10, 0.02));
  assert.equal(shortfallText(cheese[0]), "Only 0.02 KG Mozzarella Cheese in stock.");
  assert.equal(convertQty(20, "g", "kg"), 0.02);
  assert.equal(convertQty(1, "g", "pcs"), null);
});

test("nothing left says so; a dish with no recipe or no stock list never asks", () => {
  assert.equal(shortfallText(stockShortfalls([], { menuItemId: "pizza", quantity: 1 }, stockOf(0))[0]), "Pizza Dough is out of stock.");
  assert.deepEqual(stockShortfalls([], { menuItemId: "chai", quantity: 1 }, stockOf(0)), []);
  assert.deepEqual(stockShortfalls([], { menuItemId: "pizza", quantity: 1 }, undefined), [], "offline before the first fetch");
});

test("the till checks before a dish goes in, and asks the two product questions after", () => {
  const panel = SRC("src/components/pos/ProductPanel.jsx");
  assert.equal((panel.match(/guardStock\((item|customizingItem)\._id, 1, /g) || []).length, 2, "both ways into the cart");
  assert.match(SRC("src/components/pos/OrderPanel.jsx"), /guardStock\(item\.menuItemId, 1, \(\) =>/, "the + button");
  assert.match(SRC("src/hooks/useRealtimeSync.js"), /"inventory:stock": \["stock-availability", "inventory"\]/);
  const alert = SRC("src/components/dashboard/RestockAlert.jsx");
  assert.match(alert, /title=\{`\$\{asking\.name\} is out of stock\.`\}/);
  assert.match(alert, /Do you want to turn off all products using this item\?/);
  assert.match(alert, /Items are back in stock\./);
  assert.match(alert, /Do you want to turn on the products that were previously turned off due to stock shortage\?/);
});

test("REGRESSION: the till never asks for inventory on the Billing plan", () => {
  // The stock check ran for every store, the server refused it on the Billing
  // plan, and the till popped "Upgrade to the POS plan" (owner, 2026-10-29).
  const guard = SRC("src/hooks/useStockGuard.jsx");
  assert.match(guard, /const inventoryOn = Boolean\(subRes\) && subRes\?\.data\?\.data\?\.features\?\.pos !== false;/);
  assert.match(guard, /enabled: inventoryOn,/);
  const recipe = SRC("src/components/dashboard/manageMenu/RecipeSection.jsx");
  assert.match(recipe, /const available = Boolean\(subRes\) && subRes\?\.data\?\.data\?\.features\?\.pos !== false;/);
});
