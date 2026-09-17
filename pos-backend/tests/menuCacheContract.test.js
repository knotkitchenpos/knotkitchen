/**
 * The Manage Cache contract.
 *
 * Settings → Manage Cache promises the operator that "menu changes do NOT
 * automatically appear in either published environment". Every read path used
 * to fall back to the live draft whenever a menu had not been published to
 * that target, so the promise held only for menus that happened to have been
 * published before — a brand-new category, or any menu on a store that had
 * never pressed Publish, went straight to the tills and the public site.
 *
 * These tests pin the promise down. They are deliberately about BEHAVIOUR at
 * the boundary — what each audience is served — not about implementation.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  AUDIENCES,
  menuViewFor,
  projectMenus,
  hasUnpublishedChanges,
} = require("../services/menuCache");

/** A category whose draft has moved on from both published snapshots. */
const menuWithPendingEdits = () => ({
  _id: "m1",
  name: "Drinks",
  // What Manage Menu currently shows: a new item, and a price rise.
  items: [
    { _id: "i1", name: "Cola", price: 120 },
    { _id: "i2", name: "New Iced Tea", price: 90 },
  ],
  hasPublishedToSystem: true,
  systemSnapshot: { name: "Drinks", items: [{ _id: "i1", name: "Cola", price: 100 }] },
  hasPublishedToWebsite: true,
  websiteSnapshot: { name: "Drinks", items: [{ _id: "i1", name: "Cola", price: 100 }] },
});

/** A category created in Manage Menu and never published anywhere. */
const brandNewMenu = () => ({
  _id: "m2",
  name: "Desserts",
  items: [{ _id: "i9", name: "Gulab Jamun", price: 60 }],
  hasPublishedToSystem: false,
  systemSnapshot: undefined,
  hasPublishedToWebsite: false,
  websiteSnapshot: undefined,
});

// ---------------------------------------------------------------------------

test("Manage Menu (draft) shows the operator their unpublished edits", () => {
  const view = menuViewFor(menuWithPendingEdits(), AUDIENCES.DRAFT);
  assert.equal(view.items.length, 2);
  assert.equal(view.items.find((i) => i._id === "i1").price, 120);
});

test("a price edit is NOT served to the POS until the system cache is published", () => {
  const view = menuViewFor(menuWithPendingEdits(), AUDIENCES.SYSTEM);
  assert.equal(view.items.find((i) => i._id === "i1").price, 100, "till must still bill the published price");
});

test("a price edit is NOT served to the website until Publish System is pressed", () => {
  const view = menuViewFor(menuWithPendingEdits(), AUDIENCES.WEBSITE);
  assert.equal(view.items.find((i) => i._id === "i1").price, 100, "website must show the published price");
});

test("a new product is invisible to the POS and the website until published", () => {
  const menu = menuWithPendingEdits();

  assert.equal(
    menuViewFor(menu, AUDIENCES.SYSTEM).items.some((i) => i._id === "i2"),
    false,
    "unpublished item leaked to the tills"
  );
  assert.equal(
    menuViewFor(menu, AUDIENCES.WEBSITE).items.some((i) => i._id === "i2"),
    false,
    "unpublished item leaked to the website"
  );
});

test("REGRESSION: a never-published category does not leak to the POS", () => {
  // This is the case the old fallback got wrong for the tills: no snapshot
  // meant "show the draft" rather than "show nothing".
  const menu = brandNewMenu();
  assert.equal(menuViewFor(menu, AUDIENCES.SYSTEM).items.length, 0);
  // Manage Menu still shows it, so it can be edited and published…
  assert.equal(menuViewFor(menu, AUDIENCES.DRAFT).items.length, 1);
  // …and a website that has never been published serves the draft, so a store
  // that predates the gate does not go blank.
  assert.equal(menuViewFor(menu, AUDIENCES.WEBSITE).items.length, 1);
});

test("projectMenus drops categories with nothing published for the tills", () => {
  const menus = [menuWithPendingEdits(), brandNewMenu()];
  assert.equal(projectMenus(menus, AUDIENCES.SYSTEM).length, 1);
  assert.equal(projectMenus(menus, AUDIENCES.WEBSITE).length, 2, "never-published category falls back to draft");
  assert.equal(projectMenus(menus, AUDIENCES.DRAFT).length, 2, "the editor sees everything");
});

test("the website serves its own snapshot, so both surfaces move together on publish", () => {
  const menu = menuWithPendingEdits();
  menu.systemSnapshot = { name: "Drinks", items: [{ _id: "i1", name: "Cola", price: 120 }] };
  menu.websiteSnapshot = { name: "Drinks", items: [{ _id: "i1", name: "Cola", price: 120 }] };

  assert.equal(menuViewFor(menu, AUDIENCES.SYSTEM).items[0].price, 120);
  assert.equal(menuViewFor(menu, AUDIENCES.WEBSITE).items[0].price, 120);
});

test("Publish System writes the website snapshot and the Manage Website draft too", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "controllers", "menuController.js"), "utf8");
  const block = src.slice(src.indexOf("const publishAllMenusForUser"), src.indexOf("const publishToTarget"));
  assert.match(block, /menu\.websiteSnapshot = \{ name: menu\.name, items: snapshotItems \}/);
  assert.match(block, /menu\.hasPublishedToWebsite = true/);
  assert.match(block, /snapshotForPublish\(settings\)/, "Manage Website draft is published by the same button");
});

