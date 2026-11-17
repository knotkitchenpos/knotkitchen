const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { settingsOf, pointsFor, isExpired } = require("../services/loyalty");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

/** Owner, 2026-11-17: loyalty points -- earn everywhere, redeem at the counter. */
test("settings default safely; whole points per ₹100 paid; never negative", () => {
  assert.deepEqual(settingsOf({}), { enabled: false, earnPer100: 1, pointValue: 1, minRedeem: 50, expiryMonths: 12 });
  const s = settingsOf({ loyalty: { enabled: true, earnPer100: 10, pointValue: 0.5, minRedeem: 10, expiryMonths: 0 } });
  assert.equal(pointsFor(349, s), 34);
  assert.equal(pointsFor(99, settingsOf({})), 0);
  assert.equal(pointsFor(-50, s), 0);
});

test("a balance expires after the store's months without activity (0 = never)", () => {
  const s = settingsOf({ loyalty: { expiryMonths: 12 } });
  const c = { loyaltyPoints: 40, loyaltyLastAt: new Date("2025-11-01T00:00:00Z") };
  assert.equal(isExpired(c, s, new Date("2026-10-31T00:00:00Z")), false);
  assert.equal(isExpired(c, s, new Date("2026-11-02T00:00:00Z")), true);
  assert.equal(isExpired(c, settingsOf({ loyalty: { expiryMonths: 0 } }), new Date("2030-01-01")), false);
  assert.equal(isExpired({ loyaltyPoints: 0, loyaltyLastAt: new Date("2020-01-01") }, s, new Date()), false, "nothing to expire");
});

test("wiring: checked before the PIN rule, deducted before save and given back if it fails, earned at every paid moment, reversed on cancel", () => {
  const o = src("controllers/orderController.js");
  assert.ok(o.indexOf("loyalty.checkRedeem({") < o.indexOf("if (sanitizedBills.discount - (loyaltyUse?.value || 0) > 0.009 && !offlineSync) {"));
  assert.match(o, /Use the same phone number on the bill as for the points\./);
  assert.ok(o.indexOf('require("../services/loyalty").redeem({') < o.indexOf("await order.save();"));
  assert.match(o, /\} catch \(err\) \{\n\s+await undoLoyalty\(\);\n\s+throw err;/);
  assert.match(o, /if \(cancelling\) await require\("\.\.\/services\/loyalty"\)\.reverseForOrder\(order\);/);
  for (const [f, re] of [
    ["controllers/orderController.js", /if \(isPaidAtTill\) require\("\.\.\/services\/loyalty"\)\.earnLater\(\{ orderId: order\._id \}\);/],
    ["controllers/orderController.js", /if \(settledTransition\) require\("\.\.\/services\/loyalty"\)\.earnLater/],
    ["controllers/tableSessionController.js", /if \(paid\) require\("\.\.\/services\/loyalty"\)\.earnLater\(\{ tableSessionId: session\._id \}\);/],
    ["services/autoReadyService.js", /require\("\.\/loyalty"\)\.earnLater\(\{ orderId: order\._id \}\);/],
    ["services/paymentLinkSettlement.js", /if \(updatedOrder\) require\("\.\/loyalty"\)\.earnLater/],
  ]) assert.match(src(f), re, f);
  const l = src("services/loyalty.js");
  assert.match(l, /\{ _id: customer\._id, loyaltyPoints: \{ \$gte: points \} \}/, "never spends more than the balance");
  assert.match(l, /if \(!o \|\| o\.tableSessionId \|\| \/cancel\/i\.test/, "a table's orders earn once, on the table bill");
  assert.match(src("models/loyaltyEntryModel.js"), /key: \{ type: String, required: true, unique: true \}/, "each change once");
  assert.match(src("routes/restaurantRoute.js"), /router\.route\("\/loyalty"\)\.get\(isVerifiedUser, loyaltySettings\.getSettings\)\.put\(isVerifiedUser, requireTypedPin\(\), loyaltySettings\.saveSettings\);/);
});

/** Owner, 2026-11-17 (#34): points on table bills, at settlement. */
test("table bills: points checked and deducted without a PIN, applied through the one discount path, given back when undone", () => {
  const c = src("controllers/tableSessionController.js");
  const r = src("routes/tableSessionRoute.js");
  assert.match(r, /router\.route\("\/:id\/loyalty"\)\.post\(isVerifiedUser, useLoyaltyPoints\);/, "no PIN: the customer's own points");
  assert.match(c, /if \(session\.customerPhone && session\.customerPhone !== phone\)/, "the table's own customer");
  assert.match(c, /if \(use\.value >= sub\) throw createHttpError\(400, "Those points would cover the whole bill/);
  assert.ok(c.indexOf("await loyalty.redeem({ restaurantId: session.restaurantId") < c.indexOf("req.loyaltyDiscount = true;"), "deducted before it is applied");
  assert.match(c, /return setDiscount\(req, res, async \(err\) => \{\n\s+if \(err\) \{/, "given back if applying fails");
  assert.match(c, /if \(!req\.loyaltyDiscount && \(session\.loyaltyRedeems \|\| \[\]\)\.length\) \{\n\s+await require\("\.\.\/services\/loyalty"\)\.returnForSession\(session\);/, "a discount set by hand gives them back");
  assert.match(c, /addTimeline\(session, "SESSION_CLOSED", "Session closed without payment", "POS", req\.user\?\._id\);\n\s+await require\("\.\.\/services\/loyalty"\)\.returnForSession\(session\);/, "closed unpaid gives them back");
  assert.match(c, /target\.loyaltyRedeems = \[\.\.\.\(target\.loyaltyRedeems \|\| \[\]\), \.\.\.source\.loyaltyRedeems\];/, "a merge carries them with the discount");
  assert.match(src("services/loyalty.js"), /key: `return:\$\{u\.key\}`/, "each use given back once");
});
