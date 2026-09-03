/**
 * Modifier group persistence.
 *
 * `isActive` and `sortOrder` were WRITTEN by the group active-toggle and
 * reorder endpoints but did not exist on modifierGroupSchema. Mongoose
 * subdocuments are strict, so both assignments were silently dropped on save:
 *
 *   - reordering reported "Groups reordered successfully!" and changed nothing;
 *   - a group switched off came back on as soon as the data was refetched,
 *     including after republishing a cache.
 *
 * These tests assert the schema actually carries the fields, which is the
 * whole reason the two features now work.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Menu = require("../models/menuModel");
const groupSchema = Menu.schema.path("items").schema.path("modifierGroups").schema;

test("REGRESSION: the group schema carries isActive and sortOrder", () => {
  // Without these paths every write to them is discarded without error.
  assert.ok(groupSchema.path("isActive"), "isActive missing — active toggle cannot persist");
  assert.ok(groupSchema.path("sortOrder"), "sortOrder missing — reorder cannot persist");
  assert.equal(groupSchema.path("isActive").defaultValue, true);
  assert.equal(groupSchema.path("sortOrder").defaultValue, 0);
});

test("a group switched off keeps isActive === false through a save", () => {
  const menu = new Menu({
    name: "Mains",
    createdBy: new mongoose.Types.ObjectId(),
    items: [
      {
        name: "Burger",
        price: 100,
        category: "Mains",
        modifierGroups: [{ name: "Sauces", options: [] }],
      },
    ],
  });

  const group = menu.items[0].modifierGroups[0];
  assert.equal(group.isActive, true, "groups start active");

  group.isActive = false;
  // toObject() is what a save serialises; a strict-schema drop shows up here.
  const serialised = menu.toObject().items[0].modifierGroups[0];
  assert.equal(serialised.isActive, false, "the off state must survive serialisation");
});

test("a reordered group keeps its sortOrder through a save", () => {
  const menu = new Menu({
    name: "Mains",
    createdBy: new mongoose.Types.ObjectId(),
    items: [
      {
        name: "Burger",
        price: 100,
        category: "Mains",
        modifierGroups: [
          { name: "Sauces", options: [] },
          { name: "Extras", options: [] },
        ],
      },
    ],
  });

  const groups = menu.items[0].modifierGroups;
  groups[0].sortOrder = 1;
  groups[1].sortOrder = 0;

  const serialised = menu.toObject().items[0].modifierGroups;
  assert.equal(serialised.find((g) => g.name === "Sauces").sortOrder, 1);
  assert.equal(serialised.find((g) => g.name === "Extras").sortOrder, 0);

  // And sorting by it produces the operator's chosen order.
  const ordered = [...serialised].sort((a, b) => a.sortOrder - b.sortOrder).map((g) => g.name);
  assert.deepEqual(ordered, ["Extras", "Sauces"]);
});

test("Maximum Selection is OFF by default, meaning no cap", () => {
  const menu = new Menu({
    name: "Mains",
    createdBy: new mongoose.Types.ObjectId(),
    items: [
      { name: "Burger", price: 100, category: "Mains", modifierGroups: [{ name: "Toppings", options: [] }] },
    ],
  });
  const group = menu.items[0].modifierGroups[0];
  assert.equal(group.maxSelectionEnabled, false, "a new group must not cap selections");
});

test("switching Maximum Selection on stores the cap", () => {
  const menu = new Menu({
    name: "Mains",
    createdBy: new mongoose.Types.ObjectId(),
    items: [
      {
        name: "Burger",
        price: 100,
        category: "Mains",
        modifierGroups: [{ name: "Toppings", maxSelectionEnabled: true, maxSelections: 3, options: [] }],
      },
    ],
  });
  const serialised = menu.toObject().items[0].modifierGroups[0];
  assert.equal(serialised.maxSelectionEnabled, true);
  assert.equal(serialised.maxSelections, 3);
});

test("BACKWARD COMPAT: an existing group with none of the new fields still reads sensibly", () => {
  const menu = new Menu({
    name: "Mains",
    createdBy: new mongoose.Types.ObjectId(),
    items: [{ name: "Burger", price: 100, category: "Mains", modifierGroups: [{ name: "Legacy", options: [] }] }],
  });
  const g = menu.toObject().items[0].modifierGroups[0];
  assert.equal(g.isActive, true, "a group that predates the flag is active");
  assert.equal(g.sortOrder, 0);
  assert.equal(g.maxSelectionEnabled, false, "and uncapped");
});
