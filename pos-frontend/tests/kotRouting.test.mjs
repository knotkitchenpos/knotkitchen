import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { menuIndex, normalizeRoute, routeKot, routeSummary, routeTakes, unassignedItems } from "../src/utils/kotRouting.js";

const src = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

// The owner's example: a Pizza category of four, and Drinks.
const menus = [
  {
    _id: "pizza",
    name: "Pizza",
    items: [
      { _id: "marg", name: "Margherita Pizza" },
      { _id: "chick", name: "Chicken Pizza" },
      { _id: "paneer", name: "Paneer Pizza" },
      { _id: "cheese", name: "Cheese Pizza" },
    ],
  },
  { _id: "drinks", name: "Drinks", items: [{ _id: "cola", name: "Cola" }, { _id: "chai", name: "Masala Chai" }] },
];
const lookup = menuIndex(menus);
const line = (id, name) => ({ menuItemId: id, name, quantity: 1 });

test("a category prints all its products; one switched off stays off; a later product of it is included", () => {
  const route = { all: false, categories: ["pizza"], excluded: ["chick"] };
  assert.equal(routeTakes(route, "marg", "pizza"), true);
  assert.equal(routeTakes(route, "chick", "pizza"), false, "Chicken Pizza switched off for this printer");
  assert.equal(routeTakes(route, "newpizza", "pizza"), true, "a pizza added to the menu later prints here too");
  assert.equal(routeTakes(route, "cola", "drinks"), false);
  assert.equal(routeTakes({ all: true }, "cola", "drinks"), true);
  assert.equal(routeTakes(undefined, "x", "y"), true, "no route: everything, as one kitchen printer always did");
  assert.deepEqual(normalizeRoute({ all: false, categories: ["a", "a", ""], excluded: null }), { all: false, categories: ["a"], excluded: [] });
});

test("a KOT is split per printer; the same product can go to several; the rest go to the receipt printer", () => {
  const kitchens = [
    { id: "p1", label: "Pizza oven", type: "usb", route: { all: false, categories: ["pizza"], excluded: ["chick"] } },
    { id: "p2", label: "Grill", type: "lan", route: { all: false, categories: ["pizza"], excluded: ["marg", "paneer", "cheese"] } },
    { id: "p3", label: "Pass", type: "bluetooth", route: { all: false, categories: ["pizza"], excluded: [] } },
  ];
  const lines = [line("marg", "Margherita Pizza"), line("chick", "Chicken Pizza (Large)"), line("cola", "Cola")];
  const t = routeKot({ lines, kitchens, receipt: { type: "usb" }, lookup });
  const by = Object.fromEntries(t.map((x) => [x.id, x.items.map((i) => i.menuItemId)]));
  assert.deepEqual(by.p1, ["marg"], "Chicken Pizza is off on the oven");
  assert.deepEqual(by.p2, ["chick"]);
  assert.deepEqual(by.p3, ["marg", "chick"], "the same products on a second printer too");
  assert.deepEqual(by.receipt, ["cola"], "nobody takes Drinks: never lost, it prints on the receipt printer");
  assert.equal(t.find((x) => x.id === "receipt").label, "Not assigned");
});

test("unassigned lines go to the first kitchen printer when there is no receipt printer; no kitchen printers = receipt printer", () => {
  const kitchens = [{ id: "p1", label: "Oven", type: "usb", route: { all: false, categories: ["pizza"] } }];
  const t = routeKot({ lines: [line("cola", "Cola"), line("marg", "x")], kitchens, receipt: { type: "" }, lookup });
  assert.deepEqual(t.map((x) => [x.id, x.items.length]), [["p1", 2]]);
  const none = routeKot({ lines: [line("cola", "Cola")], kitchens: [], receipt: { type: "usb" }, lookup });
  assert.deepEqual(none.map((x) => x.id), ["receipt"]);
  assert.deepEqual(routeKot({ lines: [], kitchens, receipt: {}, lookup }), []);
});

