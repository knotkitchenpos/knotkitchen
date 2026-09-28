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

test("the website shows each offered channel's week and the holidays still ahead", () => {
  const { publicHours } = require("../services/websiteAvailability");
  const s = settings({
    ordering: { pickupEnabled: true, deliveryEnabled: true, tableBooking: { enabled: true } },
    holidays: [
      { startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-09-02T00:00:00Z"), reason: "Past" },
      { startDate: new Date("2026-10-20T00:00:00Z"), endDate: new Date("2026-10-22T00:00:00Z"), reason: "Durga Puja" },
    ],
  });
  s.channelHours.delivery.weekly[0] = { day: 0, isOpen: false, openTime: "12:00", closeTime: "21:00" };
  const h = publicHours(s, TZ, ist("2026-09-14", "10:00"));
  assert.deepEqual(h.channels.map((c) => c.key), ["collection", "delivery", "table"]);
  assert.deepEqual(h.channels[0].week[1], { day: 1, isOpen: true, openTime: "11:00", closeTime: "22:00" });
  assert.deepEqual(h.channels[1].week[0], { day: 0, isOpen: false, openTime: "", closeTime: "" }, "a closed day");
  assert.deepEqual(h.holidays, [{ start: "2026-10-20", end: "2026-10-22", reason: "Durga Puja" }], "past holidays drop off");
});

test("only channels the restaurant offers are shown; no hours saved means open all day", () => {
  const { publicHours } = require("../services/websiteAvailability");
  const s = settings({ ordering: { pickupEnabled: true, deliveryEnabled: false, tableBooking: { enabled: false } } });
  s.channelHours.collection = {};
  const h = publicHours(s, TZ, ist("2026-09-14", "10:00"));
  assert.deepEqual(h.channels, [{ key: "collection", week: null }]);
});

test("SOURCE: the CSD store page shows Website Timing & Holidays, not the unused business hours", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const ctrl = fs.readFileSync(path.join(__dirname, "..", "controllers", "csdRestaurantController.js"), "utf8");
  assert.match(ctrl, /const channels = websiteAvailability\(settings, timezone\);/, "Open now as the storefront decides it");
  assert.match(ctrl, /websiteHours: publicHours\(settings, timezone\),/);
  assert.doesNotMatch(ctrl, /isStoreOpen|settings\?\.openingHours \|\|/, "the business hours nothing edits any more");
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "csd-web", "src", "pages", "RestaurantDetail.jsx"), "utf8");
  assert.match(page, /<WebsiteHours hours=\{storeProperties\.websiteHours\}/);
  assert.match(page, /addEventListener\("visibilitychange", refresh\)/, "refetched when the tab comes back");
});
