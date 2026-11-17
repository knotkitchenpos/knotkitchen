const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { readBody, activeFilter } = require("../controllers/announcementController");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("an announcement needs a title; links are https only; store IDs are 6 digits; dates make sense", () => {
  assert.throws(() => readBody({ title: "  " }), /Enter a title/);
  assert.throws(() => readBody({ title: "x", linkUrl: "http://example.com" }), /https/);
  assert.throws(() => readBody({ title: "x", storeIds: "12345" }), /6 digits/);
  assert.throws(() => readBody({ title: "x", startsAt: "2026-11-20", endsAt: "2026-11-19" }), /after the start/);
  const a = readBody({ title: " Downtime tonight ", level: "nope", storeIds: "893146, 586720 893146", linkUrl: "https://knotkitchen.com/x", linkLabel: "Read more" });
  assert.equal(a.title, "Downtime tonight");
  assert.equal(a.level, "info", "an unknown level falls back to info");
  assert.deepEqual(a.storeIds, ["893146", "586720"], "duplicates go");
  assert.equal(a.linkLabel, "Read more");
  assert.equal(readBody({ title: "x", linkLabel: "No link" }).linkLabel, "", "a label without a link is dropped");
});

test("a store sees what started, has not ended, and is for everyone or for it", () => {
  const now = new Date("2026-11-17T10:00:00Z");
  const f = activeFilter("893146", now);
  assert.deepEqual(f.startsAt, { $lte: now });
  assert.deepEqual(f.$and[0], { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] });
  assert.deepEqual(f.$and[1], { $or: [{ storeIds: { $size: 0 } }, { storeIds: "893146" }] });
});

test("wiring: admin-only in CSD, open to a locked POS, and every open POS is told at once", () => {
  const csd = src("routes/csdRoute.js");
  assert.match(csd, /router\.post\("\/announcements", requireCsdAdmin, announcements\.create\);/);
  assert.match(csd, /router\.post\("\/announcements\/:id\/end", requireCsdAdmin, announcements\.end\);/);
  assert.match(src("middlewares/accountLock.js"), /"\/api\/announcements",/);
  assert.match(src("app.js"), /app\.use\("\/api\/announcements", require\("\.\/routes\/announcementRoute"\)\);/);
  assert.match(src("controllers/announcementController.js"), /emitEvent\("announcement:changed", \{\}\)/);
});
