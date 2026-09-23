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
    "/api/user/store/login",
    "/api/user/refresh",
    "/api/business-balance",
    "/api/business-balance/recharge",
    "/api/business-balance/recharge/verify",
    "/api/business-balance/transactions",
    "/api/subscription",
    "/api/subscription/plans",
    "/api/subscription/purchase",
    "/api/subscription/invoices",
    "/api/restaurant/me",
  ];
  for (const p of mustStayOpen) {
    assert.equal(isOpen(p), true, `${p} MUST remain reachable when locked`);
  }
});

test("CRITICAL: a lock never reaches the restaurant's own customers", async () => {
  // Blocking diners punishes them for a dispute between KnotKitchen and the
  // restaurant. They never sign in, and the gate only looks at signed-in staff.
  const { enforceAccountLock } = require("../middlewares/accountLock");
  let passed = false;
  await enforceAccountLock({ baseUrl: "/api/qr", path: "/session/abc" }, {}, () => (passed = true));
  assert.equal(passed, true);
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
    // Staff screens under prefixes that also carry customer routes.
    "/api/online-orders",
    "/api/customer",
    "/api/payment-link",
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

test("REGRESSION: the allow-list is matched on the full path, not the router-relative one", async () => {
  // The gate runs inside each router, where GET /api/business-balance has
  // req.path "/". Matching that alone kept Billing locked with everything else.
  const { BusinessBalance } = require("../models/businessBalanceModel");
  const { enforceAccountLock } = require("../middlewares/accountLock");
  const original = BusinessBalance.findOne;
  BusinessBalance.findOne = () => ({ select: () => ({ lean: async () => ({ lockedAt: new Date() }) }) });
  const call = async (baseUrl, reqPath) => {
    let status = null;
    let passed = false;
    await enforceAccountLock(
      { user: { restaurantId: "r1" }, baseUrl, path: reqPath },
      { status: (s) => ((status = s), { json: () => {} }) },
      () => (passed = true),
    );
    return { status, passed };
  };
  try {
    assert.deepEqual(await call("/api/business-balance", "/"), { status: null, passed: true });
    assert.deepEqual(await call("/api/subscription", "/plans"), { status: null, passed: true });
    assert.deepEqual(await call("/api/order", "/"), { status: 402, passed: false });
    assert.deepEqual(await call("/api/online-orders", "/abc/status"), { status: 402, passed: false });
  } finally {
    BusinessBalance.findOne = original;
  }
});

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/** Run `fn` against accountLock with its reads replaced. Paid up by default. */
const LIVE_PLAN = { currentPeriodEnd: new Date("2099-01-01T00:00:00Z") };
const withAssess = async ({ lastEntry = null, dues = { count: 0 }, subscription = LIVE_PLAN, graceHours = 24, override = null }, fn) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "./pricing") return { getPlatformConfig: async () => ({ graceHours }), getOverride: async () => override };
    if (r === "./orderCharge") return { outstandingDues: async () => dues };
    if (r === "../models/platformSubscriptionModel") {
      return { PlatformSubscription: { findOne: () => ({ lean: async () => subscription }) } };
    }
    if (r === "../models/businessBalanceModel") {
      return {
        BusinessBalance: {},
        LedgerEntry: { findOne: () => ({ sort: () => ({ select: () => ({ lean: async () => lastEntry }) }) }) },
      };
    }
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../services/accountLock")];
  try {
    return await fn(require("../services/accountLock"));
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve("../services/accountLock")];
  }
};

test("an empty Business Balance locks the POS 24 hours after it ran out", async () => {
  const ranOut = new Date("2026-09-14T10:00:00Z");
  await withAssess({ lastEntry: { createdAt: ranOut, balanceAfterPaise: 0 } }, async (svc) => {
    const inBuffer = await svc.assessAccount("r1", new Date("2026-09-15T09:00:00Z"));
    assert.equal(inBuffer.shouldLock, false, "23 hours in: still usable");
    assert.equal(inBuffer.locksAt.toISOString(), "2026-09-15T10:00:00.000Z", "and the POS is told when it locks");
    assert.match(inBuffer.lockWarning, /run out/);

    const after = await svc.assessAccount("r1", new Date("2026-09-15T10:01:00Z"));
    assert.equal(after.shouldLock, true);
    assert.match(after.reasons.join(" "), /Business Balance ran out/);
  });
});

test("a balance with money, or one that never had any, is not a reason to lock", async () => {
  await withAssess({ lastEntry: { createdAt: new Date("2026-01-01"), balanceAfterPaise: 5000 } }, async (svc) => {
    assert.equal((await svc.assessAccount("r1", new Date("2026-09-15"))).shouldLock, false);
  });
  await withAssess({ lastEntry: null }, async (svc) => {
    const res = await svc.assessAccount("r1", new Date("2026-09-15"));
    assert.equal(res.shouldLock, false);
    assert.equal(res.locksAt, null);
  });
});

