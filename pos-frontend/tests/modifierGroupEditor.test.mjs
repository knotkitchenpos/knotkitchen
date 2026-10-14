import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

import { capOf, groupEditorPayload, groupForSave, groupLibrary, selectionTypeOf } from "../src/utils/modifierGroups.js";

// "The menu editor silently changes option rules": a choose-one Bread group
// became choose-any after a product save, Add Group or a component delete.
const read = (p) => fs.readFileSync(new URL(`../src/components/${p}`, import.meta.url), "utf8");

const savedBread = { name: "Bread", required: true, maxSelectionEnabled: true, maxSelections: 1, isActive: true, sortOrder: 0, options: [{ name: "White", price: 0 }] };
const product = (id, groups) => ({ _id: id, modifierGroups: groups });
const damaged = { name: "Bread", required: true, maxSelectionEnabled: false, maxSelections: 1, sortOrder: 4, options: [{ name: "White", price: 0 }] };
const intact = { ...damaged, maxSelectionEnabled: true, sortOrder: 1 };

test("REGRESSION: the editor reads a group's rules from the saved list, whichever product is read last", () => {
  for (const items of [
    [product("a", [intact]), product("b", [damaged])],
    [product("b", [damaged]), product("a", [intact])],
  ]) {
    const entry = groupLibrary([savedBread], [{ items }]).get("Bread");
    assert.equal(entry.maxSelectionEnabled, true);
    assert.equal(selectionTypeOf(entry), "single", "the editor would show Multiple and spread choose-any on Save");
    assert.equal(entry.sortOrder, 0, "list position is the saved list's, not a product's");
    assert.deepEqual([...entry.dishIds].sort(), ["a", "b"]);
  }
});

test("a group with no saved row takes the first product's rules; off anywhere is off", () => {
  const entry = groupLibrary([], [{ items: [product("a", [intact]), product("b", [{ ...damaged, isActive: false }])] }]).get("Bread");
  assert.equal(capOf(entry), 1);
  assert.equal(entry.isActive, false);
});

test("groupForSave states every rule, so silence is never read as 'no limit'", () => {
  assert.deepEqual(groupForSave({ ...intact, dishIds: new Set(["a"]) }), {
    name: "Bread",
    required: true,
    maxSelectionEnabled: true,
    maxSelections: 1,
    isActive: true,
    options: [{ name: "White", price: 0 }],
  });
  assert.equal(groupForSave({ name: "X" }).maxSelectionEnabled, false);
});

test("the product drawer sends this product's own groups, every rule stated", () => {
  const src = read("dashboard/manageMenu/ProductDrawer.jsx");
  assert.match(src, /modifierGroups: prodAssignedGroupNames\.map\(\(name\) =>\s*groupForSave\(/);
  assert.match(src, /editingProduct\?\.modifierGroups\?\.find\(\(g\) => g\?\.name === name\)/);
});

test("bulk Add Group sends the full group; a component delete sends no rules", () => {
  const src = read("dashboard/ManageMenu.jsx");
  assert.match(src, /payload = \{ \.\.\.groupForSave\(src\), \.\.\.payload \}/);
  const del = src.slice(src.indexOf("const updatedOpts"), src.indexOf("dishIds: Array.from(activeGroup.dishIds)"));
  assert.doesNotMatch(del, /required|maxSelections/, "rules sent without the flag are what turned the group choose-any");
});

/** The group editor's form as GroupDrawer loads it from a library entry. */
const formOf = (g) => ({
  name: g.name,
  oldName: g.name,
  required: g.required,
  selectionType: selectionTypeOf(g),
  maxEnabled: g.maxSelectionEnabled === true,
  max: String(g.maxSelections || 1),
  options: g.options,
  dishIds: g.dishIds,
});

test("REGRESSION: products an old save turned choose-any are flagged, and Save puts them back", () => {
  // Production: the list row says choose-one; sandwiches a and b were damaged.
  const entry = groupLibrary([savedBread], [{ items: [product("a", [damaged]), product("b", [damaged]), product("c", [intact])] }]).get("Bread");
  assert.deepEqual([...entry.mixedIds].sort(), ["a", "b"], "Manage Menu must say the rules differ");

  // The owner opens Edit Group (it shows Single) and presses Save unchanged.
  const payload = groupEditorPayload(formOf(entry));
  assert.equal(payload.maxSelectionEnabled, true, "nothing was sent, so every product stayed choose-any");
  assert.equal(payload.maxSelections, 1);
  assert.equal(payload.required, true);
  assert.deepEqual(payload.dishIds.sort(), ["a", "b", "c"]);
});

test("the group editor states every rule, whatever the operator touched", () => {
  const multi = { name: "Extras", required: false, maxSelectionEnabled: false, maxSelections: 5, options: [{ name: " Cheese ", price: "20" }], dishIds: new Set(["a"]) };
  assert.deepEqual(groupEditorPayload(formOf(multi)), {
    groupName: "Extras",
    oldGroupName: "Extras",
    required: false,
    maxSelectionEnabled: false,
    maxSelections: 5,
    options: [{ name: "Cheese", price: 20 }],
    dishIds: ["a"],
  });
  // Multiple with Maximum Selection on, capped at 3.
  const capped = groupEditorPayload({ ...formOf(multi), maxEnabled: true, max: "3" });
  assert.deepEqual([capped.maxSelectionEnabled, capped.maxSelections], [true, 3]);
  // Single is a cap of one, whatever the hidden Maximum Selection switch says.
  const single = groupEditorPayload({ ...formOf(multi), selectionType: "single", maxEnabled: false, max: "5" });
  assert.deepEqual([single.maxSelectionEnabled, single.maxSelections], [true, 1]);
  // No products: a save to the store's list only, so no dishIds.
  assert.equal("dishIds" in groupEditorPayload({ ...formOf(multi), dishIds: new Set() }), false);
  // A product whose copy only stores a different number while uncapped sells the same.
  assert.equal(groupLibrary([multi], [{ items: [product("a", [{ ...multi, maxSelections: 1 }])] }]).get("Extras").mixedIds.size, 0);
});

test("the till does not offer a group that is switched off", () => {
  const src = read("pos/ProductPanel.jsx");
  assert.match(src, /\(item\.modifierGroups \|\| \[\]\)\.filter\(\(g\) => g\?\.isActive !== false\)/);
  assert.match(src, /openCustomization\(\{ \.\.\.item, modifierGroups \}\)/);
});

test("both group-editor saves send that payload; the open group is read fresh, not kept from the click", () => {
  const drawer = read("dashboard/manageMenu/GroupDrawer.jsx");
  assert.match(drawer, /saveGroupMut\.mutate\(payload\)/);
  assert.match(drawer, /saveStandaloneGroupMut\.mutate\(payload,/);
  // A stale copy made "change it back" send the old rules and brought deleted components back.
  const page = read("dashboard/ManageMenu.jsx");
  assert.match(page, /const activeGroup = \(activeGroupName && allGroupsMap\.get\(activeGroupName\)\) \|\| null;/);
  assert.doesNotMatch(page, /setActiveGroup\(/);
});
