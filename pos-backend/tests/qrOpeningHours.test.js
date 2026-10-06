/**
 * The table QR follows Restaurant Time.
 *
 * It never checked opening hours, so a scan at 4:40 a.m. placed an order.
 * Table QR ordering now uses the same hours as table bookings (POS Settings >
 * Website Timing > Restaurant Time, default 16:00-23:50 when never saved).
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

test("REGRESSION: a table-QR order at 04:40 IST is refused when Restaurant Time is 16:00-23:50", async () => {
  await withQr({}, async ({ tableOrderingClosed }) => {
    const reason = await tableOrderingClosed(RID, AT_0440_IST);
    assert.match(reason, /^Ordering at the table is available /);
    assert.equal(await tableOrderingClosed(RID, AT_1730_IST), "", "open at 17:30");
  });
});

test("Close for Today shuts the table QR too", async () => {
  const settings = { closedForToday: { enabled: true, date: "2026-10-05", reason: "Staff outing" } };
  await withQr({ settings }, async ({ tableOrderingClosed }) => {
    assert.match(await tableOrderingClosed(RID, AT_1730_IST), /closed for today\. Ordering at the table is unavailable/);
  });
});

test("the order route answers 403 ORDERING_CLOSED (a 409 would end the diner's session)", async () => {
  // A holiday from yesterday to tomorrow, so this does not depend on when
  // the suite runs.
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const settings = { holidays: [{ startDate: day(-1), endDate: day(1), reason: "Diwali" }] };
  await withQr({ settings }, async ({ addSessionItems }) => {
    let status = null;
    let body = null;
    const res = { status(c) { status = c; return res; }, json(b) { body = b; return res; } };
    await addSessionItems(
      { scope: { table: { _id: "t1", qrEnabled: true }, restaurantId: RID }, body: { items: [{ menuItemId: "m1", quantity: 1 }] }, query: {} },
      res,
      (e) => { throw e; },
    );
    assert.equal(status, 403);
    assert.equal(body.code, "ORDERING_CLOSED");
  });
});
