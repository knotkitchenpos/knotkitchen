// PF1: a projected menu (tills, table QR, storefront, public menu) never carries versionHistory.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Menu = require("../models/menuModel");
const { AUDIENCES, projectMenus } = require("../services/menuCache");

test("published menus never carry versionHistory (QR, POS, storefront, public menu)", () => {
  const rid = new mongoose.Types.ObjectId();
  const items = [{ name: "Dal", price: 100, category: "Mains" }];
  const m = new Menu({ name: "Mains", items, createdBy: rid, restaurantId: rid,
    hasPublishedToSystem: true, systemSnapshot: { name: "Mains", items },
    hasPublishedToWebsite: true, websiteSnapshot: { name: "Mains", items } });
  m.versionHistory.push({ version: 2, snapshot: { name: "Mains", items } });
  for (const a of [AUDIENCES.SYSTEM, AUDIENCES.WEBSITE]) {
    const [p] = projectMenus([m], a);
    assert.ok(p && p.items.length === 1, `${a}: still serves the item`);
    assert.equal(p.versionHistory, undefined, `${a}: versionHistory leaked`);
  }
});
