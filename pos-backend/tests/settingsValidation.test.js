/**
 * Settings validation (QA batch 8): bad values are refused with a message
 * instead of being dropped or stored. V1 GSTIN, V2 out-of-range ordering
 * values, V4 delivery slabs, V5 holidays, V7 table seats, and H3: Close for
 * Today stores the business date.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const bcrypt = require("bcrypt");

const WebsiteSettings = require("../models/websiteSettingsModel");
const Restaurant = require("../models/restaurantModel");
const AuditLog = require("../models/auditLogModel");
const Table = require("../models/tableModel");
const restaurantCtl = require("../controllers/restaurantController");
const tableCtl = require("../controllers/tableController");

const CTRL = "../controllers/websiteSettingsController";

const withFakes = async (fakes, fn) => {
  const orig = Module._load;
  Module._load = function (r) {
    if (Object.prototype.hasOwnProperty.call(fakes, r)) return fakes[r];
    return orig.apply(this, arguments);
  };
  try {
    return await fn();
  } finally {
    Module._load = orig;
  }
};

/** PUT /api/website/settings against an in-memory settings document. */
const save = async (body, seed = {}) => {
  const settings = new WebsiteSettings({ storeId: "231146", slug: "231146", ...seed });
  let saves = 0;
  settings.save = async () => { saves += 1; return settings; };
  let error;
  await withFakes(
    {
      "../services/auditService": { logActivity: async () => {} },
      "../services/knotEats": { invalidateListing: () => {} },
      "./tableSessionController": { restrikeOpenBills: async () => 0 },
    },
    async () => {
      delete require.cache[require.resolve(CTRL)];
      const { updateWebsiteSettings } = require(CTRL);
      const res = { status: () => res, json: () => res };
      await updateWebsiteSettings(
        { user: { role: "Owner" }, websiteTarget: { tenant: { storeId: "231146" }, settings }, body },
        res,
        (e) => { error = e; },
      );
      delete require.cache[require.resolve(CTRL)];
    },
  );
  return { error, settings, saves };
};

/** A handler call: resolves to { error, status, body }. */
const call = async (handler, req) => {
  const out = {};
  const res = { status: (s) => { out.status = s; return res; }, json: (b) => { out.body = b; return res; } };
  await handler(req, res, (e) => { out.error = e; });
  return out;
};

test("V2 out-of-range GST, service charge and fees are refused per field, not dropped while saying Saved", async () => {
  const seed = { ordering: { taxPercent: 5, serviceChargePercent: 10, packagingFee: 20 } };
  const { error, settings, saves } = await save({ ordering: { taxPercent: 180, serviceChargePercent: 30, packagingFee: -10 } }, seed);
  assert.equal(error?.status, 400);
  assert.equal(saves, 0);
  assert.deepEqual(Object.keys(error.fieldErrors).sort(), ["ordering.packagingFee", "ordering.serviceChargePercent", "ordering.taxPercent"]);
  assert.equal(error.fieldErrors["ordering.taxPercent"], "Enter a GST rate from 0 to 100.");
  assert.deepEqual([settings.ordering.taxPercent, settings.ordering.serviceChargePercent, settings.ordering.packagingFee], [5, 10, 20]);

  const minutes = await save({ ordering: { autoReadyMinutes: { table: 2000 }, autoCompleteMinutes: { delivery: -1 }, tableBooking: { slotMinutes: 1, openTime: "25:00" } } });
  assert.equal(minutes.error?.status, 400);
  assert.deepEqual(Object.keys(minutes.error.fieldErrors).sort(), [
    "ordering.autoCompleteMinutes.delivery",
    "ordering.autoReadyMinutes.table",
    "ordering.tableBooking.openTime",
    "ordering.tableBooking.slotMinutes",
  ]);

  const ok = await save({ ordering: { taxPercent: 100, serviceChargePercent: 25, packagingFee: 0, autoReadyMinutes: { table: 1440 }, tableBooking: { slotMinutes: 5 } } });
  assert.equal(ok.error, undefined, "the edges of each range still save");
  assert.deepEqual([ok.settings.ordering.taxPercent, ok.settings.ordering.serviceChargePercent, ok.saves], [100, 25, 1]);
});

