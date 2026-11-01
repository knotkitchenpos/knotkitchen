import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { foodCostTone, linesCost } from "../src/utils/inventory.js";

const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the screens cost a recipe as the server does, each line in its item's unit", () => {
  const ingredients = [
    { _id: "c", name: "Cheese", unit: "kg", costPerUnit: 400 },
    { _id: "d", name: "Dough", unit: "pcs", costPerUnit: 20 },
    { _id: "b", name: "Basil", unit: "g", costPerUnit: 0 },
  ];
  assert.deepEqual(
    linesCost([{ ingredientId: "c", quantity: 100, unit: "g" }, { ingredientId: "d", quantity: 1, unit: "pcs" }, { ingredientId: "b", quantity: 2, unit: "g" }], ingredients),
    { cost: 60, missing: ["Basil"] },
  );
  assert.equal(foodCostTone(30, 35), "text-[#15803D]");
  assert.equal(foodCostTone(40, 35), "text-[#B45309]");
  assert.equal(foodCostTone(56, 35), "text-[#B91C1C]");
});

test("Inventory Management has the new tabs (owner, 2026-11-01)", () => {
  const view = SRC("src/components/settings/InventoryView.jsx");
  for (const [k, l] of [["costs", "Dish costs"], ["addons", "Add-ons"], ["count", "Stock count"], ["reports", "Reports"]]) {
    assert.ok(view.includes(`["${k}", "${l}"]`), l);
  }
  // Items: packs, keeps-for days, prepared items with a batch recipe, a Make action, use-by warnings.
  assert.match(view, /Packs you buy it in/);
  assert.match(view, /Keeps for \(days\)/);
  assert.match(view, /makePreparedBatch\(item\._id, \{ quantity: Number\(amount\), force \}\)/);
  assert.match(view, /if \(d\?\.code === "STOCK_SHORT"\) \{/);
  assert.match(view, /Use first:/);
  assert.match(view, /\.\.\.\(pack \? \{ pack: pack\.name \} : \{ unit \}\),/);
  // Manage Menu's product form shows the cost against the price.
  assert.match(SRC("src/components/dashboard/manageMenu/RecipeSection.jsx"), /Costs <b>\{rupees\(cost\)\}<\/b> to make/);
  assert.match(SRC("src/components/dashboard/manageMenu/ProductDrawer.jsx"), /price=\{Number\(prodPrice\) \|\| 0\}/);
});

test("a stock count hides what the system expects until it is finished, and saves as you type", () => {
  const count = SRC("src/components/settings/inventory/CountTab.jsx");
  assert.match(count, /const t = setTimeout\(\(\) => saveMut\.mutate\(\), 1200\);/);
  assert.ok(!/expected/.test(count.slice(count.indexOf("const Counting"), count.indexOf("const CountTab"))), "no expected figure while counting");
  assert.match(count, /System said \{qty\(l\.expected\)\}/);
});

test("the Groups panel sends each component's old name and shows what it uses from stock", async () => {
  const { groupEditorPayload } = await import("../src/utils/modifierGroups.js");
  const p = groupEditorPayload({ name: "Crust", selectionType: "single", options: [{ name: "Cheese Burst Crust", price: 60, was: "Cheese Burst" }, { name: "Thin", price: 0, was: "Thin" }, { name: "New", price: 10 }] });
  assert.deepEqual(p.options, [{ name: "Cheese Burst Crust", price: 60, oldName: "Cheese Burst" }, { name: "Thin", price: 0 }, { name: "New", price: 10 }]);
  const drawer = SRC("src/components/dashboard/manageMenu/GroupDrawer.jsx");
  assert.match(drawer, /was: o\?\.name \|\| ""/);
  assert.match(drawer, /copy\[editingCompIndex\] = \{ \.\.\.copy\[editingCompIndex\], name: extraNameInput\.trim\(\), price: String\(numPrice\) \};/);
  assert.match(drawer, /navigate\("\/settings\?view=inventory&tab=addons"\)/);
  assert.match(SRC("src/components/settings/InventoryView.jsx"), /TABS\.some\(\(\[k\]\) => k === params\.get\("tab"\)\)/);
});
