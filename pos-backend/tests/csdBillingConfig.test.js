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
      ["WEBSITE", "Website", 3600, 365, "website"],
      ["GMB", "GMB Management", 100, null, ""],
    ],
  );
  // Changed 2026-10-16 (catalogue v6, was: TABLE_QR shipped off sale): table ordering is in the POS plan, so no QR add-on ships.
  assert.deepEqual(DEFAULT_ADDONS.map((a) => [a.code, a.isActive !== false]), [["WEBSITE", true], ["GMB", true]]);
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
  // Changed 2026-10-16 (was: ₹600 / ₹500 rental prices): tablet rent ended, so the catalogue has none.
  assert.equal(PlatformBillingConfig.schema.path("tablet.firstPricePaise"), undefined);
  assert.equal(PlatformBillingConfig.schema.path("tablet.extraPricePaise"), undefined);
  assert.equal(config.firstRechargeMinPaise, money.toPaise(3000));
  assert.equal(config.topUpMinPaise, money.toPaise(1000), "every top-up after the plan starts");
  assert.equal(config.addons.length, 2);
  // The platform fee per source, and the e-bill: priced, all OFF.
  assert.deepEqual(
    ["websiteOrderCharge", "qrOrderCharge", "ebillCharge"].map((k) => [config[k].amountPaise, config[k].enabled]),
    [[300, false], [100, false], [25, false]],
  );
  assert.equal(PlatformBillingConfig.schema.path("websiteOrderCharge.chargeableSources"), undefined);
  assert.equal(config.catalogVersion, 6, "a new row starts on the current catalogue");
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
      // Changed 2026-10-16: was table_qr / tableQr, which CSD can no longer create.
      { code: "gmb", name: "GMB Management", price: 200, feature: "" },
      { code: "KITCHEN_DISPLAY", name: "Kitchen display", description: "A screen for the kitchen", price: 149.5, feature: "" },
    ],
    "addons",
    errors,
    new Set(),
    { addons: true },
  );
  assert.deepEqual(errors, {});
  assert.deepEqual(addons.map((a) => [a.code, a.pricePaise, a.feature]), [["GMB", 20000, ""], ["KITCHEN_DISPLAY", 14950, ""]]);
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
      // Changed 2026-10-16: was TABLE_QR / tableQr, which CSD can no longer create.
      { code: "GMB", name: "GMB", price: 200, periodDays: "", feature: "" },
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
  assert.deepEqual(shown.addons.map((a) => [a.code, a.periodDays]), [["WEBSITE", 365], ["GMB", null]]);
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
    { addons: true, current: addons.slice(0, 2) },
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
  // Changed 2026-10-16 (was: no rechargeRequired under tablet): tablet rent ended, so CSD has no rental prices at all.
  assert.equal("tablet" in charges, false);
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
    assert.equal(got.catalogVersion, 6, "a v1 row runs every step");
    // Changed 2026-10-16 (was: v5 kept it off sale): v6 takes QR Table Ordering out of the catalogue.
    assert.deepEqual(got.addons.map((a) => a.code), ["WEBSITE"], "v6: QR Table Ordering is gone");
    assert.deepEqual([got.firstRechargeMinPaise, got.topUpMinPaise], [300000, 100000]);
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

    // Once: a row already on the current version is not touched (nor saved).
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

    // A v2 row takes only the v3 to v6 steps: re-running v1→v2 would reset CSD's platform fees.
    resets.length = 0;
    finds.length = 0;
    const v2 = (firstRechargeMinPaise) =>
      PlatformBillingConfig.hydrate({
        _id: "64b0000000000000000000ab",
        __v: 7,
        singleton: "platform",
        catalogVersion: 2,
        firstRechargeMinPaise,
        basePlan: { code: "POS", name: "POS", pricePaise: 39900 },
        addons: [{ code: "WEBSITE", name: "Website", pricePaise: 30000, feature: "website" }],
        printers: [{ code: "PRINTER_2IN", name: "2-inch receipt printer", pricePaise: 190000 }],
        websiteOrderCharge: { enabled: true, amountPaise: 900, effectiveFrom: new Date("2026-10-01"), taxable: true },
        qrOrderCharge: { enabled: true, amountPaise: 200, effectiveFrom: new Date("2026-10-02"), taxable: true },
      });
    const upgraded = await load([v2(250000)]);
    assert.deepEqual(
      [upgraded.firstRechargeMinPaise, upgraded.topUpMinPaise, upgraded.catalogVersion],
      [300000, 100000, 6],
    );
    assert.deepEqual(
      ["websiteOrderCharge", "qrOrderCharge"].map((k) => [upgraded[k].enabled, upgraded[k].effectiveFrom.toISOString(), upgraded[k].amountPaise]),
      [[true, new Date("2026-10-01").toISOString(), 900], [true, new Date("2026-10-02").toISOString(), 200]],
      "the platform fees CSD set are kept",
    );
    assert.deepEqual([upgraded.basePlan.pricePaise, upgraded.addons[0].pricePaise], [39900, 30000], "no v1 price is moved");
    assert.deepEqual(upgraded.printers.map((p) => p.code), ["PRINTER_2IN"], "no device is re-added");
    assert.deepEqual([resets, finds], [[], []], "store rows are not touched again");
    assert.equal(upgraded.$__delta()?.[1]?.$inc?.__v, 1, "saved only over the version it read");
    // A first minimum CSD edited is kept.
    assert.equal((await load([v2(200000)])).firstRechargeMinPaise, 200000);
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
  // Changed 2026-10-16 (was: none, website or tableQr): no add-on unlocks table ordering any more.
  assert.match(errors["addons.5.feature"], /none or website/);

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
  for (const key of ["basePlan", "billingPlan", "addons", "printers", "firstRechargeMin", "topUpMin"]) {
    assert.match(src, new RegExp(`body\\.${key} !== undefined`), key);
  }
  // Changed 2026-10-16 (was: tablet editable too): tablet rent ended, so its prices are not settable.
  assert.ok(!/body\.tablet\b|config\.tablet\b/.test(src), "no tablet rental prices");
  assert.ok(!/rechargeRequired|chargeableSources/.test(src), "the tablet top-up and the order-charge sources are gone");
  assert.match(src, /const USAGE_CHARGES = \["websiteOrderCharge", "qrOrderCharge", "knotEatsOrderCharge", "ebillCharge"\];/, "one validator for every usage charge");
  assert.ok(!/upgradePolicy|readPlans/.test(src), "the plan editor is gone");
});

