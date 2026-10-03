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
    DEFAULT_ADDONS.map((a) => [a.code, a.name, money.toRupees(a.pricePaise), a.periodDays ?? null, a.feature]),
    [
      ["TABLE_QR", "QR Table Ordering", 200, null, "tableQr"],
      ["WEBSITE", "Website", 3600, 365, "website"],
      ["GMB", "GMB Management", 100, null, ""],
    ],
  );
  // Devices, GST included.
  assert.deepEqual(DEFAULT_PRINTERS.map((p) => [p.code, p.name, money.toRupees(p.pricePaise)]), [
    ["TABLET", "Tablet", 10000],
    ["PRINTER_2IN", "2-inch Bluetooth printer", 1700],
    ["PRINTER_3IN", "3-inch Bluetooth printer", 4300],
    ["PRINTER_3IN_LAN", "3-inch LAN printer", 3900],
    ["PRINTER_3IN_USB", "3-inch USB printer", 3500],
  ]);

  const { PlatformBillingConfig } = require("../models/platformBillingModel");
  const config = new PlatformBillingConfig({});
  assert.equal(config.basePlan.code, "POS");
  assert.equal(config.basePlan.pricePaise, money.toPaise(499));
  // Only what tablets already rented renew at; the per-tablet top-up is gone.
  assert.equal(config.tablet.firstPricePaise, money.toPaise(600));
  assert.equal(config.tablet.extraPricePaise, money.toPaise(500));
  assert.equal(PlatformBillingConfig.schema.path("tablet.rechargeRequiredPaise"), undefined);
  assert.equal(config.firstRechargeMinPaise, money.toPaise(2500));
  assert.equal(config.addons.length, 3);
  // The platform fee per source, and the e-bill: priced, all OFF.
  assert.deepEqual(
    ["websiteOrderCharge", "qrOrderCharge", "ebillCharge"].map((k) => [config[k].amountPaise, config[k].enabled]),
    [[300, false], [100, false], [25, false]],
  );
  assert.equal(PlatformBillingConfig.schema.path("websiteOrderCharge.chargeableSources"), undefined);
  assert.equal(config.catalogVersion, 2, "a new row starts on the current catalogue");
  // The old plan catalogue and its upgrade maths are gone.
  assert.equal(PlatformBillingConfig.schema.path("plans"), undefined);
  assert.equal(PlatformBillingConfig.schema.path("upgradePolicy"), undefined);
});

