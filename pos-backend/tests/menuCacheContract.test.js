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

test("a price edit is NOT served to the website until the website cache is published", () => {
  const view = menuViewFor(menuWithPendingEdits(), AUDIENCES.WEBSITE);
  assert.equal(view.items.find((i) => i._id === "i1").price, 100);
});

test("a new product is invisible to POS and website until published", () => {
  const menu = menuWithPendingEdits();
  for (const audience of [AUDIENCES.SYSTEM, AUDIENCES.WEBSITE]) {
    const view = menuViewFor(menu, audience);
    assert.equal(
      view.items.some((i) => i._id === "i2"),
      false,
      `unpublished item leaked to ${audience}`
    );
  }
});

test("REGRESSION: a never-published category does not leak to POS or website", () => {
  // This is the case the old fallback got wrong: no snapshot meant "show the
  // draft" rather than "show nothing".
  const menu = brandNewMenu();
  assert.equal(menuViewFor(menu, AUDIENCES.SYSTEM).items.length, 0);
  assert.equal(menuViewFor(menu, AUDIENCES.WEBSITE).items.length, 0);
  // …while Manage Menu still shows it, so it can be edited and published.
  assert.equal(menuViewFor(menu, AUDIENCES.DRAFT).items.length, 1);
});

test("projectMenus drops categories with nothing published for that audience", () => {
  const menus = [menuWithPendingEdits(), brandNewMenu()];
  assert.equal(projectMenus(menus, AUDIENCES.SYSTEM).length, 1);
  assert.equal(projectMenus(menus, AUDIENCES.WEBSITE).length, 1);
  assert.equal(projectMenus(menus, AUDIENCES.DRAFT).length, 2, "the editor sees everything");
});

test("the two caches are independent — publishing one does not move the other", () => {
  // System republished with the new price; website deliberately left behind.
  const menu = menuWithPendingEdits();
  menu.systemSnapshot = { name: "Drinks", items: [{ _id: "i1", name: "Cola", price: 120 }] };

  assert.equal(menuViewFor(menu, AUDIENCES.SYSTEM).items[0].price, 120);
  assert.equal(menuViewFor(menu, AUDIENCES.WEBSITE).items[0].price, 100);
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

test("a menu missing snapshot fields entirely is treated as unpublished, not as a draft", () => {
  const legacy = { _id: "m3", name: "Legacy", items: [{ _id: "x", name: "Old", price: 10 }] };
  assert.equal(menuViewFor(legacy, AUDIENCES.SYSTEM).items.length, 0);
  assert.equal(menuViewFor(legacy, AUDIENCES.WEBSITE).items.length, 0);
});
