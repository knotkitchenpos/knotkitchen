const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const s = require("../services/partnerDailySummary");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("the summary: yesterday's totals, the top store with its change, and what needs attention", () => {
  const values = s.summaryValues({
    name: "Ravi",
    day: "2026-11-12",
    dash: { totals: { sales: 12345.6, orders: 57 }, stores: [{ name: "Spice Route", sales: 8000, salesChange: 12 }, { name: "Burger House", sales: 4345.6, salesChange: null }] },
    cards: [
      { name: "Spice Route", linkStatus: "ok", wallet: { paise: 950100, label: "₹9,501.00" } },
      { name: "Burger House", linkStatus: "ok", locked: true, wallet: { paise: 0, label: "₹0.00" } },
      { name: "Taco Stop", linkStatus: "relink", wallet: { paise: 0 } },
    ],
  });
  assert.equal(values.length, s.VARIABLES, "exactly the template's variables");
  assert.deepEqual(values, ["Ravi", "Thu, 12 Nov", "₹12,346", "57", "2 stores", "Spice Route ₹8,000 (+12%)", "Burger House is locked, Taco Stop needs linking again"]);
  assert.ok(values.every((v) => !/\n|\t| {5}/.test(v)), "WhatsApp refuses new lines, tabs and long spaces in a variable");
  assert.match(s.preview(values), /^Hi Ravi, your KnotKitchen summary for Thu, 12 Nov: sales ₹12,346 from 57 orders across 2 stores\./);
  const quiet = s.summaryValues({ name: "", day: "2026-11-12", dash: { totals: {}, stores: [] }, cards: [{ name: "A", linkStatus: "ok", wallet: { paise: 100000 } }] });
  assert.deepEqual(quiet.slice(5), ["no sales yet", "nothing"]);
  assert.ok(quiet.every((v) => v.length > 0), "an empty variable is refused by WhatsApp");
});

test("settings: off by default, the account's phone, 9 AM; a bad hour falls back", () => {
  assert.deepEqual(
    { ...s.settingsOf({ phone: "9000000001" }), lastSentAt: null },
    { enabled: false, phone: "9000000001", hour: 9, lastSentDay: "", lastSentAt: null, lastError: "" },
  );
  assert.equal(s.settingsOf({ summary: { hour: 3 } }).hour, 9);
  assert.equal(s.settingsOf({ summary: { hour: 21, phone: "+91 98765 43210" } }).phone, "9876543210");
  assert.equal(s.yesterdayIST(new Date("2026-11-13T02:00:00Z")), "2026-11-12");
  assert.equal(s.yesterdayIST(new Date("2026-11-12T19:00:00Z")), "2026-11-12", "00:30 IST on the 13th: yesterday is the 12th");
});

test("wiring: one send per owner per day, claimed first; only the approved template; scheduler started", () => {
  const svc = src("services/partnerDailySummary.js");
  assert.match(svc, /updateOne\(\{ _id: p\._id, "summary\.lastSentDay": \{ \$ne: day \} \}, \{ \$set: \{ "summary\.lastSentDay": day \} \}\)/);
  assert.match(svc, /if \(!status\.ready\) throw/);
  assert.match(src("app.js"), /require\("\.\/services\/partnerDailySummary"\)\.startDailySummaryScheduler\(\);/);
  const routes = src("routes/partnerRoute.js");
  // Only a summary that actually went out counts toward the 10 minutes.
  assert.ok(routes.indexOf("const r = await dailySummary.sendSummary(req.partner);") < routes.indexOf("summarySentAt.set(key, Date.now());"));
});
