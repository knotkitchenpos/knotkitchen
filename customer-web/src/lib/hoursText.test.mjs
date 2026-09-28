import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { holidayText, time12, todayLines, weekGroups } from "./hoursText.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");

const week = (openTime, closeTime) =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, openTime, closeTime }));

test("times read the same in every browser", () => {
  assert.equal(time12("09:00"), "9:00 am");
  assert.equal(time12("12:30"), "12:30 pm");
  assert.equal(time12("00:00"), "12:00 am");
  assert.equal(time12("22:15"), "10:15 pm");
});

test("today's line shows each ordering channel's own hours from Website Timing", () => {
  const hours = {
    channels: [
      { key: "collection", week: week("09:00", "22:00") },
      { key: "delivery", week: week("11:00", "21:00") },
      { key: "table", week: week("16:00", "22:00") },
    ],
  };
  const availability = {
    collection: { windows: [{ from: 540, to: 1320 }] },
    delivery: { windows: [{ from: 660, to: 1260 }] },
  };
  assert.deepEqual(todayLines(hours, availability).map((l) => `${l.label} ${l.text}`), [
    "Pickup 9:00 am – 10:00 pm",
    "Delivery 11:00 am – 9:00 pm",
  ]);
  assert.equal(todayLines(hours, { collection: { windows: [] }, delivery: { windows: null } })[0].text, "closed today");
  assert.equal(todayLines(hours, { collection: { windows: [] }, delivery: { windows: null } })[1].text, "open all day");
});

test("REGRESSION: an overnight range reads as one range, not split at midnight", () => {
  const hours = {
    today: 2,
    closedToday: "",
    channels: [
      { key: "collection", week: week("16:00", "23:50") },
      { key: "delivery", week: week("16:00", "02:00") },
    ],
  };
  // The live windows are split at midnight; the header must not be.
  const availability = { delivery: { windows: [{ from: 0, to: 120 }, { from: 960, to: 1440 }] } };
  assert.deepEqual(todayLines(hours, availability).map((l) => `${l.label} ${l.text}`), [
    "Pickup 4:00 pm – 11:50 pm",
    "Delivery 4:00 pm – 2:00 am",
  ]);
});

test("a holiday or Close for Today closes every channel today; a day off closes that channel", () => {
  const closedTue = week("11:00", "21:00");
  closedTue[2] = { day: 2, isOpen: false, openTime: "", closeTime: "" };
  const channels = [
    { key: "collection", week: week("09:00", "22:00") },
    { key: "delivery", week: closedTue },
  ];
  assert.deepEqual(todayLines({ today: 2, closedToday: "", channels }).map((l) => l.text), ["9:00 am – 10:00 pm", "closed today"]);
  assert.deepEqual(todayLines({ today: 2, closedToday: "Durga Puja", channels }).map((l) => l.text), ["closed today", "closed today"]);
});

test("extra slots from Add Hour show beside the main hours, today and in the week", () => {
  const split = week("11:00", "15:00").map((d) => ({ ...d, periods: [{ openTime: "18:00", closeTime: "23:00" }] }));
  const hours = { today: 1, closedToday: "", channels: [{ key: "collection", week: split }] };
  assert.equal(todayLines(hours)[0].text, "11:00 am – 3:00 pm, 6:00 pm – 11:00 pm");
  assert.deepEqual(weekGroups(hours)[0].days[1], { day: "Mon", text: "11:00 am – 3:00 pm, 6:00 pm – 11:00 pm" });
});

test("the footer lists every channel's week, merging channels with the same hours", () => {
  const closedSunday = week("11:00", "21:00");
  closedSunday[0] = { day: 0, isOpen: false, openTime: "", closeTime: "" };
  const groups = weekGroups({
    channels: [
      { key: "collection", week: week("09:00", "22:00") },
      { key: "delivery", week: closedSunday },
      { key: "table", week: week("09:00", "22:00") },
    ],
  });
  assert.deepEqual(groups.map((g) => g.title), ["Pickup & Table booking hours", "Delivery hours"]);
  assert.deepEqual(groups[0].days[1], { day: "Mon", text: "9:00 am – 10:00 pm" });
  assert.deepEqual(groups[1].days[0], { day: "Sun", text: "Closed" });
  assert.equal(weekGroups({ channels: [{ key: "collection", week: null }] })[0].days, null, "no hours saved: open all day");
});

test("upcoming holidays read as dates", () => {
  assert.equal(holidayText({ start: "2026-10-20", end: "2026-10-22", reason: "Durga Puja" }), "20 Oct – 22 Oct · Durga Puja");
  assert.equal(holidayText({ start: "2026-11-08", end: "2026-11-08", reason: "" }), "8 Nov");
});

test("SOURCE: the store page takes its hours from Website Timing & Holidays, not Store Properties", () => {
  const shell = SRC("components/StoreShell.jsx");
  assert.match(shell, /todayLines\(hours, availability\)/);
  assert.match(shell, /const groups = weekGroups\(hours\)/);
  assert.match(shell, /hours=\{s\.hours\}/);
});
