/**
 * Table QR ordering does NOT follow Restaurant Time (owner, 2026-11-06).
 *
 * Restaurant Time, with Holiday and Close for Today, is for booking a table
 * on the website and Knot Eats. A diner seated at a table can order whatever
 * the hours say; the table's QR switch and a paused or locked store still
 * stop it.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const RID = "507f1f77bcf86cd799439011";
const AT_0440_IST = new Date("2026-10-05T23:10:00Z");
const AT_1730_IST = new Date("2026-10-05T12:00:00Z");

const chain = (value) => {
  const q = { select: () => q, lean: async () => value };
  return q;
};

/** qrController with the store's settings and time zone stubbed; the fakes stay on for the lazy requires. */
const withQr = async ({ settings = null, locked = false }, fn) => {
  const fakes = {
    "../models/websiteSettingsModel": { findOne: () => chain(settings) },
    "../models/restaurantModel": { findById: () => chain({ timezone: "Asia/Kolkata" }) },
    "../services/accountLock": { isOrderingLocked: async () => locked, CUSTOMER_PAUSED_MESSAGE: "paused" },
  };
  const orig = Module._load;
  Module._load = function (r) {
    if (Object.prototype.hasOwnProperty.call(fakes, r)) return fakes[r];
    return orig.apply(this, arguments);
  };
  const path = require.resolve("../controllers/qrController");
  delete require.cache[path];
  try {
    return await fn(require(path));
  } finally {
    Module._load = orig;
    delete require.cache[path];
  }
};

/** The order route with the hours as given, and a request that stops right after the opening checks. */
const placeEmpty = async (opts) => withQr(opts, async ({ addSessionItems }) => {
  let status = null;
  let body = null;
  const res = { status(c) { status = c; return res; }, json(b) { body = b; return res; } };
  await addSessionItems(
    { scope: { table: { _id: "t1", qrEnabled: true }, restaurantId: RID }, body: { items: [] }, query: {} },
    res,
    (e) => { throw e; },
  );
  return { status, body };
});

test("owner, 2026-11-06: a holiday or Close for Today does not stop ordering from the table QR", async () => {
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  for (const settings of [
    { holidays: [{ startDate: day(-1), endDate: day(1), reason: "Diwali" }] },
    { closedForToday: { enabled: true, date: day(0), reason: "Staff outing" } },
    { channelHours: { table: { sameForAllDays: true, days: [] } } },
  ]) {
    const { status, body } = await placeEmpty({ settings });
    // Past the opening checks: the next answer is about the empty order, not the hours.
    assert.equal(status, 400, JSON.stringify(settings));
    assert.notEqual(body.code, "ORDERING_CLOSED");
  }
});

test("a paused or locked store still stops table QR orders", async () => {
  const { status, body } = await placeEmpty({ locked: true });
  assert.equal(status, 409);
  assert.equal(body.code, "ORDERING_PAUSED");
});

test("the QR page is never told the restaurant is closed because of Restaurant Time", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "controllers", "qrController.js"), "utf8");
  assert.ok(!src.includes("tableOrderingClosed"));
  assert.ok(src.includes("orderingPaused: await accountLock().isOrderingLocked(restaurantId),"));
});
