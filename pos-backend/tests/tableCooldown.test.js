/**
 * Post-payment table cooldown.
 *
 * A settled table used to flip straight back to "available", so the next
 * party could be seated onto a table nobody had cleared yet. It now enters
 * `cleaning` with an `availableAt` deadline, and a sweep returns it to
 * service once that passes. The wait is per-restaurant and set from Manage
 * Table; zero keeps the old immediate behaviour.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_COOLDOWN_MINUTES,
  buildCooldownUpdate,
  cooldownMinutesFor,
} = require("../services/tableCooldownService");

test("the default wait is 2 minutes", () => {
  assert.equal(DEFAULT_COOLDOWN_MINUTES, 2);
});

test("a settled table goes into cleaning with a future deadline", async () => {
  const before = Date.now();
  const update = await buildCooldownUpdate(null); // no restaurant -> default
  assert.equal(update.status, "cleaning");
  assert.ok(update.availableAt instanceof Date);
  const waitMs = update.availableAt.getTime() - before;
  assert.ok(waitMs > 0, "the deadline must be in the future");
  assert.ok(waitMs <= DEFAULT_COOLDOWN_MINUTES * 60 * 1000 + 1000, "and about the configured wait");
});

test("the table is cleared of its order and occupancy either way", async () => {
  const update = await buildCooldownUpdate(null);
  assert.equal(update.currentOrderId, null);
  assert.equal(update.currentOccupancy, 0);
});

test("cooldownMinutesFor falls back to the default rather than blocking", async () => {
  // There is no database connection in the test process. Settling a bill must
  // not stall on the driver's server-selection timeout waiting to read a
  // setting it can fall back on.
  const started = Date.now();
  const minutes = await cooldownMinutesFor("507f1f77bcf86cd799439011");
  assert.equal(minutes, DEFAULT_COOLDOWN_MINUTES);
  assert.ok(Date.now() - started < 1000, "must not wait on a connection that isn't there");
});

test("the sweep query only ever targets elapsed cooling tables", async () => {
  // Guard the shape of the update: a filter that forgot `availableAt` would
  // free every cooling table on the next tick, which is the bug this whole
  // mechanism exists to avoid.
  const svc = require("../services/tableCooldownService");
  const src = require("fs").readFileSync(require.resolve("../services/tableCooldownService"), "utf8");
  assert.match(src, /status:\s*"cleaning"/, "sweep is scoped to cooling tables");
  assert.match(src, /availableAt:\s*\{\s*\$ne:\s*null,\s*\$lte:\s*now\s*\}/, "and to elapsed deadlines only");
  assert.equal(typeof svc.runTableCooldownTick, "function");
});
