const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  bookingConfig,
  zonedInstant,
  bookableDates,
  slotsFor,
  blockWindow,
  formatTime,
} = require("../services/tableBookings");

const TZ = "Asia/Kolkata";

test("a restaurant-local time converts through the store's timezone, not the server's", () => {
  // 5:00 PM in Kolkata is 11:30 UTC.
  assert.equal(zonedInstant("2026-09-14", "17:00", TZ).toISOString(), "2026-09-14T11:30:00.000Z");
  assert.equal(zonedInstant("2026-09-14", "25:00", TZ), null);
  assert.equal(zonedInstant("14/09/2026", "17:00", TZ), null);
});

test("booking hours default to 4 PM - 10 PM and bad values fall back", () => {
  const c = bookingConfig({});
  assert.deepEqual(
    [c.enabled, c.openTime, c.closeTime, c.slotMinutes, c.holdBeforeMinutes, c.releaseAfterMinutes],
    [true, "16:00", "22:00", 30, 30, 60],
  );
  const bad = bookingConfig({ ordering: { tableBooking: { openTime: "9pm", closeTime: "10:00", slotMinutes: 0 } } });
  assert.equal(bad.openTime, "16:00");
  assert.equal(bad.closeTime, "16:00", "a close before open collapses rather than inverting");
  assert.equal(bad.slotMinutes, 30);
});

test("slots run from opening to closing inclusive and hide times already past", () => {
  const config = bookingConfig({});
  const morning = new Date("2026-09-14T03:00:00Z"); // 8:30 AM IST
  const all = slotsFor(config, "2026-09-14", { now: morning, timeZone: TZ });
  assert.equal(all[0], "16:00");
  assert.equal(all.at(-1), "22:00");
  assert.equal(all.length, 13);

  const evening = new Date("2026-09-14T11:40:00Z"); // 5:10 PM IST
  const later = slotsFor(config, "2026-09-14", { now: evening, timeZone: TZ });
  assert.equal(later[0], "17:30");
});

test("the customer can book today and the next six days", () => {
  const dates = bookableDates(new Date("2026-09-14T20:00:00Z"), TZ); // already 15th in IST
  assert.equal(dates.length, 7);
  assert.equal(dates[0], "2026-09-15");
});

test("REGRESSION: a 5 PM booking blocks the table from 4:30 PM", () => {
  const config = bookingConfig({ ordering: { tableBooking: { holdBeforeMinutes: 30, releaseAfterMinutes: 60 } } });
  const start = zonedInstant("2026-09-14", "17:00", TZ);
  const { blockFrom, blockUntil } = blockWindow(start, config);
  assert.equal(blockFrom.toISOString(), zonedInstant("2026-09-14", "16:30", TZ).toISOString());
  assert.equal(blockUntil.toISOString(), zonedInstant("2026-09-14", "18:00", TZ).toISOString());
  assert.equal(formatTime("17:00"), "5:00 PM");
  assert.equal(formatTime("00:30"), "12:30 AM");
});

test("a new order on a pre-booked table is refused on both the POS and the QR path", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  assert.match(read("controllers", "tableSessionController.js"), /const block = await findActiveBlock\(table\._id\);\s+if \(block\) throw blockedError/);
  assert.match(read("controllers", "qrController.js"), /const block = await findActiveBlock\(tableInTxn\._id\);/);
  assert.match(read("controllers", "tableController.js"), /if \(booking\.blocking && !session\) tObj\.status = "reserved"/);
});

// ---------------------------------------------------------------------------
// Public booking (B1, B2): the real controller, its models faked in memory.
// ---------------------------------------------------------------------------
const Module = require("module");
const { localDate } = require("../services/tableBookings");

const allDay = { weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, openTime: "00:00", closeTime: "00:00" })) };
const today = () => localDate(new Date(), TZ);
const tomorrow = () => localDate(new Date(Date.now() + 86400000), TZ);

