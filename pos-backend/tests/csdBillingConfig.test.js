const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { readCatalog, present } = require("../controllers/csdBillingConfigController");
const { DEFAULT_ADDONS, DEFAULT_PRINTERS } = require("../models/platformBillingModel");
const money = require("../services/money");

/**
 * The admin panel's pricing API.
 *
 * "The most important requirement is that all financial settings must be
 * controlled by the KnotKitchen Admin Panel" -- so this is the only writer,
 * and the tests below are as much about what it REFUSES as what it accepts.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("the catalogue ships at the owner's prices", () => {
  assert.deepEqual(
    DEFAULT_ADDONS.map((a) => [a.code, a.name, money.toRupees(a.pricePaise), a.feature]),
    [
      ["TABLE_QR", "QR Table Ordering", 200, "tableQr"],
      ["WEBSITE", "Website", 300, "website"],
      ["GMB", "GMB Management", 100, ""],
    ],
  );
  assert.deepEqual(DEFAULT_PRINTERS.map((p) => [p.code, money.toRupees(p.pricePaise)]), [["PRINTER_2IN", 1900], ["PRINTER_3IN", 4250]]);

  const { PlatformBillingConfig } = require("../models/platformBillingModel");
  const config = new PlatformBillingConfig({});
  assert.equal(config.basePlan.code, "POS");
  assert.equal(config.basePlan.pricePaise, money.toPaise(399));
  assert.equal(config.tablet.firstPricePaise, money.toPaise(600));
  assert.equal(config.tablet.extraPricePaise, money.toPaise(500));
  assert.equal(config.tablet.rechargeRequiredPaise, money.toPaise(4000));
  assert.equal(config.firstRechargeMinPaise, money.toPaise(2500));
  assert.equal(config.addons.length, 3);
  // The old plan catalogue and its upgrade maths are gone.
  assert.equal(PlatformBillingConfig.schema.path("plans"), undefined);
  assert.equal(PlatformBillingConfig.schema.path("upgradePolicy"), undefined);
});

test("REGRESSION: a config row that predates the catalogue is backfilled, an edited one is not", () => {
  const src = SRC("services/pricing.js");
  assert.match(src, /if \(!existing\.addons \|\| existing\.addons\.length === 0\) \{/);
  assert.match(src, /if \(!existing\.printers \|\| existing\.printers\.length === 0\) \{/);
  assert.match(src, /if \(seeded\) await existing\.save\(\);/);
});

test("add-ons go in as rupees and are stored as paise, never the other way round", () => {
  const errors = {};
  const addons = readCatalog(
    [
      { code: "table_qr", name: "QR Table Ordering", price: 200, feature: "tableQr" },
      { code: "KITCHEN_DISPLAY", name: "Kitchen display", description: "A screen for the kitchen", price: 149.5, feature: "" },
    ],
    "addons",
    errors,
    new Set(),
    { addons: true },
  );
  assert.deepEqual(errors, {});
  assert.deepEqual(addons.map((a) => [a.code, a.pricePaise, a.feature]), [["TABLE_QR", 20000, "tableQr"], ["KITCHEN_DISPLAY", 14950, ""]]);
  assert.equal(addons[1].description, "A screen for the kitchen");

  // And back out as rupees, because that is what the admin typed.
  const shown = present({ addons, printers: [], gst: {}, websiteOrderCharge: {}, basePlan: { code: "POS", name: "POS", pricePaise: 39900 } });
  assert.deepEqual(shown.addons.map((a) => a.price), [200, 149.5]);
  assert.equal(shown.addons[0].priceLabel, "₹200.00");
  assert.equal(shown.basePlan.price, 399);
});

test("a bad catalogue is refused whole, not part-applied", () => {
  const errors = {};
  readCatalog(
    [
      { code: "A1", name: "A", price: -5 },
      { code: "A1", name: "duplicate", price: 1 },
      { code: "", name: "nameless", price: 1 },
      { code: "bad code!", name: "x", price: 1 },
      { code: "POS", name: "clash", price: 1 },
      { code: "SITE", name: "x", price: 1, feature: "payroll" },
    ],
    "addons",
    errors,
    new Set(),
    { addons: true },
  );
  assert.match(errors["addons.0.price"], /zero or more/);
  assert.match(errors["addons.1.code"], /already used/);
  assert.match(errors["addons.2.code"], /capital letters/);
  assert.match(errors["addons.3.code"], /capital letters/);
  assert.match(errors["addons.4.code"], /already used/, "POS, TABLET_FIRST and TABLET_EXTRA name prices too");
  assert.match(errors["addons.5.feature"], /none, website or tableQr/);

  const src = SRC("controllers/csdBillingConfigController.js");
  assert.match(src, /if \(Object\.keys\(fieldErrors\)\.length\)/);
  const rejectAt = src.indexOf("Please correct the highlighted fields");
  const saveAt = src.indexOf("await config.save()");
  assert.ok(rejectAt !== -1 && saveAt > rejectAt, "nothing is saved before validation passes");
});

test("an add-on and a printer cannot share a code: an override names one without saying which", () => {
  const errors = {};
  const seen = new Set();
  readCatalog([{ code: "PRINTER_2IN", name: "x", price: 1 }], "addons", errors, seen, { addons: true });
  readCatalog([{ code: "PRINTER_2IN", name: "2-inch", price: 1900 }], "printers", errors, seen);
  assert.match(errors["printers.0.code"], /already used/);
});

test("SOURCE: every catalogue setting is editable, validated and audited", () => {
  const src = SRC("controllers/csdBillingConfigController.js");
  for (const key of ["basePlan", "addons", "printers", "tablet", "firstRechargeMin"]) {
    assert.match(src, new RegExp(`body\\.${key} !== undefined`), key);
  }
  assert.match(src, /readPrice\(t\.rechargeRequired, "tablet\.rechargeRequired", fieldErrors\)/);
  assert.ok(!/upgradePolicy|readPlans/.test(src), "the plan editor is gone");
});

test("SOURCE: GST cannot be switched on without a start date", () => {
  // Registered with no date taxes nothing, which looks broken rather than
  // deliberate.
  const src = SRC("controllers/csdBillingConfigController.js");
  assert.match(src, /if \(g\.registered && !asDate\(g\.effectiveFrom\)\)/);
  assert.match(src, /if \(c\.enabled && !asDate\(c\.effectiveFrom\)\)/, "same for the order charge");
});

test("SOURCE: changing a price is admin-only and audited", () => {
  const route = SRC("routes/csdRoute.js");
  assert.match(route, /router\.patch\("\/billing\/config", requireCsdAdmin/);
  // Reading is not restricted -- support staff need to see what a store pays.
  assert.match(route, /router\.get\("\/billing\/config", getBillingConfig\)/);

  const ctrl = SRC("controllers/csdBillingConfigController.js");
  assert.match(ctrl, /action: "BILLING\.CONFIG\.UPDATE"/);
  assert.match(ctrl, /previousValue: before/, "a price change must be accountable afterwards");
});

test("SOURCE: ending a tablet rental is admin-only and audited", () => {
  const route = SRC("routes/csdRoute.js");
  assert.match(route, /router\.post\("\/billing\/accounts\/:restaurantId\/tablets\/:serial\/end", requireCsdAdmin, endTabletRental\)/);
  const ctrl = SRC("controllers/csdBillingConfigController.js");
  assert.match(ctrl, /action: "BILLING\.TABLET\.END"/);
});

test("SOURCE: viewing an account does not lock it", () => {
  // An admin opening a restaurant's page should not be the thing that locks
  // it out of its POS.
  const ctrl = SRC("controllers/csdBillingConfigController.js");
  assert.match(ctrl, /assessAccount/);
  assert.ok(!/evaluateLock/.test(ctrl), "assess reads; evaluate writes");
  // The plan it shows is read without creating (and so assessing) a balance.
  const sub = SRC("services/subscription.js");
  const status = sub.slice(sub.indexOf("const statusFor"));
  assert.match(status, /BusinessBalance\.findOne\(\{ restaurantId \}\)\.select\("balancePaise"\)\.lean\(\)/);
  assert.ok(!/getBalance\(/.test(status));
});

test("negotiated prices go through the existing charges endpoint, with the new codes", () => {
  // Not a second override collection -- CsdStoreCharges already had the audit
  // trail and the dialog.
  const ctrl = SRC("controllers/csdRestaurantController.js");
  assert.match(ctrl, /if \(b\.planPrices !== undefined\)/);
  assert.match(ctrl, /That item is listed twice/);
  assert.match(ctrl, /const code = str\(row\?\.code\)\.trim\(\)\.toUpperCase\(\);/);
  // Sent whole so an entry can be REMOVED; a merge would make a special price
  // permanent.
  assert.match(ctrl, /patch\.planPrices = b\.planPrices\.map/);

  const CsdStoreCharges = require("../models/csdStoreChargesModel");
  assert.ok(CsdStoreCharges.schema.path("planPrices"));
});