test("REGRESSION: a config row that predates the catalogue is backfilled, an edited one is not", () => {
  const src = SRC("services/pricing.js");
  assert.match(src, /if \(!existing\.addons \|\| existing\.addons\.length === 0\) \{/);
  assert.match(src, /if \(!existing\.printers \|\| existing\.printers\.length === 0\) \{/);
  assert.match(src, /if \(seeded\) \{\s*try \{\s*await existing\.save\(\);/);
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
  const shown = present({ addons, printers: [], gst: {}, websiteOrderCharge: {}, basePlan: { code: "POS", name: "POS", pricePaise: 49900 } });
  assert.deepEqual(shown.addons.map((a) => a.price), [200, 149.5]);
  assert.equal(shown.addons[0].priceLabel, "₹200.00");
  assert.equal(shown.basePlan.price, 499);
});

test("an add-on's own period round-trips, so a CSD save never turns the yearly Website monthly", () => {
  const errors = {};
  const addons = readCatalog(
    [
      { code: "WEBSITE", name: "Website", price: 3600, periodDays: 365, feature: "website" },
      { code: "TABLE_QR", name: "QR", price: 200, periodDays: "", feature: "tableQr" },
      { code: "BAD1", name: "x", price: 1, periodDays: 0 },
      { code: "BAD2", name: "x", price: 1, periodDays: 400 },
      { code: "BAD3", name: "x", price: 1, periodDays: 30.5 },
    ],
    "addons",
    errors,
    new Set(),
    { addons: true },
  );
  assert.deepEqual(addons.slice(0, 2).map((a) => a.periodDays), [365, null], "blank rides the POS period");
  assert.deepEqual(Object.keys(errors).sort(), ["addons.2.periodDays", "addons.3.periodDays", "addons.4.periodDays"]);
  const shown = present({ addons: addons.slice(0, 2), printers: [], gst: {} });
  assert.deepEqual(shown.addons.map((a) => [a.code, a.periodDays]), [["WEBSITE", 365], ["TABLE_QR", null]]);
  assert.deepEqual(readCatalog(shown.addons, "addons", {}, new Set(), { addons: true }).map((a) => a.periodDays), [365, null]);
  // A page loaded before periods existed sends none: the saved one stays.
  const stale = shown.addons.map(({ periodDays, ...rest }) => rest);
  assert.deepEqual(
    readCatalog(stale, "addons", {}, new Set(), { addons: true, current: addons }).map((a) => a.periodDays),
    [365, null],
  );
  // Fixed once saved: stores on it (and their negotiated prices) were agreed for that period.
  const moved = {};
  readCatalog(
    [{ ...shown.addons[0], periodDays: "" }, { ...shown.addons[1], periodDays: 365 }],
    "addons",
    moved,
    new Set(),
    { addons: true, current: addons },
  );
  assert.deepEqual(Object.keys(moved).sort(), ["addons.0.periodDays", "addons.1.periodDays"]);

  // The usage charges, one shape each; nothing about sources any more.
  const charges = present({
    websiteOrderCharge: { enabled: true, amountPaise: 300, effectiveFrom: new Date("2026-11-01") },
    qrOrderCharge: { amountPaise: 100 },
    ebillCharge: { amountPaise: 25 },
  });
  assert.deepEqual(
    ["websiteOrderCharge", "qrOrderCharge", "ebillCharge"].map((k) => [charges[k].amount, charges[k].enabled, charges[k].taxable]),
    [[3, true, true], [1, false, true], [0.25, false, true]],
  );
  assert.equal("chargeableSources" in charges.websiteOrderCharge, false);
  assert.equal("rechargeRequired" in charges.tablet, false);
});

test("a stored config row moves to the new catalogue once, keeping everything CSD changed", async () => {
  const pricing = require("../services/pricing");
  const { PlatformBillingConfig } = require("../models/platformBillingModel");
  const CsdStoreCharges = require("../models/csdStoreChargesModel");
  const realFindOne = PlatformBillingConfig.findOne;
  const realUpdateMany = CsdStoreCharges.updateMany;
  const realFind = CsdStoreCharges.find;
  const realUpdateOne = CsdStoreCharges.updateOne;
  const resets = [];
  CsdStoreCharges.updateMany = async (filter, update) => (resets.push([filter, update]), { modifiedCount: 1 });
  // A store that negotiated the Website at ₹200 per 30 days (saved lowercase, as old rows were).
  const updatedAt = new Date("2026-09-01");
  const storeRow = { _id: "s1", updatedAt, planPrices: [{ code: "POS", price: 449 }, { code: "website", price: 200 }], history: [] };
  const finds = [];
  const rowWrites = [];
  CsdStoreCharges.find = (filter) => (finds.push(filter), { lean: async () => [storeRow] });
  CsdStoreCharges.updateOne = async (filter, update) => (rowWrites.push([filter, update]), { modifiedCount: 1 });
  // A row as catalogVersion 1 stored it (no catalogVersion, no qrOrderCharge).
  const v1 = (fields = {}) =>
    PlatformBillingConfig.hydrate({
      _id: "64b0000000000000000000aa",
      __v: 4,
      singleton: "platform",
      basePlan: { code: "POS", name: "POS", pricePaise: 39900 },
      addons: [
        { code: "TABLE_QR", name: "QR Table Ordering", pricePaise: 20000, feature: "tableQr" },
        { code: "WEBSITE", name: "Website", pricePaise: 30000, feature: "website" },
      ],
      printers: [
        { code: "PRINTER_2IN", name: "2-inch receipt printer", pricePaise: 190000 },
        { code: "PRINTER_3IN", name: "3-inch receipt printer", pricePaise: 425000 },
      ],
      websiteOrderCharge: { enabled: true, amountPaise: 900, effectiveFrom: new Date("2026-10-01"), chargeableSources: ["QR"], taxable: true },
      ebillCharge: { enabled: false, amountPaise: 25, effectiveFrom: null },
      ...fields,
    });
  const load = async (rows, save = async () => {}) => {
    const queue = [...rows];
    PlatformBillingConfig.findOne = async () => {
      const doc = queue.shift();
      doc.save = save;
      return doc;
    };
    try {
      return await pricing.getPlatformConfig();
    } finally {
      PlatformBillingConfig.findOne = realFindOne;
    }
  };

  try {
    const got = await load([v1()]);
    assert.equal(got.catalogVersion, 2);
    assert.equal(got.basePlan.pricePaise, 49900);
    const site = got.addons.find((a) => a.code === "WEBSITE");
    assert.deepEqual([site.pricePaise, site.periodDays], [360000, 365]);
    assert.deepEqual(
      got.printers.map((p) => [p.code, p.name, p.pricePaise]),
      [
        ["TABLET", "Tablet", 1000000],
        ["PRINTER_2IN", "2-inch Bluetooth printer", 170000],
        ["PRINTER_3IN", "3-inch Bluetooth printer", 430000],
        ["PRINTER_3IN_LAN", "3-inch LAN printer", 390000],
        ["PRINTER_3IN_USB", "3-inch USB printer", 350000],
      ],
    );
    // QR only was charged: the website's charge is off, the table-QR one keeps the switch and date.
    assert.deepEqual([got.websiteOrderCharge.amountPaise, got.websiteOrderCharge.enabled], [300, false]);
    assert.deepEqual(
      [got.qrOrderCharge.amountPaise, got.qrOrderCharge.enabled, got.qrOrderCharge.effectiveFrom.toISOString()],
      [100, true, new Date("2026-10-01").toISOString()],
    );
    assert.equal(got.get("websiteOrderCharge.chargeableSources", null, { strict: false }), undefined, "the retired field is gone");
    assert.equal(got.$__delta()?.[1]?.$inc?.__v, 1, "saved only over the version it read");
    // Migration 011's reset: an untouched ₹9 store rate back to the platform rate.
    assert.deepEqual(resets, [[
      { onlinePaidOrderCharge: 9, history: { $not: { $elemMatch: { field: "onlinePaidOrderCharge" } } } },
      { $set: { onlinePaidOrderCharge: null } },
    ]]);

    // The store's per-30-day Website price becomes a yearly one, once, and CSD sees why.
    assert.deepEqual(finds, [{
      "planPrices.code": /^website$/i,
      history: { $not: { $elemMatch: { field: "planPrices", byName: "Website now yearly (x12)" } } },
    }]);
    assert.deepEqual(rowWrites, [[
      { _id: "s1", updatedAt },
      {
        $set: { planPrices: [{ code: "POS", price: 449 }, { code: "website", price: 2400 }] },
        $push: { history: { field: "planPrices", from: "POS:449, website:200", to: "POS:449, website:2400", byName: "Website now yearly (x12)" } },
      },
    ]]);

    // Anything CSD had changed stays exactly as it was.
    rowWrites.length = 0;
    const edited = await load([v1({
      basePlan: { code: "POS", name: "POS", pricePaise: 45000 },
      addons: [{ code: "WEBSITE", name: "Website", pricePaise: 25000, feature: "website" }],
      printers: [{ code: "PRINTER_2IN", name: "Thermal 58mm", pricePaise: 180000 }],
      websiteOrderCharge: { enabled: true, amountPaise: 500, effectiveFrom: new Date("2026-10-01"), chargeableSources: ["WEBSITE", "QR"] },
    })]);
    assert.equal(edited.basePlan.pricePaise, 45000);
    assert.deepEqual([edited.addons[0].pricePaise, edited.addons[0].periodDays], [25000, null], "a repriced Website stays monthly");
    assert.deepEqual(rowWrites, [], "and so do the store prices that go with it");
    assert.deepEqual(
      edited.printers.filter((p) => p.code === "PRINTER_2IN").map((p) => [p.name, p.pricePaise]),
      [["Thermal 58mm", 180000]],
      "a printer CSD repriced keeps its name and price",
    );
    assert.deepEqual([edited.websiteOrderCharge.amountPaise, edited.websiteOrderCharge.enabled], [500, true]);
    assert.equal(edited.qrOrderCharge.enabled, true);

    // Once: a row already on version 2 is not touched (nor saved).
    let saves = 0;
    await load([new PlatformBillingConfig({})], async () => { saves += 1; });
    assert.equal(saves, 0);

    // Two servers at once: the one that loses the save re-reads the winner's row.
    resets.length = 0;
    const winner = new PlatformBillingConfig({});
    const lost = await load([v1(), winner], async () => {
      throw Object.assign(new Error("No matching document"), { name: "VersionError" });
    });
    assert.equal(lost, winner);
  } finally {
    CsdStoreCharges.updateMany = realUpdateMany;
    CsdStoreCharges.find = realFind;
    CsdStoreCharges.updateOne = realUpdateOne;
  }
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
  assert.ok(!/rechargeRequired|chargeableSources/.test(src), "the tablet top-up and the order-charge sources are gone");
  assert.match(src, /const USAGE_CHARGES = \["websiteOrderCharge", "qrOrderCharge", "ebillCharge"\];/, "one validator for every usage charge");
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
  // (A Wallet adjustment moves money, so it may re-evaluate; the view never does.)
  const src = SRC("controllers/csdBillingConfigController.js");
  const ctrl = src.slice(src.indexOf("const accountStanding"), src.indexOf("const changeSubscription"));
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

test("a store's platform fee can be negotiated per source: website and table QR", () => {
  const CsdStoreCharges = require("../models/csdStoreChargesModel");
  const row = new CsdStoreCharges({ storeId: "123456", ...CsdStoreCharges.DEFAULTS });
  assert.deepEqual([row.onlinePaidOrderCharge, row.qrPaidOrderCharge], [null, null], "null = the platform rate");
  const ctrl = SRC("controllers/csdRestaurantController.js");
  assert.match(ctrl, /\["onlinePaidOrderCharge", "Website platform fee", 10000\],\s*\["qrPaidOrderCharge", "Table QR platform fee", 10000\],/);
  assert.equal((ctrl.match(/qrPaidOrderCharge: (charges|existing)\.qrPaidOrderCharge \?\? null,/g) || []).length, 3, "read, audited and answered");
});