/** Runs `fn(ctrl, created)` with the store, its tables and the booking model faked. */
const withBookingFakes = async ({ settings, tables = [{ capacity: 4 }] }, fn) => {
  const created = [];
  const query = (doc) => ({ sort: () => ({ select: () => ({ lean: async () => doc }) }) });
  const fakes = {
    "../services/storefrontResolver": {
      resolveStorefront: async () => ({ ok: true, settings, restaurantId: "507f1f77bcf86cd799439011", storeId: "123456", outletId: null, timezone: TZ }),
      REASON_MESSAGES: {},
    },
    "../models/tableModel": {
      findOne: () => query(tables.length ? { capacity: Math.max(...tables.map((t) => t.capacity)) } : null),
    },
    "../models/tableBookingModel": { create: async (doc) => (created.push(doc), { ...doc, toObject: () => doc }) },
    "../services/socket": { emitToRestaurant: () => {} },
  };
  const orig = Module._load;
  Module._load = function (r) {
    return Object.prototype.hasOwnProperty.call(fakes, r) ? fakes[r] : orig.apply(this, arguments);
  };
  const file = require.resolve("../controllers/tableBookingController");
  delete require.cache[file];
  try {
    return await fn(require(file), created);
  } finally {
    Module._load = orig;
    delete require.cache[file];
  }
};
const call = (handler, req) =>
  new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(body) { resolve({ code: this.code, body }); } };
    handler({ params: { slug: "x" }, headers: {}, query: {}, ...req }, res, (err) => resolve({ code: err?.status || 500, body: { message: err?.message } }));
  });
const guest = (date, guestCount = 2) => ({ body: { date, time: "19:00", guestCount, name: "Asha", phone: "9876543210" } });

test("B1: a holiday today does not stop booking a table for another day", async () => {
  const day = new Date(`${today()}T00:00:00Z`);
  const settings = { ordering: { tableBooking: { enabled: true } }, channelHours: { table: allDay }, holidays: [{ startDate: day, endDate: day }] };
  await withBookingFakes({ settings }, async (ctrl, created) => {
    const next = await call(ctrl.getPublicBookingSlots, { query: { date: tomorrow() } });
    assert.equal(next.body.data.enabled, true);
    assert.ok(next.body.data.slots.includes("19:00"));
    assert.equal(next.body.data.closedReason, "");
    const now = await call(ctrl.getPublicBookingSlots, { query: { date: today() } });
    assert.deepEqual(now.body.data.slots, [], "the holiday itself has no slots");
    assert.match(now.body.data.closedReason, /closed for a holiday/);
    assert.equal((await call(ctrl.createPublicTableBooking, guest(tomorrow()))).code, 201);
    assert.equal((await call(ctrl.createPublicTableBooking, guest(today()))).code, 400, "nothing is bookable on the holiday");
    assert.equal(created.length, 1);
  });
});

test("B2: a party bigger than the largest table is asked to call; no tables, no bookings", async () => {
  const settings = { ordering: { tableBooking: { enabled: true } }, channelHours: { table: allDay } };
  await withBookingFakes({ settings, tables: [{ capacity: 4 }, { capacity: 2 }] }, async (ctrl, created) => {
    const big = await call(ctrl.createPublicTableBooking, guest(tomorrow(), 12));
    assert.equal(big.code, 400);
    assert.equal(big.body.message, "Our largest table seats 4. For a bigger group, please call the restaurant.");
    assert.equal((await call(ctrl.createPublicTableBooking, guest(tomorrow(), 4))).code, 201);
    assert.equal(created.length, 1);
  });
  await withBookingFakes({ settings, tables: [] }, async (ctrl, created) => {
    const none = await call(ctrl.createPublicTableBooking, guest(tomorrow()));
    assert.deepEqual([none.code, none.body.message], [409, "Table booking is not available at this restaurant."]);
    assert.equal(created.length, 0);
  });
});