test("a demo store (CSD) never locks, whatever it owes", async () => {
  const subscription = { currentPeriodEnd: new Date("2026-09-08T18:30:00Z") }; // expired a week ago
  const ranOut = { createdAt: new Date("2026-09-10T00:00:00Z"), balanceAfterPaise: 0 };
  const dues = { count: 2, totalPaise: 1800, oldestAt: new Date("2026-09-10T00:00:00Z") };
  const on = new Date("2026-09-15T12:00:00Z");

  await withAssess({ subscription, lastEntry: ranOut, dues }, async (svc) => {
    assert.equal((await svc.assessAccount("r1", on)).shouldLock, true, "a normal store locks");
  });
  await withAssess({ subscription, lastEntry: ranOut, dues, override: { billingExempt: true } }, async (svc) => {
    const res = await svc.assessAccount("r1", on);
    assert.equal(res.shouldLock, false);
    assert.equal(res.locksAt, null);
    assert.equal(res.lockWarning, "", "and no countdown banner");
  });
});

test("SOURCE: a demo store is never charged", () => {
  const pricing = SRC("services/pricing.js");
  assert.equal((pricing.match(/enabled: Boolean\(charge\.enabled\) && started && !ovr\?\.billingExempt,/g) || []).length, 2,
    "neither the per-order nor the per-e-bill charge");
  const sub = SRC("services/subscription.js");
  const q = sub.slice(sub.indexOf("const quote = async"), sub.indexOf("const purchasePlan"));
  assert.match(q, /billingExempt\) \{\s*throw new SubscriptionError\(/, "and a subscription cannot be bought");
});

test("SOURCE: a lock is only applied after the configured grace period", () => {
  const src = SRC("services/accountLock.js");
  assert.match(src, /graceHours/, "the window is configured, not hard-coded");
  assert.match(src, /now - dueSince > graceMs/, "dues get the full grace period");
  assert.match(src, /now > endedAt \+ graceMs/, "so does an expired subscription");
  assert.ok(!/\b24\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "24 must not be a constant here");
});

test("SOURCE: a store that never bought a plan starts locked, with Billing still open", () => {
  // "When a store is created, everything should be locked except Billing and
  // Subscription." No grace: it has nothing running that could be cut off.
  const src = SRC("services/accountLock.js");
  assert.match(src, /if \(!subscription\?\.currentPeriodEnd\) \{\s*reasons\.push\("No plan is active yet\."\)/);
  // Demo stores are decided before this rule is reached.
  assert.ok(src.indexOf("override?.billingExempt") < src.indexOf("!subscription?.currentPeriodEnd"));
  // Whoever creates a new store's balance row assesses it in the same breath,
  // so no first request (the gate, the balance poll, a top-up) leaves it open.
  const ledger = SRC("services/ledger.js");
  const getBalance = ledger.slice(ledger.indexOf("const getBalance"), ledger.indexOf("const assertAmount"));
  assert.match(getBalance, /upsert: true[\s\S]*evaluateLock\(restaurantId\)/);
  assert.match(SRC("middlewares/accountLock.js"), /if \(!balance\) balance = await require\("\.\.\/services\/ledger"\)\.getBalance\(restaurantId\)/);
  // The balance poll keeps the stored lock current instead of only reading it.
  assert.match(SRC("routes/businessBalanceRoute.js"), /evaluateLock\(restaurantId\), outstandingDues\(restaurantId\)/);
  // A staff member confirms a plan purchase with the Store PIN.
  assert.ok(require("../middlewares/accountLock").isOpen("/api/restaurant/verify-pin"));
  const { isOpen } = require("../middlewares/accountLock");
  for (const p of ["/api/subscription/plans", "/api/business-balance", "/api/user/refresh"]) assert.ok(isOpen(p), p);
  for (const p of ["/api/order", "/api/menu", "/api/table"]) assert.ok(!isOpen(p), p);
});

test("a new store with no plan is locked at once; a demo store is not", async () => {
  await withAssess({ subscription: null }, async (svc) => {
    const res = await svc.assessAccount("r1", new Date("2026-09-21"));
    assert.equal(res.shouldLock, true, "no grace: nothing is running yet");
    assert.match(res.reasons.join(" "), /No plan is active yet/);
  });
  await withAssess({ subscription: null, override: { billingExempt: true } }, async (svc) => {
    assert.equal((await svc.assessAccount("r1", new Date("2026-09-21"))).shouldLock, false);
  });
});

test("SOURCE: paying re-evaluates the lock immediately", () => {
  // "After successful payment, the account should automatically unlock."
  const recharge = SRC("services/recharge.js");
  assert.match(recharge, /await evaluateLock\(intent\.restaurantId\)/, "awaited, so the caller is told");

  // Awaited in both branches, so Billing's refresh right after sees it unlocked.
  const sub = SRC("services/subscription.js");
  const purchase = sub.slice(sub.indexOf("const purchasePlan"), sub.indexOf("const lapseCommitments"));
  assert.equal((purchase.match(/await settleLock\(restaurantId\)/g) || []).length, 2);
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