test("an order line is matched by its dish id, else by its name without the variant", () => {
  assert.deepEqual(lookup({ menuItemId: "cola" }), { itemId: "cola", categoryId: "drinks" });
  assert.deepEqual(lookup({ name: "Chicken Pizza (Large)" }), { itemId: "chick", categoryId: "pizza" });
  assert.deepEqual(lookup({ name: "masala chai" }), { itemId: "chai", categoryId: "drinks" });
  assert.equal(lookup({ name: "Unknown" }), null);
  // A website / QR / Knot Eats line keeps its CATEGORY in menuItemId and the dish in itemId.
  assert.deepEqual(lookup({ menuItemId: "pizza", itemId: "chick", name: "Renamed" }), { itemId: "chick", categoryId: "pizza" });
});

test("a kitchen device with no menu saved fetches it before routing; a table round carries its dish ids", () => {
  const print = src("utils/printReceipt.js");
  const kot = print.slice(print.indexOf("export const printKot"), print.indexOf("export const printReport"));
  assert.match(kot, /if \(!forced && needsMenu\(kitchens\)\) \{/);
  assert.match(kot, /if \(!menus && lines\.some\(\(l\) => !lookup\(l\)\)\) \{\s+menu = \(await loadSystemMenu\(\)/);
  const socket = fs.readFileSync(new URL("../../pos-backend/services/socket.js", import.meta.url), "utf8");
  const round = socket.slice(socket.indexOf("const emitKitchenRound"), socket.indexOf('emitEvent("kitchen:round"'));
  assert.match(round, /menuItemId: i\.menuItemId \? String\(i\.menuItemId\) : undefined,/);
  assert.match(round, /itemId: i\.itemId \? String\(i\.itemId\) : undefined,/);
});

test("printers copied from another takeaway on the device print everything until this one chooses", async () => {
  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  for (const n of ["localStorage", "sessionStorage"]) Object.defineProperty(globalThis, n, { value: store, configurable: true, writable: true });
  try {
    mem.set("kk.receiptPrinter.v1:OTHER", JSON.stringify({ type: "usb", kitchens: [{ id: "k1", type: "lan", label: "Oven", route: { all: false, categories: ["theirs"] } }] }));
    const { loadPrinterConfig } = await import("../src/utils/printerDevice.js");
    const c = loadPrinterConfig();
    assert.equal(c.kitchens[0].label, "Oven");
    assert.deepEqual(c.kitchens[0].route, { all: true, categories: [], excluded: [] });
  } finally {
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  }
});

test("the screen shows what each printer covers, and what no printer takes", () => {
  const s = routeSummary({ all: false, categories: ["pizza"], excluded: ["chick"] }, menus);
  assert.deepEqual(s.categories, [{ id: "pizza", name: "Pizza", on: 3, total: 4 }]);
  assert.deepEqual(routeSummary({ all: true }, menus), { all: true, categories: [] });
  const kitchens = [{ route: { all: false, categories: ["pizza"], excluded: ["chick"] } }];
  assert.deepEqual(unassignedItems(kitchens, menus).map((i) => i.name), ["Chicken Pizza", "Cola", "Masala Chai"]);
  assert.deepEqual(unassignedItems([{ route: { all: true } }], menus), []);
});

test("the settings screen offers any number of kitchen printers, each with its routing", () => {
  const ui = src("components/settings/DeviceConfiguration.jsx");
  assert.match(ui, /const addKitchen = \(\) =>/);
  assert.match(ui, /<KotRoutingOverview kitchens=\{kitchens\}/);
  const panel = src("components/settings/KotRouting.jsx");
  // Ticking a category selects all its products: its switched-off ones are forgotten.
  assert.match(panel, /excluded: route\.excluded\.filter\(\(x\) => !itemIds\.includes\(x\)\)/);
  assert.match(panel, /onChange=\{\(v\) => toggleItem\(i\._id, v\)\}/);
  // The ticket says which printer it is for.
  assert.match(src("utils/receiptLayout.js"), /if \(station\) text\(String\(station\)\.toUpperCase\(\)/);
});
