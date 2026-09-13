const { test } = require("node:test");
const assert = require("node:assert/strict");
const { availabilityAt } = require("../services/websiteAvailability");

const TZ = "Asia/Kolkata";
// 2026-09-14 is a Monday. IST = UTC+5:30.
const ist = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+05:30`);
const allWeek = (openTime, closeTime) => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, openTime, closeTime }));

const settings = (extra = {}) => ({
  channelHours: {
    collection: { weekly: allWeek("11:00", "22:00") },
    delivery: { weekly: allWeek("12:00", "21:00") },
    table: { weekly: allWeek("16:00", "22:00") },
  },
  holidays: [],
  closedForToday: { enabled: false, date: "" },
  ...extra,
});

test("each channel follows its own timing", () => {
  const s = settings();
  assert.equal(availabilityAt(s, "collection", ist("2026-09-14", "10:59"), TZ).open, false);
  assert.equal(availabilityAt(s, "collection", ist("2026-09-14", "11:00"), TZ).open, true);
  assert.equal(availabilityAt(s, "collection", ist("2026-09-14", "22:00"), TZ).open, false);
  assert.equal(availabilityAt(s, "delivery", ist("2026-09-14", "11:30"), TZ).open, false, "delivery opens at 12");
  assert.equal(availabilityAt(s, "table", ist("2026-09-14", "15:00"), TZ).open, false);
  assert.equal(availabilityAt(s, "table", ist("2026-09-14", "17:00"), TZ).open, true);
  assert.match(availabilityAt(s, "collection", ist("2026-09-14", "09:00"), TZ).reason, /11:00 AM – 10:00 PM/);
});

test("the timing is judged in the restaurant's timezone, not the server's", () => {
  // 18:00 UTC is 23:30 IST: collection (to 22:00) is closed although UTC says 6 PM.
  assert.equal(availabilityAt(settings(), "collection", new Date("2026-09-14T18:00:00Z"), TZ).open, false);
});

test("a closed day and an overnight shift", () => {
  const weekly = allWeek("18:00", "02:00");
  weekly[1] = { day: 1, isOpen: false, openTime: "18:00", closeTime: "02:00" }; // Monday off
  const s = settings({ channelHours: { collection: { weekly } } });
  assert.equal(availabilityAt(s, "collection", ist("2026-09-14", "19:00"), TZ).open, false, "Monday closed");
  assert.equal(availabilityAt(s, "collection", ist("2026-09-14", "01:00"), TZ).open, true, "Sunday's shift runs into Monday");
  assert.equal(availabilityAt(s, "collection", ist("2026-09-15", "01:00"), TZ).open, false, "no Monday shift to run over");
});

test("no hours saved means open all day", () => {
  assert.equal(availabilityAt({}, "delivery", ist("2026-09-14", "03:00"), TZ).open, true);
});

test("Close for Today closes all three channels, and only for that date", () => {
  const s = settings({ closedForToday: { enabled: true, date: "2026-09-14" } });
  for (const channel of ["collection", "delivery", "table"]) {
    const a = availabilityAt(s, channel, ist("2026-09-14", "17:00"), TZ);
    assert.equal(a.open, false, channel);
    assert.equal(a.kind, "closedToday");
  }
  assert.equal(availabilityAt(s, "collection", ist("2026-09-15", "17:00"), TZ).open, true, "resets the next day");
  const off = settings({ closedForToday: { enabled: false, date: "2026-09-14" } });
  assert.equal(availabilityAt(off, "collection", ist("2026-09-14", "17:00"), TZ).open, true, "turned off manually");
});

test("a holiday closes all three channels for every day in the range, then reopens", () => {
  const s = settings({ holidays: [{ startDate: new Date("2026-09-20"), endDate: new Date("2026-09-22") }] });
  for (const ymd of ["2026-09-20", "2026-09-21", "2026-09-22"]) {
    for (const channel of ["collection", "delivery", "table"]) {
      assert.equal(availabilityAt(s, channel, ist(ymd, "17:00"), TZ).kind, "holiday", `${ymd} ${channel}`);
    }
  }
  assert.equal(availabilityAt(s, "collection", ist("2026-09-19", "17:00"), TZ).open, true);
  assert.equal(availabilityAt(s, "collection", ist("2026-09-23", "17:00"), TZ).open, true);
});
