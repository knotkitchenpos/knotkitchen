const { test } = require("node:test");
const assert = require("node:assert/strict");
const { availabilityAt, hoursOnLabel, publicHours } = require("../services/websiteAvailability");

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

test("REGRESSION: no hours saved runs on the POS default 4:00 PM – 11:50 PM, not open all day", () => {
  assert.equal(availabilityAt({}, "collection", ist("2026-09-14", "03:00"), TZ).open, false);
  assert.equal(availabilityAt({}, "collection", ist("2026-09-14", "16:00"), TZ).open, true);
  assert.equal(availabilityAt({}, "collection", ist("2026-09-14", "23:50"), TZ).open, false);
  assert.match(availabilityAt({}, "collection", ist("2026-09-14", "12:00"), TZ).reason, /Pickup is available 4:00 PM – 11:50 PM today\./);
  // The same default the POS Website Timing screen shows for an unsaved channel.
  const fs = require("node:fs");
  const path = require("node:path");
  const view = fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", "src", "components", "settings", "TimingsHolidaysView.jsx"), "utf8");
  assert.match(view, /found\?\.openTime \|\| "16:00"/);
  assert.match(view, /found\?\.closeTime \|\| "23:50"/);
});

test("REGRESSION: an overnight shift reads as one range, not split at midnight", () => {
  const s = settings({ channelHours: { delivery: { weekly: allWeek("16:00", "02:00") } } });
  assert.equal(
    availabilityAt(s, "delivery", ist("2026-09-14", "10:00"), TZ).reason,
    "Delivery is available 4:00 PM – 2:00 AM today.",
  );
  assert.equal(hoursOnLabel(s, "delivery", "2026-09-14"), "4:00 PM – 2:00 AM");
});

test("extra slots added with Add Hour open the channel too, and show with the main hours", () => {
  const weekly = allWeek("11:00", "15:00").map((d) => ({ ...d, periods: [{ openTime: "18:00", closeTime: "23:00" }] }));
  const s = settings({ channelHours: { collection: { weekly } } });
  assert.equal(availabilityAt(s, "collection", ist("2026-09-14", "12:00"), TZ).open, true);
  assert.equal(availabilityAt(s, "collection", ist("2026-09-14", "16:00"), TZ).open, false, "between the slots");
  assert.equal(availabilityAt(s, "collection", ist("2026-09-14", "19:00"), TZ).open, true, "second slot");
  assert.match(availabilityAt(s, "collection", ist("2026-09-14", "16:00"), TZ).reason, /11:00 AM – 3:00 PM, 6:00 PM – 11:00 PM today/);
  assert.equal(hoursOnLabel(s, "collection", "2026-09-14"), "11:00 AM – 3:00 PM, 6:00 PM – 11:00 PM");
  assert.deepEqual(publicHours(s, TZ, ist("2026-09-14", "10:00")).channels[0].week[1].periods, [{ openTime: "18:00", closeTime: "23:00" }]);
});

test("the extra slots survive saving, from the POS and from CSD", () => {
  const WebsiteSettings = require("../models/websiteSettingsModel");
  const doc = new WebsiteSettings({
    restaurantId: "507f1f77bcf86cd799439011",
    channelHours: { collection: { weekly: [{ day: 1, isOpen: true, openTime: "11:00", closeTime: "15:00", periods: [{ openTime: "18:00", closeTime: "23:00" }] }] } },
  });
  assert.deepEqual(doc.toObject().channelHours.collection.weekly[0].periods, [{ openTime: "18:00", closeTime: "23:00" }]);
  const fs = require("node:fs");
  const path = require("node:path");
  const csd = fs.readFileSync(path.join(__dirname, "..", "controllers", "csdWebsiteController.js"), "utf8");
  assert.match(csd, /closeTime: row\.closeTime, periods \}/, "CSD keeps them when it saves the week");
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
  assert.deepEqual(h.channels[0].week[1], { day: 1, isOpen: true, openTime: "11:00", closeTime: "22:00", periods: [] });
  assert.deepEqual(h.channels[1].week[0], { day: 0, isOpen: false, openTime: "", closeTime: "", periods: [] }, "a closed day");
  assert.equal(h.channels[0].saved, true);
  assert.equal(h.today, 1, "the store's weekday");
  assert.equal(h.closedToday, "");
  assert.deepEqual(h.holidays, [{ start: "2026-10-20", end: "2026-10-22", reason: "Durga Puja" }], "past holidays drop off");
});

test("only channels the restaurant offers are shown; no hours saved shows the default week, marked unsaved", () => {
  const s = settings({ ordering: { pickupEnabled: true, deliveryEnabled: false, tableBooking: { enabled: false } } });
  s.channelHours.collection = {};
  const h = publicHours(s, TZ, ist("2026-09-14", "10:00"));
  assert.deepEqual(h.channels.map((c) => [c.key, c.saved]), [["collection", false]]);
  assert.deepEqual(h.channels[0].week[3], { day: 3, isOpen: true, openTime: "16:00", closeTime: "23:50", periods: [] });
});

test("a holiday or Close for Today today says why, for the whole page", () => {
  const holiday = settings({ holidays: [{ startDate: new Date("2026-09-14T00:00:00Z"), endDate: new Date("2026-09-14T00:00:00Z"), reason: "Durga Puja" }] });
  assert.equal(publicHours(holiday, TZ, ist("2026-09-14", "10:00")).closedToday, "Durga Puja");
  assert.equal(hoursOnLabel(holiday, "table", "2026-09-14"), "Closed");
  const closed = settings({ closedForToday: { enabled: true, date: "2026-09-14", reason: "" } });
  assert.equal(publicHours(closed, TZ, ist("2026-09-14", "10:00")).closedToday, "Closed for today");
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
