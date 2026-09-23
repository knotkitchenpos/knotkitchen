const { test } = require("node:test");
const assert = require("node:assert/strict");
const { menuVersion } = require("../controllers/menuController");

// The POS keeps the menu on the device and asks for this fingerprint to
// decide whether to download it again.
const menu = (price, updatedAt) => [
  { _id: "m1", name: "Drinks", updatedAt, items: [{ _id: "i1", name: "Tea", price, updatedAt }] },
];

test("same menu, same version; a changed price, a new version", () => {
  assert.equal(menuVersion(menu(20, "2026-09-24T10:00:00Z")), menuVersion(menu(20, "2026-09-24T10:00:00Z")));
  assert.notEqual(menuVersion(menu(20, "2026-09-24T10:00:00Z")), menuVersion(menu(25, "2026-09-24T10:00:00Z")));
});

test("a timestamp alone does not count as a change", () => {
  assert.equal(menuVersion(menu(20, "2026-09-24T10:00:00Z")), menuVersion(menu(20, "2026-09-24T11:30:00Z")));
});
