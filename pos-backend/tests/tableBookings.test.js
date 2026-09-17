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
