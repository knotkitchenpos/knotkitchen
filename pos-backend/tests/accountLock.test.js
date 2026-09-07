const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { isOpen, ALWAYS_OPEN } = require("../middlewares/accountLock");

/**
 * Locking a restaurant that has not paid.
 *
 * The allow-list is the safety-critical part. The spec requires that a locked
 * restaurant can still sign in, open Billing, see what it owes and pay it --
 * and a lock that blocks the payment routes cannot be undone by paying, which
 * is the one failure mode with no way out of it.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("CRITICAL: a locked restaurant can still reach everything it needs to pay", () => {
  // Every one of these must stay open, or the lock becomes permanent.
  const mustStayOpen = [
    "/api/auth/login",
    "/api/user/refresh",
    "/api/business-balance",
    "/api/business-balance/recharge",
    "/api/business-balance/recharge/verify",
    "/api/business-balance/transactions",
    "/api/subscription",
    "/api/subscription/plans",
    "/api/subscription/purchase",
    "/api/subscription/invoices",
    "/api/billing/12345",
    "/api/restaurant/me",
  ];
  for (const p of mustStayOpen) {
    assert.equal(isOpen(p), true, `${p} MUST remain reachable when locked`);
  }
});

test("CRITICAL: a lock never reaches the restaurant's own customers", () => {
  // Blocking these punishes diners for a dispute between KnotKitchen and the
  // restaurant -- someone mid-meal could not settle their table bill.
  for (const p of [
    "/api/qr/session/abc",
    "/api/table-qr/scan",
    "/api/storefront/checkout",
    "/api/public/store/148379/menu",
    "/api/online-orders",
    "/api/payment-link/verify",
    "/r/o_abc_def",
  ]) {
    assert.equal(isOpen(p), true, `${p} is customer-facing and must never be gated`);
  }
});

test("the POS itself IS gated", () => {
  // Otherwise the lock does nothing at all.
  for (const p of [
    "/api/orders",
    "/api/menu",
    "/api/table",
    "/api/kds",
    "/api/inventory",
    "/api/analytics",
    "/api/restaurant/settings",
    "/api/team",
  ]) {
    assert.equal(isOpen(p), false, `${p} should be gated by a lock`);
  }
});

test("a prefix match cannot be tricked by a lookalike path", () => {
  // "/api/subscriptionXYZ" must not inherit "/api/subscription"'s exemption.
  assert.equal(isOpen("/api/subscription"), true);
  assert.equal(isOpen("/api/subscription/plans"), true);
  assert.equal(isOpen("/api/subscriptions-evil"), false);
  assert.equal(isOpen("/api/business-balance-evil"), false);
  assert.equal(isOpen("/api/userland"), false);
});

test("health and readiness stay reachable, so a lock cannot look like an outage", () => {
  assert.equal(isOpen("/health"), true);
  assert.equal(isOpen("/ready"), true);
});

test("the allow-list is short enough to read", () => {
  // A default-deny list only works while a person can check it at a glance.
  assert.ok(ALWAYS_OPEN.length <= 24, `allow-list has grown to ${ALWAYS_OPEN.length} entries`);
});

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

test("SOURCE: a lock is only applied after the configured grace period", () => {
  const src = SRC("services/accountLock.js");
  assert.match(src, /graceHours/, "the window is configured, not hard-coded");
  assert.match(src, /now - dueSince > graceMs/, "dues get the full grace period");
  assert.match(src, /now > endedAt \+ graceMs/, "so does an expired subscription");
  assert.ok(!/\b24\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "24 must not be a constant here");
});

test("SOURCE: a restaurant that never subscribed is not overdue", () => {
  // Nothing to be late with. Locking it would be locking someone out for not
  // having started yet.
  const src = SRC("services/accountLock.js");
  assert.match(src, /if \(subscription\?\.currentPeriodEnd\)/);
});

test("SOURCE: paying re-evaluates the lock immediately", () => {
  // "After successful payment, the account should automatically unlock."
  const recharge = SRC("services/recharge.js");
  assert.match(recharge, /await evaluateLock\(intent\.restaurantId\)/, "awaited, so the caller is told");

  assert.match(SRC("services/subscription.js"), /fireEvaluateLock\(restaurantId\)/);
  assert.match(SRC("services/orderCharge.js"), /fireEvaluateLock\(restaurantId\)/);
});

test("SOURCE: a failure to read lock state fails OPEN", () => {
  // The cost of failing open is a few minutes of unbilled use. The cost of
  // failing closed is a restaurant unable to trade because of a database
  // hiccup.
  const src = SRC("middlewares/accountLock.js");
  const catchBlock = src.slice(src.indexOf("} catch (err) {"));
  assert.match(catchBlock, /return next\(\);/, "an error must let the request through");
});

test("SOURCE: the gate runs inside the shared auth middleware", () => {
  // One guard where every staff route already passes, rather than a line at
  // each call site that a new route can forget.
  const auth = SRC("middlewares/tokenVerification.js");
  assert.match(auth, /return enforceAccountLock\(req, res, next\);/);
});

test("SOURCE: the sweep reads candidates, not every restaurant", () => {
  const src = SRC("services/accountLock.js");
  assert.match(src, /Order\.distinct\("restaurantId"/);
  assert.match(src, /lockedAt: \{ \$ne: null \}/);
  assert.ok(
    !/Restaurant\.find\(\{\}\)/.test(src),
    "a platform-wide scan every tick for a state that changes twice a month",
  );
});

test("the refusal tells the client what to do about it", () => {
  const src = SRC("middlewares/accountLock.js");
  assert.match(src, /code: "ACCOUNT_LOCKED"/, "machine-readable, so the UI can route to Billing");
  assert.match(src, /status\(402\)/, "payment required, not forbidden -- it is temporary");
  assert.match(src, /billingPath/);
});