test("V4 delivery slabs must run on without gaps or overlaps; they are stored by distance", async () => {
  const gap = await save({ ordering: { deliverySlabsConfig: { maxDistanceKm: 8, slabs: [{ minKm: 0, maxKm: 3, fee: 20 }, { minKm: 5, maxKm: 8, fee: 60 }] } } });
  assert.equal(gap.error?.status, 400);
  assert.match(gap.error.fieldErrors["ordering.deliverySlabsConfig.slabs.1"], /Start this slab at 3 km/);

  const overlap = await save({ ordering: { deliverySlabsConfig: { maxDistanceKm: 8, slabs: [{ minKm: 3, maxKm: 8, fee: 60 }, { minKm: 0, maxKm: 5, fee: 20 }] } } });
  assert.equal(overlap.error?.status, 400);
  assert.deepEqual(Object.keys(overlap.error.fieldErrors), ["ordering.deliverySlabsConfig.slabs.0"], "the error names the row as sent");

  const reversed = await save({ ordering: { deliverySlabsConfig: { slabs: [{ minKm: 2, maxKm: 2, fee: 10 }] } } });
  assert.equal(reversed.error?.status, 400, "a slab must end after it starts");

  const ok = await save({ ordering: { deliverySlabsConfig: { maxDistanceKm: 8, slabs: [{ minKm: 3, maxKm: 8, fee: 60 }, { minKm: 0, maxKm: 3, fee: 20 }] } } });
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.settings.ordering.deliverySlabsConfig.slabs.map((s) => [s.minKm, s.maxKm, s.fee]), [[0, 3, 20], [3, 8, 60]]);
});

test("V1 a GST Number that is not a GSTIN is refused; a valid one is stored uppercased; empty clears it", async () => {
  const doc = { name: "Demo", taxId: "", securityPin: await bcrypt.hash("1234", 4), branding: { logo: "" }, address: {}, save: async () => doc };
  const saved = { f: Restaurant.findOne, l: AuditLog.create };
  Restaurant.findOne = async () => doc;
  AuditLog.create = async () => ({});
  const run = (gstNumber) => call(restaurantCtl.updateStoreProperties, { body: { pin: "1234", gstNumber }, user: { restaurantId: "r1", role: "Owner" } });
  try {
    const bad = await run("applied for");
    assert.equal(bad.error?.status, 400);
    assert.equal(bad.error.message, "Enter a valid 15-character GSTIN, or leave it empty.");
    assert.equal(doc.taxId, "");

    assert.equal((await run(" 19abcde1234f1z5 ")).error, undefined);
    assert.equal(doc.taxId, "19ABCDE1234F1Z5");
    assert.equal((await run("")).error, undefined);
    assert.equal(doc.taxId, "");
  } finally {
    Restaurant.findOne = saved.f;
    AuditLog.create = saved.l;
  }
});

test("V5 a holiday with a missing date, or that ends before it starts, is refused", async () => {
  const saved = WebsiteSettings.findOneAndUpdate;
  let stored;
  WebsiteSettings.findOneAndUpdate = async (_f, upd) => { stored = upd.$set.holidays; return { holidays: stored }; };
  const run = (holidays) => call(restaurantCtl.updateHolidays, { body: { holidays }, user: { restaurantId: "r1" } });
  try {
    for (const h of [
      { startDate: "2026-10-20", endDate: "2026-10-18", reason: "Diwali" },
      { startDate: "", endDate: "2026-10-18" },
      { startDate: "2026-10-18" },
    ]) {
      const out = await run([h]);
      assert.equal(out.error?.status, 400, JSON.stringify(h));
      assert.equal(out.error.message, "Enter a valid start and end date; the end cannot be before the start.");
    }
    assert.equal(stored, undefined, "nothing was written");

    const ok = await run([{ startDate: "2026-10-18", endDate: "2026-10-18", reason: "Diwali" }]);
    assert.equal(ok.error, undefined);
    assert.equal(ok.body.message, "Holidays updated!");
    assert.equal(stored.length, 1);
  } finally {
    WebsiteSettings.findOneAndUpdate = saved;
  }
});

