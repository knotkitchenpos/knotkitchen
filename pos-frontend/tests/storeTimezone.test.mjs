import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// A till whose device clock is set to London. Set before anything formats a
// date, so the helpers below would use it if they did not pass the store zone.
process.env.TZ = "Europe/London";

const { time12, dateGB, localDay, cellDay, storeClock, STORE_TZ } = await import("../src/utils/index.js");
const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("REGRESSION: a London device shows the store's clock and the store's today", () => {
  assert.equal(STORE_TZ, "Asia/Kolkata");
  // 08:00 UTC is 13:30 in the store; the London device showed 09:00 AM.
  assert.equal(time12("2026-10-06T08:00:00Z"), "01:30 PM");
  // 20:00 UTC on the 5th is already the 6th in the store.
  assert.equal(localDay(new Date("2026-10-05T20:00:00Z")), "2026-10-06");
  assert.equal(dateGB("2026-10-05T20:00:00Z"), "6 Oct 2026");
});

test("dish schedules and timed prices read the store's weekday and minutes", () => {
  // 04:00 UTC on Tue 6 Oct is 09:30 IST, still Tuesday.
  assert.deepEqual(storeClock(new Date("2026-10-06T04:00:00Z")), { day: 2, minutes: 570 });
  // 18:29 UTC on Sun 4 Oct is 23:59 IST Sunday.
  assert.deepEqual(storeClock(new Date("2026-10-04T18:29:00Z")), { day: 0, minutes: 1439 });
});

test("calendar cells keep the device's own date (no zone shift)", () => {
  assert.equal(cellDay(new Date(2026, 9, 6)), "2026-10-06");
  const reports = SRC("src/pages/Reports.jsx");
  // Cells and strip chips are device-local midnights: cellDay, never localDay(d).
  assert.doesNotMatch(reports, /localDay\(d\)/);
  assert.equal((reports.match(/cellDay\(d\)/g) || []).length, 4);
  // The strip ends on the store's today, and the calendar opens on the picked month.
  assert.match(reports, /buildQuickDates\(stripFocus, new Date\(`\$\{today\}T00:00:00`\)\)/);
  assert.match(reports, /const seed = new Date\(`\$\{initialFrom\}T00:00:00`\);/);
});

test("screens that format an instant directly pass the store zone", () => {
  const orders = SRC("src/pages/Orders.jsx");
  const calls = orders.match(/toLocaleString\("en-GB", \{[^}]*\}/g) || [];
  assert.equal(calls.length, 3);
  for (const c of calls) assert.match(c, /timeZone: STORE_TZ/);
  assert.doesNotMatch(SRC("src/pages/KDS.jsx"), /toLocaleTimeString\(\)/);
  assert.match(SRC("src/components/shared/AccountLock.jsx"), /minute: "2-digit", timeZone: STORE_TZ \}/);
  assert.match(SRC("src/components/settings/TimingsHolidaysView.jsx"), /toLocaleDateString\("en-GB", \{ timeZone: STORE_TZ \}\)/);
});
