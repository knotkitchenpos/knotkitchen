// The server runs in UTC; the store's day must not depend on that.
process.env.TZ = "UTC";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildDateWindow } = require("../controllers/orderController");

test("REGRESSION: date=YYYY-MM-DD is the store's day, not UTC's", () => {
  // 'Today' used to run 05:30 to 05:29 IST, so an order at 02:00 IST landed
  // in the previous day's report.
  const w = buildDateWindow({ date: "2026-10-06" });
  assert.equal(w.start.toISOString(), "2026-10-05T18:30:00.000Z");
  assert.equal(w.end.toISOString(), "2026-10-06T18:29:59.999Z");
  assert.equal(w.source, "single");
});

test("a range covers whole store days at both ends", () => {
  const w = buildDateWindow({ from: "2026-10-01", to: "2026-10-06" });
  assert.equal(w.start.toISOString(), "2026-09-30T18:30:00.000Z");
  assert.equal(w.end.toISOString(), "2026-10-06T18:29:59.999Z");
  assert.equal(w.source, "range");
});

test("no date is the store's today, and junk falls back to it", () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  for (const q of [{}, { date: "not a date" }]) {
    const w = buildDateWindow(q);
    assert.equal(w.source, "today");
    assert.equal(w.start.getTime(), buildDateWindow({ date: today }).start.getTime());
  }
});