test("V7 table seats must be a whole number from 1 to 100, on add and on edit", async () => {
  const saved = { fo: Table.findOne, foau: Table.findOneAndUpdate, save: Table.prototype.save, log: AuditLog.create };
  let created;
  let update;
  Table.findOne = (q) => {
    const p = Promise.resolve(q && q._id ? { _id: q._id, capacity: 4, currentOccupancy: 0, displayId: "T1" } : null);
    p.sort = () => p;
    return p;
  };
  Table.prototype.save = async function () { created = this; return this; };
  Table.findOneAndUpdate = async (_f, u) => { update = u; return { displayId: "T1", capacity: u.capacity ?? 4 }; };
  AuditLog.create = async () => ({});
  const user = { _id: "507f1f77bcf86cd799439013", restaurantId: "507f1f77bcf86cd799439011" };
  const add = (body) => call(tableCtl.addTable, { body: { displayId: "T9", ...body }, user });
  const edit = (body) => call(tableCtl.updateTable, { params: { id: "507f1f77bcf86cd799439012" }, body, user });
  try {
    for (const capacity of ["0", 0, 2.5, 101, "abc", ""]) {
      created = undefined;
      const out = await add({ capacity });
      assert.equal(out.error?.status, 400, `add ${JSON.stringify(capacity)}`);
      assert.equal(out.error.message, "Seats must be a whole number from 1 to 100.");
      assert.equal(created, undefined);
    }
    assert.equal((await add({ seats: "6" })).error, undefined);
    assert.equal(created.capacity, 6);
    assert.equal((await add({})).error, undefined);
    assert.equal(created.capacity, 4, "no value given: the default 4 seats");

    for (const capacity of [0, 2.5, 101, "abc"]) {
      update = undefined;
      const out = await edit({ capacity });
      assert.equal(out.error?.status, 400, `edit ${JSON.stringify(capacity)}`);
      assert.equal(out.error.message, "Seats must be a whole number from 1 to 100.");
      assert.equal(update, undefined);
    }
    assert.equal((await edit({ capacity: "8" })).error, undefined);
    assert.equal(update.capacity, 8);
    assert.equal((await edit({ displayId: "T2" })).error, undefined);
    assert.equal("capacity" in update, false, "an edit without seats leaves them alone");
  } finally {
    Table.findOne = saved.fo;
    Table.findOneAndUpdate = saved.foau;
    Table.prototype.save = saved.save;
    AuditLog.create = saved.log;
  }
});

test("H3 Close for Today stores the business date (an after-midnight press closes the shift that is running)", async () => {
  const settingsDoc = { channelHours: {}, closedForToday: { enabled: false } };
  const saved = { fbi: Restaurant.findById, fo: WebsiteSettings.findOne, foau: WebsiteSettings.findOneAndUpdate };
  const asked = [];
  let stored;
  Restaurant.findById = () => ({ select: () => ({ lean: () => Promise.resolve({ timezone: "Asia/Kolkata" }) }) });
  WebsiteSettings.findOne = () => ({ lean: async () => settingsDoc });
  WebsiteSettings.findOneAndUpdate = async (_f, upd) => { stored = upd.$set.closedForToday; return { closedForToday: stored }; };
  try {
    const out = await withFakes(
      { "../services/websiteAvailability": { businessDate: (s, at, tz) => { asked.push({ s, at, tz }); return "2026-10-12"; } } },
      () => call(restaurantCtl.toggleClosedForToday, { body: { enabled: true }, user: { restaurantId: "507f1f77bcf86cd799439011" } }),
    );
    assert.equal(out.error, undefined, out.error?.message);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].s, settingsDoc, "the store's own hours decide the trading day");
    assert.ok(asked[0].at instanceof Date);
    assert.equal(asked[0].tz, "Asia/Kolkata");
    assert.deepEqual([stored.enabled, stored.date], [true, "2026-10-12"]);
  } finally {
    Restaurant.findById = saved.fbi;
    WebsiteSettings.findOne = saved.fo;
    WebsiteSettings.findOneAndUpdate = saved.foau;
  }
});
