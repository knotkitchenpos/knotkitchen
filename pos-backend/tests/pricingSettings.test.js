/**
 * Pricing settings (QA batch 8): "GST applies to" is saved (PS1), a
 * whole-document save no longer writes back a stale ordering copy (PS3), and a
 * GST or service-charge change re-prices the store's open table bills (PS5).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const WebsiteSettings = require("../models/websiteSettingsModel");
const CTRL = "../controllers/websiteSettingsController";

/** PUT /api/website/settings against an in-memory settings document. */
const save = async (body, seed = {}, req = {}, restrike = async () => 0) => {
  const restrikes = [];
  const settings = new WebsiteSettings({ storeId: "231146", slug: "231146", restaurantId: new mongoose.Types.ObjectId(), ...seed });
  settings.save = async () => settings;
  const fakes = {
    "../services/auditService": { logActivity: async () => {} },
    "../services/knotEats": { invalidateListing: () => {} },
    "./tableSessionController": { restrikeOpenBills: async (rid) => { restrikes.push(String(rid)); return restrike(rid); } },
  };
  const orig = Module._load;
  Module._load = function (r) {
    if (Object.prototype.hasOwnProperty.call(fakes, r)) return fakes[r];
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve(CTRL)];
  let error;
  let sent;
  try {
    const { updateWebsiteSettings } = require(CTRL);
    const res = { status: () => res, json: (b) => { sent = b; return res; } };
    await updateWebsiteSettings(
      { user: { role: "Owner" }, websiteTarget: { tenant: { storeId: "231146" }, settings }, body, ...req },
      res,
      (e) => { error = e; },
    );
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve(CTRL)];
  }
  return { error, settings, restrikes, sent };
};

test("PS1 Rules & Charges: 'GST applies to' is saved; an unknown value is ignored", async () => {
  const { error, settings } = await save({ ordering: { gstApplyTo: "website", taxPercent: 5 } });
  assert.equal(error, undefined);
  assert.equal(settings.ordering.taxPercent, 5);
  assert.equal(settings.ordering.gstApplyTo, "website");
  assert.equal((await save({ ordering: { gstApplyTo: "nonsense" } })).settings.ordering.gstApplyTo, "both");
});

test("PS3 a Manage Website save (echoes version + a stale ordering) leaves ordering alone; the CSD's partial ordering still saves", async () => {
  const seed = { version: 7, ordering: { deliveryEnabled: false, taxPercent: 5, serviceChargePercent: 10 } };
  const stale = { version: 6, displayName: "Cafe", ordering: { deliveryEnabled: true, taxPercent: 0, serviceChargePercent: 0 } };
  const { error, settings } = await save(stale, seed);
  assert.equal(error, undefined);
  assert.equal(settings.displayName, "Cafe", "the rest of the save lands");
  assert.deepEqual(
    [settings.ordering.deliveryEnabled, settings.ordering.taxPercent, settings.ordering.serviceChargePercent],
    [false, 5, 10],
  );
  const csd = await save({ ordering: { deliveryFee: 25 } }, seed, { csdStaff: { staffId: "CSD001" } });
  assert.equal(csd.settings.ordering.deliveryFee, 25);
  assert.equal(csd.settings.ordering.taxPercent, 5);
});

test("PS3 the CSD website dialog sends only the ordering and hours fields it edited", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../csd-web/src/components/WebsiteDesignDialog.jsx"), "utf8");
  // assert.ok, not match: a failure would print the whole dialog.
  assert.ok(!/ordering:\s*settings\.ordering/.test(src), "the whole ordering copy is not sent");
  assert.ok(!/channelHours:\s*settings\.channelHours/.test(src), "the whole hours copy is not sent");
  assert.ok(/ordering:\s*editedOf\("ordering"\)/.test(src), "ordering: the edited fields only");
  assert.ok(/channelHours:\s*editedOf\("channelHours"\)/.test(src), "hours: the edited channels only");
  assert.ok(/edited\.current\.add\(path\)/.test(src), "every patch records its path");
});

test("PS5 a GST or service-charge change re-strikes the store's open table bills, and only then", async () => {
  const seed = { ordering: { serviceChargePercent: 10, taxPercent: 5 } };
  const svc = await save({ ordering: { serviceChargePercent: 0 } }, seed);
  assert.deepEqual(svc.restrikes, [String(svc.settings.restaurantId)]);
  assert.equal((await save({ ordering: { taxPercent: 12 } }, seed)).restrikes.length, 1);
  assert.equal((await save({ ordering: { gstApplyTo: "website" } }, seed)).restrikes.length, 1);
  assert.equal((await save({ ordering: { taxInclusive: true } }, seed)).restrikes.length, 1);
  assert.deepEqual((await save({ displayName: "Cafe" }, seed)).restrikes, [], "a banner/name change re-prices nothing");
  assert.deepEqual((await save({ ordering: { serviceChargePercent: 10, taxPercent: 5 } }, seed)).restrikes, [], "the same rates re-price nothing");
});

test("PS5 a failed re-strike never fails the settings save", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { error, settings, restrikes, sent } = await save(
      { ordering: { serviceChargePercent: 5 } },
      { ordering: { serviceChargePercent: 10 } },
      {},
      async () => { throw new Error("db down"); },
    );
    assert.equal(error, undefined);
    assert.equal(restrikes.length, 1);
    assert.equal(settings.ordering.serviceChargePercent, 5);
    assert.equal(sent?.success, true);
  } finally {
    console.warn = warn;
  }
});