test("SOURCE: GST cannot be switched on without a start date", () => {
  // Registered with no date taxes nothing, which looks broken rather than
  // deliberate.
  const src = SRC("controllers/csdBillingConfigController.js");
  assert.match(src, /if \(g\.registered && !asDate\(g\.effectiveFrom\)\)/);
  assert.match(src, /if \(c\.enabled && !asDate\(c\.effectiveFrom\)\)/, "same for the order charge");
});

test("SOURCE: CSD edits both top-up minimums, and its copy says ₹3,000 first", () => {
  const web = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", "csd-web", "src", rel), "utf8");
  const billing = web("pages/Billing.jsx");
  assert.match(billing, /label="Later top-up minimum \(₹\)"/);
  assert.match(billing, /value=\{config\.topUpMin\} onChange=\{\(v\) => set\(\{ topUpMin: v \}\)\}/);
  assert.match(billing, /const gstLive = config\.gst\.registered && config\.gst\.effectiveFrom && config\.gst\.gstin && Number\(config\.gst\.percent\) > 0;/);
  const steps = web("components/NextSteps.jsx");
  assert.match(steps, /Recharges at least ₹3,000 in one payment/);
  assert.ok(!steps.includes("₹2,500"));
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

// Changed 2026-10-16 (was: ending a tablet rental is admin-only and audited): rent ended for every store, so there is nothing to end.
test("SOURCE: there is no tablet rental to end any more", () => {
  const route = SRC("routes/csdRoute.js");
  assert.ok(!/tablets\/:serial\/end|endTabletRental/.test(route), "the route is gone");
  const ctrl = SRC("controllers/csdBillingConfigController.js");
  assert.ok(!/endTablet|BILLING\.TABLET\.END/.test(ctrl));
  assert.equal("endTablet" in require("../services/subscription"), false);
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

// ---------------------------------------------------------------------------
// The Billing plan (₹199): a second fixed plan next to the POS plan
// ---------------------------------------------------------------------------

/** Load a module with some of its requires replaced; the fakes stay on while `run` runs. */
const withFakes = async (fakes, modulePath, run) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function load(r) {
    if (Object.prototype.hasOwnProperty.call(fakes, r)) return fakes[r];
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve(modulePath)];
  try {
    return await run(require(modulePath));
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve(modulePath)];
  }
};

/** Call an Express handler; `out` has the status and body, or the error passed to next. */
const call = async (handler, req) => {
  const out = {};
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  await handler(req, res, (err) => { out.error = err; });
  return out;
};

test("the Billing plan ships at ₹199, first top-up ₹3,000, later ₹1,500, and BILLING is a reserved code", () => {
  const { PlatformBillingConfig } = require("../models/platformBillingModel");
  const { billingPlan } = new PlatformBillingConfig({});
  assert.deepEqual(
    [billingPlan.code, billingPlan.name, billingPlan.pricePaise, billingPlan.firstRechargeMinPaise, billingPlan.topUpMinPaise],
    ["BILLING", "Billing", money.toPaise(199), money.toPaise(3000), money.toPaise(1500)],
  );
  const { catalogPricePaise } = require("../services/pricing");
  assert.equal(catalogPricePaise({ billingPlan }, "BILLING"), 19900, "priced like the POS plan, so per-store planPrices work");

  const errors = {};
  readCatalog([{ code: "billing", name: "clash", price: 1 }], "addons", errors, new Set(), { addons: true });
  assert.match(errors["addons.0.code"], /already used/);
});

test("CSD edits the Billing plan's name, price and both minimums; a bad price is refused by field", async () => {
  const { PlatformBillingConfig } = require("../models/platformBillingModel");
  const config = new PlatformBillingConfig({});
  let saves = 0;
  config.save = async () => { saves += 1; return config; };
  const audits = [];
  const fakes = {
    "../services/pricing": { getPlatformConfig: async () => config },
    "../services/csdAuditService": { csdAudit: async (a) => { audits.push(a); } },
  };
  await withFakes(fakes, "../controllers/csdBillingConfigController", async (ctrl) => {
    assert.deepEqual(ctrl.present(config).billingPlan, {
      code: "BILLING", name: "Billing", price: 199, priceLabel: "₹199.00", firstRechargeMin: 3000, topUpMin: 1500,
    });

    const bad = await call(ctrl.updateBillingConfig, { body: { billingPlan: { name: "Billing", price: -1, topUpMin: "x" } }, csdStaff: {} });
    assert.equal(bad.error.status, 400);
    assert.deepEqual(Object.keys(bad.error.fieldErrors).sort(), ["billingPlan.price", "billingPlan.topUpMin"]);
    assert.equal(saves, 0, "nothing saved");

    const ok = await call(ctrl.updateBillingConfig, {
      body: { billingPlan: { code: "HACK", name: " Billing Lite ", price: 249, firstRechargeMin: 2500, topUpMin: 1200 } },
      csdStaff: {},
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.data.billingPlan, {
      code: "BILLING", name: "Billing Lite", price: 249, priceLabel: "₹249.00", firstRechargeMin: 2500, topUpMin: 1200,
    });
    assert.deepEqual(
      [config.billingPlan.code, config.billingPlan.pricePaise, config.billingPlan.firstRechargeMinPaise, config.billingPlan.topUpMinPaise],
      ["BILLING", 24900, 250000, 120000],
      "the code is fixed; rupees in, paise stored",
    );
    // A page from before the minimums existed keeps them.
    await call(ctrl.updateBillingConfig, { body: { billingPlan: { name: "Billing", price: 199 } }, csdStaff: {} });
    assert.deepEqual([config.billingPlan.pricePaise, config.billingPlan.firstRechargeMinPaise, config.billingPlan.topUpMinPaise], [19900, 250000, 120000]);
    // The POS plan's own minimums are untouched.
    assert.deepEqual([config.firstRechargeMinPaise, config.topUpMinPaise], [300000, 100000]);
    assert.equal(audits.at(-1).action, "BILLING.CONFIG.UPDATE");
  });
});

test("a v3 config row gains the Billing plan and is saved once at the current version, keeping its POS minimums", async () => {
  const pricing = require("../services/pricing");
  const { PlatformBillingConfig } = require("../models/platformBillingModel");
  const realFindOne = PlatformBillingConfig.findOne;
  const v3 = PlatformBillingConfig.hydrate({
    _id: "64b0000000000000000000ac",
    __v: 9,
    singleton: "platform",
    catalogVersion: 3,
    firstRechargeMinPaise: 200000,
    topUpMinPaise: 80000,
    basePlan: { code: "POS", name: "POS", pricePaise: 49900 },
    addons: [{ code: "WEBSITE", name: "Website", pricePaise: 360000, periodDays: 365, feature: "website" }],
    printers: [{ code: "TABLET", name: "Tablet", pricePaise: 1000000 }],
    websiteOrderCharge: { enabled: false, amountPaise: 300 },
    qrOrderCharge: { enabled: false, amountPaise: 100 },
    knotEatsOrderCharge: { enabled: false, amountPaise: 900 },
    ebillCharge: { enabled: false, amountPaise: 25 },
  });
  let saves = 0;
  v3.save = async () => { saves += 1; };
  PlatformBillingConfig.findOne = async () => v3;
  try {
    const got = await pricing.getPlatformConfig();
    assert.equal(saves, 1);
    assert.equal(got.catalogVersion, 6);
    assert.ok(got.isModified("billingPlan"), "the defaults are written to the row");
    assert.deepEqual([got.billingPlan.code, got.billingPlan.pricePaise, got.billingPlan.topUpMinPaise], ["BILLING", 19900, 150000]);
    assert.deepEqual([got.firstRechargeMinPaise, got.topUpMinPaise], [200000, 80000], "what CSD set for the POS plan stays");
    assert.equal(got.$__delta()?.[1]?.$inc?.__v, 1, "saved only over the version it read");
  } finally {
    PlatformBillingConfig.findOne = realFindOne;
  }
});

test("CSD plan change: admin-only, needs a reason, audited, answers with the standing", async () => {
  const route = SRC("routes/csdRoute.js");
  assert.match(route, /router\.post\("\/billing\/accounts\/:restaurantId\/subscription\/plan", requireCsdAdmin, changeAccountPlan\);/);
  const src = SRC("controllers/csdBillingConfigController.js");
  assert.match(src, /action: "BILLING\.SUBSCRIPTION\.PLAN"/);

  class SubscriptionError extends Error {
    constructor(message, status, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
  }
  const RID = "64b000000000000000000001";
  const end = new Date("2026-11-01T00:00:00Z");
  const calls = [];
  const audits = [];
  let next = { subscription: { _id: "sub1", storeId: "148379", planCode: "POS", pendingPlanCode: "BILLING" }, already: false, before: { planCode: "POS", pendingPlanCode: "" }, effectiveAt: end };
  const fakes = {
    "../models/restaurantModel": { exists: async () => ({ _id: RID }) },
    "../services/csdAuditService": { csdAudit: async (a) => { audits.push(a); } },
    "../services/accountLock": { assessAccount: async () => ({ duesPaise: 0, shouldLock: false }), evaluateLock: async () => null },
    "../services/subscription": {
      SubscriptionError,
      statusFor: async () => ({ status: "ACTIVE", pendingPlanCode: "BILLING" }),
      csdChangePlan: async (a) => {
        calls.push(a);
        if (a.code === "POS_UP") throw new SubscriptionError("Upgrades are made by the store in POS Billing, which charges the difference.", 409, { code: "UPGRADE_IN_POS" });
        return next;
      },
    },
  };
  await withFakes(fakes, "../controllers/csdBillingConfigController", async (ctrl) => {
    const req = (body) => ({ params: { restaurantId: RID }, body, csdStaff: { fullName: "Ria" } });

    const noReason = await call(ctrl.changeAccountPlan, req({ code: "BILLING", reason: "x" }));
    assert.equal(noReason.error.status, 400);
    assert.ok(noReason.error.fieldErrors.reason);
    assert.equal(calls.length, 0, "nothing changed without a reason");

    const ok = await call(ctrl.changeAccountPlan, req({ code: "billing", reason: "Owner asked by phone" }));
    assert.equal(ok.status, 200);
    assert.deepEqual(calls.at(-1), { restaurantId: RID, code: "BILLING" });
    assert.equal(ok.body.data.subscription.pendingPlanCode, "BILLING", "answers with the account standing");
    assert.deepEqual(
      [audits[0].action, audits[0].entityId, audits[0].storeId, audits[0].severity],
      ["BILLING.SUBSCRIPTION.PLAN", "sub1", "148379", "WARNING"],
    );
    assert.equal(audits[0].description, `Plan POS → BILLING, effective ${end.toISOString()}: Owner asked by phone`);
    assert.deepEqual(audits[0].previousValue, { planCode: "POS", pendingPlanCode: "" });
    assert.deepEqual(audits[0].newValue, { planCode: "POS", pendingPlanCode: "BILLING", effectiveAt: end, reason: "Owner asked by phone" });

    next = { ...next, subscription: { ...next.subscription, pendingPlanCode: "" }, before: { planCode: "POS", pendingPlanCode: "BILLING" }, effectiveAt: null };
    await call(ctrl.changeAccountPlan, req({ code: "POS", reason: "Changed their mind" }));
    assert.equal(audits[1].description, "Scheduled plan change cancelled: Changed their mind");

    next = { ...next, already: true };
    await call(ctrl.changeAccountPlan, req({ code: "POS", reason: "Again" }));
    assert.equal(audits.length, 2, "nothing changed, nothing audited");

    const refused = await call(ctrl.changeAccountPlan, req({ code: "POS_UP", reason: "Upgrade please" }));
    assert.deepEqual([refused.error.status, refused.error.code], [409, "UPGRADE_IN_POS"]);
  });
});

/** A stored config row at `catalogVersion`, as Mongo would hand it over. */
const storedRow = (catalogVersion, addons, extra = {}) => {
  const { PlatformBillingConfig } = require("../models/platformBillingModel");
  return PlatformBillingConfig.hydrate({
    _id: "64b0000000000000000000ad",
    __v: 3,
    singleton: "platform",
    catalogVersion,
    basePlan: { code: "POS", name: "POS", pricePaise: 49900 },
    billingPlan: { code: "BILLING", name: "Billing", pricePaise: 19900, firstRechargeMinPaise: 300000, topUpMinPaise: 150000 },
    addons,
    printers: [{ code: "TABLET", name: "Tablet", pricePaise: 1000000, isActive: true }],
    firstRechargeMinPaise: 300000,
    topUpMinPaise: 100000,
    websiteOrderCharge: { enabled: true, amountPaise: 300, effectiveFrom: new Date("2026-10-01"), taxable: true },
    qrOrderCharge: { enabled: false, amountPaise: 100 },
    knotEatsOrderCharge: { enabled: false, amountPaise: 900 },
    ebillCharge: { enabled: false, amountPaise: 25 },
    ...extra,
  });
};

/** getPlatformConfig over `row`; store rows must not be touched by these steps. */
const readThrough = async (row) => {
  const pricing = require("../services/pricing");
  const { PlatformBillingConfig } = require("../models/platformBillingModel");
  const CsdStoreCharges = require("../models/csdStoreChargesModel");
  const real = [PlatformBillingConfig.findOne, CsdStoreCharges.updateMany, CsdStoreCharges.find];
  const storeWrites = [];
  let saves = 0;
  row.save = async () => { saves += 1; };
  PlatformBillingConfig.findOne = async () => row;
  CsdStoreCharges.updateMany = async (...a) => (storeWrites.push(a), { modifiedCount: 0 });
  CsdStoreCharges.find = (...a) => (storeWrites.push(a), { lean: async () => [] });
  try {
    const got = await pricing.getPlatformConfig();
    const savesAfterFirst = saves;
    await pricing.getPlatformConfig();
    return { got, saves: savesAfterFirst, savesAgain: saves - savesAfterFirst, storeWrites };
  } finally {
    [PlatformBillingConfig.findOne, CsdStoreCharges.updateMany, CsdStoreCharges.find] = real;
  }
};

const addonView = (a) => [a.code, a.name, a.description, a.pricePaise, a.periodDays ?? null, a.feature, a.isActive, a.sortOrder];

// Changed 2026-10-16 (was: v4 -> v5 kept the QR rows, off sale): the owner asked for QR Table Ordering to be removed completely.
test("2026-10-16: a v4 row goes straight to v6: every QR Table Ordering add-on leaves the catalogue once, the rest stay as CSD left them", async () => {
  const { got, saves, savesAgain } = await readThrough(storedRow(4, [
    { code: "TABLE_QR", name: "QR Table Ordering", pricePaise: 20000, feature: "tableQr", isActive: true, sortOrder: 1 },
    { code: "WEBSITE", name: "Website", pricePaise: 360000, periodDays: 365, feature: "website", isActive: true, sortOrder: 2 },
    { code: "QR_PLUS", name: "CSD-made QR", pricePaise: 15000, feature: "tableQr", isActive: true },
    { code: "GMB", name: "GMB Management", pricePaise: 10000, feature: "", isActive: false, sortOrder: 3 },
  ]));
  assert.equal(saves, 1);
  assert.equal(got.catalogVersion, 6);
  assert.deepEqual(
    got.addons.map((a) => [a.code, a.pricePaise, a.isActive]),
    [["WEBSITE", 360000, true], ["GMB", 10000, false]],
    "every table-QR add-on gone, by code or by what it unlocked; the rest exactly as CSD left them",
  );
  assert.equal(savesAgain, 0, "a v6 row is not written again");
});

test("REGRESSION 2026-10-16: the live v5 row loses TABLE_QR once and keeps every other add-on and setting", async () => {
  const website = { code: "WEBSITE", name: "Website", description: "Your own ordering website and table booking.", pricePaise: 360000, periodDays: 365, feature: "website", isActive: true, sortOrder: 2 };
  const gmb = { code: "GMB", name: "GMB Management", description: "Profile upkeep", pricePaise: 12000, periodDays: null, feature: "", isActive: true, sortOrder: 3 };
  // One CSD made and took off sale: off-sale rows that are not retired stay.
  const kds = { code: "KDS", name: "Kitchen Display", description: "", pricePaise: 15000, periodDays: null, feature: "", isActive: false, sortOrder: 4 };
  const live = storedRow(5, [
    // As the screenshot shows it: ₹200 / 30 days, off sale, unlocks QR table ordering.
    { code: "TABLE_QR", name: "QR Table Ordering", description: "Diners scan the table QR to order and pay.", pricePaise: 20000, periodDays: null, feature: "tableQr", isActive: false, sortOrder: 1 },
    website,
    gmb,
    kds,
  ]);
  const { got, saves, savesAgain, storeWrites } = await readThrough(live);

  assert.equal(got.catalogVersion, 6);
  assert.deepEqual(got.addons.map(addonView), [website, gmb, kds].map(addonView), "every other add-on kept, field for field");
  assert.equal(saves, 1, "written once");
  assert.equal(got.$__delta()?.[1]?.$inc?.__v, 1, "saved only over the version it read");
  assert.equal(savesAgain, 0, "once only: the next read leaves the row alone");
  assert.equal(got.validateSync(), undefined, "the saved row passes the model (no tableQr feature is left)");
  // Nothing else moves.
  assert.deepEqual([got.basePlan.pricePaise, got.billingPlan.pricePaise, got.firstRechargeMinPaise, got.topUpMinPaise], [49900, 19900, 300000, 100000]);
  assert.deepEqual(got.printers.map((p) => [p.code, p.pricePaise]), [["TABLET", 1000000]]);
  assert.deepEqual([got.websiteOrderCharge.enabled, got.websiteOrderCharge.amountPaise], [true, 300]);
  assert.deepEqual(storeWrites, [], "stores' negotiated prices are not touched");
});

// Changed 2026-10-16 (was: a saved TABLE_QR row stayed retired, off sale, through CSD edits): CSD cannot make one at all now.
test("REGRESSION 2026-10-16: CSD cannot recreate QR Table Ordering, by its code or by what it unlocks", async () => {
  const errors = {};
  readCatalog(
    [
      { code: "table_qr", name: "QR Table Ordering", price: 200, feature: "", isActive: false },
      { code: "QR_PLUS", name: "CSD-made QR", price: 150, feature: "tableQr", isActive: false },
      { code: "GMB", name: "GMB Management", price: 100, feature: "", isActive: true },
    ],
    "addons",
    errors,
    new Set(),
    { addons: true },
  );
  assert.deepEqual(Object.keys(errors).sort(), ["addons.0.code", "addons.1.feature"]);
  assert.match(errors["addons.0.code"], /comes with the POS plan: this add-on is retired/);
  assert.match(errors["addons.1.feature"], /none or website/);

  // Through the endpoint (a CSD page loaded before the removal, say): refused whole, nothing saved.
  const { PlatformBillingConfig } = require("../models/platformBillingModel");
  const config = new PlatformBillingConfig({});
  let saves = 0;
  config.save = async () => { saves += 1; return config; };
  const fakes = {
    "../services/pricing": { getPlatformConfig: async () => config },
    "../services/csdAuditService": { csdAudit: async () => {} },
  };
  await withFakes(fakes, "../controllers/csdBillingConfigController", async (ctrl) => {
    const shown = ctrl.present(config).addons;
    assert.ok(!shown.some((a) => a.code === "TABLE_QR" || a.feature === "tableQr"), "not listed in CSD Billing");
    const stale = await call(ctrl.updateBillingConfig, {
      body: { addons: [{ code: "TABLE_QR", name: "QR Table Ordering", price: 200, feature: "tableQr", isActive: false }, ...shown] },
      csdStaff: {},
    });
    assert.equal(stale.error.status, 400);
    assert.ok(stale.error.fieldErrors["addons.0.code"]);
    // The guard still protects every other saved add-on: it can go off sale, never leave the list.
    const dropped = await call(ctrl.updateBillingConfig, { body: { addons: shown.filter((a) => a.code !== "GMB") }, csdStaff: {} });
    assert.match(dropped.error.fieldErrors.addons, /"GMB" is saved: take it off sale/);
    assert.equal(saves, 0, "nothing saved");
  });
});