test("projected items are plain objects whichever audience asked", () => {
  // Snapshot arrays are Mongoose subdocuments in production while a draft that
  // has been through toObject() is not. Callers spread items; one shape keeps
  // them honest.
  const menus = projectMenus([menuWithPendingEdits()], AUDIENCES.SYSTEM);
  for (const item of menus[0].items) {
    assert.equal(typeof item.toObject, "undefined");
    assert.equal(Object.getPrototypeOf(item), Object.prototype);
  }
});

test("hasUnpublishedChanges reports work waiting to be published", () => {
  const published = new Date("2026-01-01T10:00:00Z");

  const pending = {
    hasPublishedToSystem: true,
    lastPublishedToSystemAt: published,
    updatedAt: new Date("2026-01-01T11:00:00Z"),
  };
  assert.equal(hasUnpublishedChanges(pending, AUDIENCES.SYSTEM), true);

  const settled = {
    hasPublishedToSystem: true,
    lastPublishedToSystemAt: published,
    updatedAt: new Date("2026-01-01T09:00:00Z"),
  };
  assert.equal(hasUnpublishedChanges(settled, AUDIENCES.SYSTEM), false);

  assert.equal(hasUnpublishedChanges(brandNewMenu(), AUDIENCES.SYSTEM), true);
});

test("a menu missing snapshot fields entirely is unpublished to the tills, draft on the website", () => {
  const legacy = { _id: "m3", name: "Legacy", items: [{ _id: "x", name: "Old", price: 10 }] };
  assert.equal(menuViewFor(legacy, AUDIENCES.SYSTEM).items.length, 0);
  assert.equal(menuViewFor(legacy, AUDIENCES.WEBSITE).items.length, 1);
});

test("the website reports changes waiting to be published, like the tills", () => {
  const pending = {
    hasPublishedToWebsite: true,
    lastPublishedToWebsiteAt: new Date("2026-01-01T10:00:00Z"),
    updatedAt: new Date("2026-01-01T11:00:00Z"),
  };
  assert.equal(hasUnpublishedChanges(pending, AUDIENCES.WEBSITE), true);
  assert.equal(hasUnpublishedChanges(brandNewMenu(), AUDIENCES.WEBSITE), true);
});

// ---------------------------------------------------------------------------
// Category visibility and Dispatch Type.
//
// `published` (Display Status) is the master switch. When it is OFF the two
// per-surface flags decide where the category still shows. Dispatch Type
// restricts which order types it may be sold through — it had been stored on
// the model since the beginning and read by nothing.
// ---------------------------------------------------------------------------

const {
  isVisibleOnPos,
  isVisibleOnWebsite,
  allowsOrderType,
  ORDER_TYPES,
} = require("../services/menuCache");

test("Display Status ON shows the category on both surfaces", () => {
  const menu = { published: true };
  assert.equal(isVisibleOnPos(menu), true);
  assert.equal(isVisibleOnWebsite(menu), true);
});

test("Display Status OFF hides it from both, as it always did", () => {
  const menu = { published: false };
  assert.equal(isVisibleOnPos(menu), false);
  assert.equal(isVisibleOnWebsite(menu), false);
});

test("Display Status OFF + Website Visibility shows it on the website ONLY", () => {
  const menu = { published: false, showOnWebsite: true };
  assert.equal(isVisibleOnWebsite(menu), true);
  assert.equal(isVisibleOnPos(menu), false);
});

test("Display Status OFF + POS Visibility shows it on the POS ONLY", () => {
  const menu = { published: false, showOnPos: true };
  assert.equal(isVisibleOnPos(menu), true);
  assert.equal(isVisibleOnWebsite(menu), false);
});

test("BACKWARD COMPAT: a category predating the flags is unaffected", () => {
  // No showOnPos/showOnWebsite keys at all — Display Status alone decides.
  assert.equal(isVisibleOnPos({ published: true }), true);
  assert.equal(isVisibleOnWebsite({ published: false }), false);
  // `published` absent entirely (very old rows) counts as visible.
  assert.equal(isVisibleOnPos({}), true);
});

test("a collection-only category is sold through collection and nothing else", () => {
  const menu = { dispatchType: { collection: true, delivery: false, table: false } };
  assert.equal(allowsOrderType(menu, ORDER_TYPES.COLLECTION), true);
  assert.equal(allowsOrderType(menu, ORDER_TYPES.DELIVERY), false);
  assert.equal(allowsOrderType(menu, ORDER_TYPES.TABLE), false);
});

test("delivery-only and table-only follow the same rule", () => {
  const delivery = { dispatchType: { collection: false, delivery: true, table: false } };
  assert.equal(allowsOrderType(delivery, ORDER_TYPES.DELIVERY), true);
  assert.equal(allowsOrderType(delivery, ORDER_TYPES.COLLECTION), false);

  const table = { dispatchType: { collection: false, delivery: false, table: true } };
  assert.equal(allowsOrderType(table, ORDER_TYPES.TABLE), true);
  assert.equal(allowsOrderType(table, ORDER_TYPES.DELIVERY), false);
});

test("BACKWARD COMPAT: no dispatchType means no restriction", () => {
  for (const t of Object.values(ORDER_TYPES)) {
    assert.equal(allowsOrderType({}, t), true);
    assert.equal(allowsOrderType({ dispatchType: null }, t), true);
  }
});

test("all three dispatch flags off is treated as unrestricted, not as hidden", () => {
  // Otherwise an operator who unticked everything would silently lose the
  // category from every surface with no way to see why.
  const menu = { dispatchType: { collection: false, delivery: false, table: false } };
  for (const t of Object.values(ORDER_TYPES)) {
    assert.equal(allowsOrderType(menu, t), true);
  }
});
