const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { prefsOf, crossedBelow, DEFAULTS } = require("../services/partnerAlerts");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("alert settings: defaults on, amounts kept to whole sane rupees", () => {
  assert.deepEqual(prefsOf({}), { ...DEFAULTS });
  const p = prefsOf({ locked: false, walletLowBelow: "2500.4", largeRefundAbove: -5, stockOut: 0 });
  assert.equal(p.locked, false);
  assert.equal(p.walletLowBelow, 2500);
  assert.equal(p.largeRefundAbove, 1, "never zero or negative");
  assert.equal(p.stockOut, false);
  assert.equal(prefsOf({ walletLowBelow: "abc" }).walletLowBelow, DEFAULTS.walletLowBelow);
});

test("wallet low fires once, on the debit that crosses the line, not on every debit below it", () => {
  // ₹1,000 line. ₹1,050 -> ₹950: crossed.
  assert.equal(crossedBelow(95000, 10000, 1000), true);
  // Already below: ₹950 -> ₹900.
  assert.equal(crossedBelow(90000, 5000, 1000), false);
  // Exactly at the line before, below after.
  assert.equal(crossedBelow(99999, 1, 1000), true);
  // Still above.
  assert.equal(crossedBelow(100000, 500, 1000), false);
});

test("wiring: each event reaches the owner's phone without holding up what caused it", () => {
  assert.match(src("services/accountLock.js"), /require\("\.\/partnerAlerts"\)\.storeLocked\(restaurantId, reason\);/);
  assert.match(src("services/ledger.js"), /if \(!result\.duplicate && result\.entry\) \{\n\s+require\("\.\/partnerAlerts"\)\.walletMoved/);
  assert.equal((src("services/refunds.js").match(/partnerAlerts"\)\.refundGiven/g) || []).length, 2, "gateway and counter refunds");
  assert.match(src("services/stockProducts.js"), /require\("\.\/partnerAlerts"\)\.stockOut\(restaurantId, names\);/);
  const svc = src("services/partnerAlerts.js");
  assert.match(svc, /setImmediate\(\(\) => \{/, "runs after the caller has moved on");
  assert.match(svc, /\.catch\(\(err\) => console\.warn/, "and never throws into it");
  const routes = src("routes/partnerRoute.js");
  assert.match(routes, /if \(!csdPush\.isValidSubscription\(sub\)\)/, "only the browsers' own push services");
});
