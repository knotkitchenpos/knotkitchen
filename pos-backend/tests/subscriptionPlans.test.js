const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { DEFAULT_PLANS } = require("../models/platformBillingModel");
const money = require("../services/money");

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const FE = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", ...p), "utf8");

/**
 * The four plans, and who is allowed to change them.
 *
 * The catalogue lived only in the database and nothing ever seeded it, so a
 * fresh install showed "No plans are available at the moment" and a restaurant
 * had no way to subscribe at all.
 */

test("REGRESSION: all four plans ship, at the agreed prices", () => {
  assert.deepEqual(
    DEFAULT_PLANS.map((p) => [p.name, money.toRupees(p.standardPricePaise)]),
    [
      ["Essential", 399],
      ["Connect", 599],
      ["Growth", 1299],
      ["Scale", 1699],
    ],
  );
  // Integer paise, never floats -- see services/money.js.
  for (const p of DEFAULT_PLANS) assert.ok(Number.isInteger(p.standardPricePaise));
});

test("Essential and Connect ship locked, and locked is not hidden", () => {
  const byCode = Object.fromEntries(DEFAULT_PLANS.map((p) => [p.code, p]));
  assert.equal(byCode.ESSENTIAL.isAvailable, false);
  assert.equal(byCode.CONNECT.isAvailable, false);
  assert.equal(byCode.GROWTH.isAvailable, true);
  assert.equal(byCode.SCALE.isAvailable, true);

  // isActive would remove them from the catalogue entirely. They must stay
  // visible so a restaurant can see the ladder it is on.
  for (const p of DEFAULT_PLANS) assert.notEqual(p.isActive, false);
});

test("REGRESSION: an empty catalogue is backfilled, an edited one is not", () => {
  // The bug was a config row created before the catalogue existed: it had
  // plans: [] forever, and the POS could only say "no plans available".
  const src = SRC("services", "pricing.js");
  assert.match(src, /if \(!existing\.plans \|\| existing\.plans\.length === 0\) \{/);
  assert.match(src, /existing\.plans = DEFAULT_PLANS\.map\(\(p\) => \(\{ \.\.\.p \}\)\);/);
  // Only when EMPTY -- an admin's own pricing must never be overwritten.
  assert.ok(
    !/existing\.plans = DEFAULT_PLANS[\s\S]{0,40}\n\s*await existing\.save\(\);\s*\n\s*return existing/.test(
      src.replace(/if \(!existing\.plans[^\n]*\n/, ""),
    ),
    "the backfill must stay behind the empty check",
  );
});

test("the POS lists locked plans but the server still refuses to sell them", () => {
  // Listing and selling are different questions. The route asks for the full
  // catalogue; quote() is what actually enforces the lock.
  assert.match(SRC("routes", "subscriptionRoute.js"), /includeUnavailable: true,/);
  assert.match(
    SRC("services", "subscription.js"),
    /if \(!priced\.plan\.isAvailable && subscription\.planCode !== planCode\) \{/,
    "an unavailable plan cannot be bought, whatever the UI shows",
  );
});

test("REGRESSION: changing plan needs the Owner, or a Staff PIN", () => {
  // The purchase endpoint took any authenticated user, so a staff member
  // could move the restaurant onto a more expensive plan unchallenged.
  const route = SRC("routes", "subscriptionRoute.js");
  assert.match(
    route,
    /router\.post\("\/purchase", isVerifiedUser, requireProtectedAction,/,
    "Owner passes; Staff must present the Store Properties PIN",
  );

  // The POS prompts for it rather than letting the request fail.
  const page = FE("src", "pages", "Billing.jsx");
  assert.match(page, /checkActionAuthorization\(user, \{ isOwnerOnly: false \}\)/);
  assert.match(page, /auth\.status === "REQUIRE_PIN"/);
  assert.match(page, /<SecurityPinModal/);
});

test("an upgrade is charged on the difference, not the full price again", () => {
  const src = SRC("services", "subscription.js");
  const q = src.slice(src.indexOf("const quote = async"), src.indexOf("const purchasePlan"));
  assert.match(q, /const isUpgrade = active && subscription\.planCode && subscription\.planCode !== planCode;/);
  assert.match(q, /\? upgradeCharge\(\{/, "an upgrade prices the remaining days");
  assert.match(q, /: \{ amountPaise: priced\.pricePaise, remainingDays: null, basis: "FULL" \}/);
  // An upgrade keeps the period it is already in; only a renewal moves it.
  assert.match(q, /\? \{ start: subscription\.currentPeriodStart, end: subscription\.currentPeriodEnd/);
});

test("the POS shows what the upgrade will actually cost before committing", () => {
  const page = FE("src", "pages", "Billing.jsx");
  assert.match(page, /getSubscriptionQuote\(p\.code\)/);
  assert.match(page, /You pay \{money\(upgradeQuotes\[plan\.code\]\)\} now/);
  assert.match(page, /plan\.isAvailable === false && !current/, "locked plans are marked");
});

test("REGRESSION: no downgrade, while a plan is active or after it ends", () => {
  // quote() refuses any cheaper plan once the restaurant has had a plan;
  // purchasePlan always goes through quote().
  const src = require("node:fs").readFileSync(require.resolve("../services/subscription"), "utf8");
  const q = src.slice(src.indexOf("const quote = async"), src.indexOf("const purchasePlan"));
  assert.match(q, /if \(priced\.pricePaise < currentPricePaise\)/);
  assert.match(q, /throw new SubscriptionError\([\s\S]*?lower plan[\s\S]*?409/);
  // Not gated on the period still running.
  assert.match(q, /if \(subscription\.planCode && subscription\.planCode !== planCode\) \{\s*const current = await resolvePlanPrice/);
  assert.ok(!/while \$\{subscription\.planName[^`]*is active/.test(q), "the refusal must not suggest it lifts when the plan ends");
  const buy = src.slice(src.indexOf("const purchasePlan"), src.indexOf("const statusFor"));
  assert.match(buy, /await quote\(\{ restaurantId, planCode, on \}\)/);

  const ui = require("node:fs").readFileSync(require.resolve("../../pos-frontend/src/pages/Billing.jsx"), "utf8");
  assert.match(ui, /disabled=\{buy\.isPending \|\| current \|\| locked \|\| lower\}/);
});
