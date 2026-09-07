const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { readPlans, present } = require("../controllers/csdBillingConfigController");
const money = require("../services/money");

/**
 * The admin panel's pricing API.
 *
 * "The most important requirement is that all financial settings must be
 * controlled by the KnotKitchen Admin Panel" -- so this is the only writer,
 * and the tests below are as much about what it REFUSES as what it accepts.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("the four plans from the spec go in and come back out", () => {
  const errors = {};
  const plans = readPlans(
    [
      { code: "essential", name: "Essential", price: 399 },
      { code: "connect", name: "Connect", price: 599 },
      { code: "growth", name: "Growth", price: 1299 },
      { code: "scale", name: "Scale", price: 1699 },
    ],
    errors,
  );

  assert.deepEqual(errors, {});
  assert.deepEqual(
    plans.map((p) => p.standardPricePaise),
    [399, 599, 1299, 1699].map(money.toPaise),
  );

  // And back out as rupees, because that is what the admin typed.
  const shown = present({ plans, gst: {}, websiteOrderCharge: {} });
  assert.deepEqual(shown.plans.map((p) => p.price), [399, 599, 1299, 1699]);
  assert.equal(shown.plans[2].priceLabel, "₹1,299.00");
});

test("REGRESSION: rupees in, paise stored -- never the other way round", () => {
  // A price stored as rupees would be 100x under-charged by everything
  // downstream, which all works in paise.
  const errors = {};
  const [plan] = readPlans([{ code: "growth", name: "Growth", price: 1299 }], errors);
  assert.equal(plan.standardPricePaise, 129900);
  assert.notEqual(plan.standardPricePaise, 1299);
});

test("a bad plan list is refused whole, not part-applied", () => {
  // Half a price list applying is worse than none of it, because the half
  // that applied is live.
  const errors = {};
  readPlans(
    [
      { code: "a", name: "A", price: -5 },
      { code: "a", name: "duplicate", price: 1 },
      { code: "", name: "nameless", price: 1 },
    ],
    errors,
  );
  assert.match(errors["plans.0.price"], /zero or more/);
  assert.match(errors["plans.1.code"], /Duplicate/);
  assert.match(errors["plans.2.code"], /needs a code/);

  const src = SRC("controllers/csdBillingConfigController.js");
  assert.match(src, /if \(Object\.keys\(fieldErrors\)\.length\)/);
  const rejectAt = src.indexOf("Please correct the highlighted fields");
  const saveAt = src.indexOf("await config.save()");
  assert.ok(rejectAt !== -1 && saveAt > rejectAt, "nothing is saved before validation passes");
});

test("an offer window without a price is refused", () => {
  // It would silently never apply, which reads to an admin as a broken
  // feature rather than as a mistake they made.
  const errors = {};
  readPlans([{ code: "g", name: "G", price: 1299, offer: { startsAt: "2026-03-01" } }], errors);
  assert.match(errors["plans.0.offer.price"], /Set an offer price/);
});

test("an offer that ends before it starts is refused", () => {
  const errors = {};
  readPlans(
    [{ code: "g", name: "G", price: 1299, offer: { price: 999, startsAt: "2026-03-31", endsAt: "2026-03-01" } }],
    errors,
  );
  assert.match(errors["plans.0.offer.endsAt"], /ends before it starts/);
});

test("an offer inside its window survives the round trip", () => {
  const errors = {};
  const plans = readPlans(
    [{ code: "growth", name: "Growth", price: 1299, offer: { price: 999, startsAt: "2026-03-01", endsAt: "2026-03-31" } }],
    errors,
  );
  assert.deepEqual(errors, {});
  assert.equal(plans[0].offer.pricePaise, money.toPaise(999));

  const { offerActiveAt } = require("../services/pricing");
  assert.equal(offerActiveAt(plans[0].offer, new Date("2026-03-15")), true);
  assert.equal(offerActiveAt(plans[0].offer, new Date("2026-04-15")), false);
});

test("SOURCE: GST cannot be switched on without a start date", () => {
  // Registered with no date taxes nothing, which looks broken rather than
  // deliberate.
  const src = SRC("controllers/csdBillingConfigController.js");
  assert.match(src, /if \(g\.registered && !asDate\(g\.effectiveFrom\)\)/);
  assert.match(src, /if \(c\.enabled && !asDate\(c\.effectiveFrom\)\)/, "same for the order charge");
});

test("SOURCE: changing a price is admin-only and audited", () => {
  const route = SRC("routes/csdRoute.js");
  assert.match(route, /router\.patch\("\/billing\/config", requireCsdAdmin/);
  // Reading is not restricted -- support staff need to see what a store pays.
  assert.match(route, /router\.get\("\/billing\/config", getBillingConfig\)/);

  const ctrl = SRC("controllers/csdBillingConfigController.js");
  assert.match(ctrl, /action: "BILLING\.CONFIG\.UPDATE"/);
  assert.match(ctrl, /previousValue: before/, "a price change must be accountable afterwards");
});

test("SOURCE: viewing an account does not lock it", () => {
  // An admin opening a restaurant's page should not be the thing that locks
  // it out of its POS.
  const ctrl = SRC("controllers/csdBillingConfigController.js");
  assert.match(ctrl, /assessAccount/);
  assert.ok(!/evaluateLock/.test(ctrl), "assess reads; evaluate writes");
});

test("negotiated per-plan prices go through the existing charges endpoint", () => {
  // Not a second override collection -- CsdStoreCharges already had the audit
  // trail and the dialog.
  const ctrl = SRC("controllers/csdRestaurantController.js");
  assert.match(ctrl, /if \(b\.planPrices !== undefined\)/);
  assert.match(ctrl, /That plan is listed twice/);
  // Sent whole so an entry can be REMOVED; a merge would make a special price
  // permanent.
  assert.match(ctrl, /patch\.planPrices = b\.planPrices\.map/);

  const CsdStoreCharges = require("../models/csdStoreChargesModel");
  assert.ok(CsdStoreCharges.schema.path("planPrices"));
});
