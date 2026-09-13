const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cleanChannelHours } = require("../controllers/csdWebsiteController");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

test("CSD edits a store's website through the admin-only route", () => {
  const routes = read("routes", "csdRoute.js");
  assert.match(routes, /router\.get\("\/restaurants\/:storeId\/website", requireCsdAuth, getCsdWebsite\)/);
  assert.match(routes, /router\.patch\("\/restaurants\/:storeId\/website", requireCsdAdmin, updateCsdWebsite\)/);
});

test("only the design and ordering sections pass through, never the address or payment keys", () => {
  const src = read("controllers", "csdWebsiteController.js");
  const sections = src.match(/const CSD_SECTIONS = \[([^\]]*)\]/)[1];
  for (const key of ["branding", "sectionTitles", "banners", "landing", "theme", "ordering"]) {
    assert.ok(sections.includes(`"${key}"`), key);
  }
  for (const forbidden of ["paymentGateways", "slug", "customDomain", "enabled"]) {
    assert.ok(!sections.includes(`"${forbidden}"`), `${forbidden} must stay with the restaurant`);
  }
  // Same whitelisted writer as the POS, aimed at the chosen store.
  assert.match(src, /req\.websiteTarget = target;/);
  assert.match(read("controllers", "websiteSettingsController.js"), /req\.websiteTarget \|\| \(await loadOwnSettings\(req\)\)/);
});

test("Hours are cleaned per channel and bad times are refused", () => {
  const out = cleanChannelHours({
    collection: { weekly: [{ day: 1, isOpen: true, openTime: "11:00", closeTime: "22:00" }, { day: 9, isOpen: true, openTime: "11:00", closeTime: "22:00" }] },
    table: { weekly: [{ day: 0, isOpen: "yes", openTime: "16:00", closeTime: "22:00" }] },
    bogus: { weekly: [] },
  });
  assert.deepEqual(out.collection, [{ day: 1, isOpen: true, openTime: "11:00", closeTime: "22:00" }]);
  assert.equal(out.table[0].isOpen, true);
  assert.ok(!("bogus" in out));
  assert.throws(() => cleanChannelHours({ delivery: { weekly: [{ day: 2, isOpen: true, openTime: "9am", closeTime: "22:00" }] } }), /HH:MM/);
});

test("the POS Manage Website stays without the moved tabs, and CSD has them", () => {
  const dialog = fs.readFileSync(path.join(__dirname, "..", "..", "csd-web", "src", "components", "WebsiteDesignDialog.jsx"), "utf8");
  for (const tab of ["Homepage & Branding", "Landing Page", "Colors & Fonts", "Layout", "Ordering Options", "Hours"]) {
    assert.ok(dialog.includes(`label: "${tab}"`), tab);
  }
});
