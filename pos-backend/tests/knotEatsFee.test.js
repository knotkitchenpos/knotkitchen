/**
 * The Knot Eats platform fee: its own charge, per-store rate and start date,
 * resolved by the same rules as the website and table-QR fees, and edited
 * from the same CSD screens.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const { resolveOrderCharge } = require("../services/pricing");
const { PlatformBillingConfig, DEFAULT_KNOT_EATS_ORDER_CHARGE } = require("../models/platformBillingModel");
const CsdStoreCharges = require("../models/csdStoreChargesModel");

/** Load a module with some of its requires replaced; the fakes stay on while `run` runs. */
const withFakes = async (fakes, modulePath, run) => {
  const orig = Module._load;
  Module._load = function (r) {
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

const ON = { enabled: true, amountPaise: 900, effectiveFrom: new Date("2026-10-01T00:00:00+05:30"), taxable: true };
const at = (charge, override, iso = "2026-10-15T12:00:00+05:30") =>
  resolveOrderCharge({ config: { knotEatsOrderCharge: charge }, override, source: "KNOT_EATS", on: new Date(iso) });

test("resolveOrderCharge: KNOT_EATS follows the platform switch, both start dates, the store rate and billingExempt", async () => {
  assert.deepEqual(DEFAULT_KNOT_EATS_ORDER_CHARGE, { enabled: false, amountPaise: 900, effectiveFrom: null, taxable: true });

  assert.equal((await at({ ...ON, enabled: false }, null)).enabled, false, "switched off");
  const future = await at({ ...ON, effectiveFrom: new Date("2026-11-01") }, null);
  assert.deepEqual([future.enabled, future.started], [false, false], "on, but not started");
  const started = await at(ON, null);
  assert.deepEqual([started.enabled, started.amountPaise, started.source], [true, 900, "platform"]);
  assert.equal((await at(ON, { orderChargeFrom: new Date("2026-10-20") })).enabled, false, "the store's own start is later");

  const rate = async (knotEatsPaidOrderCharge) => {
    const c = await at(ON, { knotEatsPaidOrderCharge });
    return [c.enabled, c.amountPaise, c.source];
  };
  assert.deepEqual(await rate(null), [true, 900, "platform"]);
  assert.deepEqual(await rate(0), [true, 0, "restaurant"], "0 is a real rate");
  assert.deepEqual(await rate(5), [true, 500, "restaurant"]);
  // The website rate never prices a Knot Eats order, nor the other way round.
  assert.equal((await at(ON, { onlinePaidOrderCharge: 2 })).amountPaise, 900);
  assert.equal((await at({ ...ON, enabled: false }, { billingExempt: true })).enabled, false);
  assert.equal((await at(ON, { billingExempt: true })).enabled, false, "a demo store pays none");
});

test("quotePlatformFee: ₹9 for a Knot Eats order, ₹9 + 18% once KnotKitchen's GST is effective", async () => {
  const config = {
    knotEatsOrderCharge: { ...ON, effectiveFrom: new Date("2020-01-01") },
    websiteOrderCharge: { enabled: true, amountPaise: 300, effectiveFrom: new Date("2020-01-01") },
    gst: { registered: false },
  };
  const fakes = {
    "./pricing": {
      getPlatformConfig: async () => config,
      resolveOrderCharge: (args) => resolveOrderCharge({ ...args, override: null }),
    },
    "../models/restaurantModel": { findById: () => ({ select: () => ({ lean: async () => ({ address: { state: "West Bengal" } }) }) }) },
  };
  await withFakes(fakes, "../services/orderCharge", async ({ quotePlatformFee }) => {
    assert.deepEqual(await quotePlatformFee({ restaurantId: "r1", source: "KNOT_EATS" }), {
      amountPaise: 900, taxPaise: 0, totalPaise: 900, taxPercent: 0,
    });
    assert.equal((await quotePlatformFee({ restaurantId: "r1", source: "WEBSITE" })).totalPaise, 300, "the website fee is its own");
    config.gst = { registered: true, effectiveFrom: new Date("2020-01-01"), percent: 18 };
    assert.deepEqual(await quotePlatformFee({ restaurantId: "r1", source: "KNOT_EATS" }), {
      amountPaise: 900, taxPaise: 162, totalPaise: 1062, taxPercent: 18,
    });
  });
});

test("a config row with the Knot Eats charge unset is seeded at ₹9, still OFF", async () => {
  const pricing = require("../services/pricing");
  const realFindOne = PlatformBillingConfig.findOne;
  const doc = new PlatformBillingConfig({ knotEatsOrderCharge: { enabled: false, amountPaise: 0, effectiveFrom: null } });
  let saves = 0;
  doc.save = async () => { saves += 1; return doc; };
  PlatformBillingConfig.findOne = async () => doc;
  try {
    const got = await pricing.getPlatformConfig();
    assert.equal(saves, 1);
    assert.deepEqual(
      [got.knotEatsOrderCharge.amountPaise, got.knotEatsOrderCharge.enabled, got.knotEatsOrderCharge.effectiveFrom],
      [900, false, null],
    );
  } finally {
    PlatformBillingConfig.findOne = realFindOne;
  }
});

test("CSD billing: the Knot Eats fee is shown and edited like the others, and needs a start date to switch on", async () => {
  const config = new PlatformBillingConfig({});
  config.save = async () => config;
  const fakes = {
    "../services/pricing": { getPlatformConfig: async () => config },
    "../services/csdAuditService": { csdAudit: async () => {} },
  };
  await withFakes(fakes, "../controllers/csdBillingConfigController", async (ctrl) => {
    assert.deepEqual(ctrl.present(config).knotEatsOrderCharge, { enabled: false, amount: 9, effectiveFrom: null, taxable: true });

    const call = async (body) => {
      const out = {};
      const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
      await ctrl.updateBillingConfig({ body, csdStaff: {} }, res, (err) => { out.error = err; });
      return out;
    };
    const undated = await call({ knotEatsOrderCharge: { enabled: true, amount: 9 } });
    assert.equal(undated.error.status, 400);
    assert.ok(undated.error.fieldErrors["knotEatsOrderCharge.effectiveFrom"]);

    const ok = await call({ knotEatsOrderCharge: { enabled: true, amount: 12, effectiveFrom: "2026-11-01", taxable: true } });
    assert.equal(ok.status, 200);
    assert.deepEqual([config.knotEatsOrderCharge.amountPaise, config.knotEatsOrderCharge.enabled], [1200, true]);
    assert.equal(ok.body.data.knotEatsOrderCharge.amount, 12);
  });
});

test("CSD store charges: knotEatsPaidOrderCharge round-trips null, 0 and 9 with history, and refuses 10001", async () => {
  const Store = require("../models/storeModel");
  const Restaurant = require("../models/restaurantModel");
  const WebsiteSettings = require("../models/websiteSettingsModel");
  const saved = { store: Store.findOne, restaurant: Restaurant.findOne, settings: WebsiteSettings.findOne, charges: CsdStoreCharges.findOne };
  const row = new CsdStoreCharges({ storeId: "231146", ...CsdStoreCharges.DEFAULTS });
  row.save = async () => row;
  Store.findOne = () => ({ lean: async () => ({ storeId: "231146" }) });
  Restaurant.findOne = () => ({ lean: async () => ({ _id: "r1" }) });
  WebsiteSettings.findOne = () => ({ lean: async () => null });
  CsdStoreCharges.findOne = async () => row;
  const audits = [];
  try {
    await withFakes({ "../services/csdAuditService": { csdAudit: async (a) => audits.push(a) } }, "../controllers/csdRestaurantController", async (ctrl) => {
      const call = async (value) => {
        const out = {};
        const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
        await ctrl.updateCharges(
          { params: { storeId: "231146" }, body: { knotEatsPaidOrderCharge: value }, csdStaff: { _id: "s1", staffId: "CSD1", fullName: "Admin" } },
          res,
          (err) => { out.error = err; },
        );
        return out;
      };
      for (const [sent, stored] of [[9, 9], [0, 0], [null, null]]) {
        const out = await call(sent);
        assert.equal(out.status, 200, String(out.error?.message));
        assert.equal(row.knotEatsPaidOrderCharge, stored);
        assert.equal(out.body.data.knotEatsPaidOrderCharge, stored);
      }
      assert.deepEqual(
        row.history.filter((h) => h.field === "knotEatsPaidOrderCharge").map((h) => [h.from ?? null, h.to ?? null]),
        [[null, 9], [9, 0], [0, null]],
      );
      assert.equal(audits.at(-1).previousValue.knotEatsPaidOrderCharge, 0);

      const big = await call(10001);
      assert.equal(big.error.status, 400);
      assert.match(big.error.fieldErrors.knotEatsPaidOrderCharge, /Knot Eats platform fee looks too large/);
    });
  } finally {
    Store.findOne = saved.store;
    Restaurant.findOne = saved.restaurant;
    WebsiteSettings.findOne = saved.settings;
    CsdStoreCharges.findOne = saved.charges;
  }
});
