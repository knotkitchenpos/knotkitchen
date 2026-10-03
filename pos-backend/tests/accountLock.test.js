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
    "/api/subscription/quote",
    "/api/subscription/addons",
    "/api/subscription/addons/WEBSITE",
    "/api/subscription/tablets",
    "/api/subscription/printers",
    "/api/subscription/renew",
    "/api/subscription/invoices",
    "/api/restaurant/me",
  ];
  for (const p of mustStayOpen) {
    assert.equal(isOpen(p), true, `${p} MUST remain reachable when locked`);
  }
});

test("CRITICAL: the staff gate never touches a diner's request", async () => {
  // Diners never sign in, and this gate only looks at signed-in staff. The
  // customer side of a lock (website down, no new QR orders) is applied by
  // the storefront resolver and the QR routes, which leave a seated party
  // able to pay.
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
  assert.equal(isOpen("/api/subscription/addons"), true);
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
    assert.deepEqual(await call("/api/subscription", "/addons"), { status: null, passed: true });
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
const withAssess = async ({ lastEntry = null, dues = { count: 0 }, subscription = LIVE_PLAN, graceHours = 24, override = null, closed = false }, fn) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/storeModel") return { exists: async (f) => (closed && f.status === "closed" ? { _id: "s1" } : null) };
    if (r === "../models/restaurantModel") return { findById: () => ({ select: () => ({ lean: async () => ({ storeId: "148379" }) }) }) };
    if (r === "./pricing") return { getPlatformConfig: async () => ({ graceHours, firstRechargeMinPaise: 250000 }), getOverride: async () => override };
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
  // Nothing can be bought or quoted...
  for (const fn of ["const quote = async", "const addAddon = async", "const preparePrinterPayment = async"]) {
    const body = sub.slice(sub.indexOf(fn), sub.indexOf("\n};", sub.indexOf(fn)));
    assert.match(body, /if \(ctx\.exempt\) throw new SubscriptionError\(DEMO_STORE, 409\);/, fn);
  }
  // ...nothing activates or renews. (Behaviour: tests/subscriptionFlow.test.js.)
  assert.match(sub, /if \(exempt \|\| subscription\.activatedAt \|\| subscription\.status === "CANCELLED"\) return null;/);
  assert.match(sub, /if \(override\?\.billingExempt\) return \{ renewed: false \};/);
  const own = sub.slice(sub.indexOf("const renewAddons"), sub.indexOf("\n};", sub.indexOf("const renewAddons")));
  assert.match(own, /if \(override\?\.billingExempt\) return result;/, "nor renews a yearly add-on");
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
  assert.match(src, /if \(!subscription\?\.currentPeriodEnd\) \{\s*reasons\.push\(\s*`No plan is active yet\. Recharge at least \$\{formatINR\(Number\(config\.firstRechargeMinPaise\) \|\| 0\)\} to start\. The POS plan starts automatically\.`/);
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
  // A staff member confirms a purchase with the Store PIN.
  assert.ok(require("../middlewares/accountLock").isOpen("/api/restaurant/verify-pin"));
  const { isOpen } = require("../middlewares/accountLock");
  for (const p of ["/api/subscription/addons", "/api/business-balance", "/api/user/refresh"]) assert.ok(isOpen(p), p);
  for (const p of ["/api/order", "/api/menu", "/api/table"]) assert.ok(!isOpen(p), p);
});

test("a new store with no plan is locked at once; a demo store is not", async () => {
  await withAssess({ subscription: null }, async (svc) => {
    const res = await svc.assessAccount("r1", new Date("2026-09-21"));
    assert.equal(res.shouldLock, true, "no grace: nothing is running yet");
    assert.match(res.reasons.join(" "), /No plan is active yet\. Recharge at least ₹2,500\.00 to start\. The POS plan starts automatically\./);
  });
  await withAssess({ subscription: null, override: { billingExempt: true } }, async (svc) => {
    assert.equal((await svc.assessAccount("r1", new Date("2026-09-21"))).shouldLock, false);
  });
});

test("a cancelled subscription locks at once, with no grace", async () => {
  const subscription = { status: "CANCELLED", currentPeriodEnd: new Date("2026-09-20T18:30:00Z") };
  await withAssess({ subscription }, async (svc) => {
    const res = await svc.assessAccount("r1", new Date("2026-09-20T18:31:00Z"));
    assert.equal(res.shouldLock, true);
    assert.match(res.reasons.join(" "), /cancelled and this store is closed/);
  });
});

test("REGRESSION: the dead lockScope setting is gone; a lock always takes the website down", () => {
  // It was never in the schema, so CSD's "The POS only" choice was silently
  // dropped while every lock also closed the storefront.
  for (const rel of ["services/accountLock.js", "middlewares/accountLock.js", "controllers/csdBillingConfigController.js"]) {
    assert.ok(!/lockScope/.test(SRC(rel)), rel);
  }
  const { present } = require("../controllers/csdBillingConfigController");
  assert.equal("lockScope" in present({}), false);
  assert.match(SRC("services/storefrontResolver.js"), /if \(await isOrderingLocked\(restaurantId\)\) return \{ reason: "STORE_UNAVAILABLE", locked: true \}/);
});

test("SOURCE: paying re-evaluates the lock immediately", () => {
  // "After successful payment, the account should automatically unlock."
  const recharge = SRC("services/recharge.js");
  assert.match(recharge, /await evaluateLock\(intent\.restaurantId\)/, "awaited, so the caller is told");

  // After every money movement, awaited, so Billing's refresh right after
  // sees it unlocked: activation, each purchase, and both renewal outcomes.
  const sub = SRC("services/subscription.js");
  // (Printers are paid through the gateway and never move the wallet, so they
  // have no lock to re-check: see the assertion after this loop.)
  for (const [fn, n] of [["const activate", 1], ["const addAddon", 1], ["const renewOne", 2], ["const renewAddons", 1]]) {
    const body = sub.slice(sub.indexOf(fn), sub.indexOf("\n};", sub.indexOf(fn)));
    assert.equal((body.match(/await settleLock\(restaurantId\)/g) || []).length, n, fn);
  }
  assert.match(SRC("services/orderCharge.js"), /fireEvaluateLock\(restaurantId\)/);
  for (const fn of ["const preparePrinterPayment", "const recordPrinterPayment"]) {
    const body = sub.slice(sub.indexOf(fn), sub.indexOf("\n};", sub.indexOf(fn)));
    assert.ok(!/debit\(|charge\(/.test(body), `${fn} never touches the wallet`);
  }
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

test("SOURCE: the sweep renews what is due before it locks anything", () => {
  const src = SRC("services/accountLock.js");
  const sweep = src.slice(src.indexOf("const sweepLocks"));
  assert.ok(sweep.indexOf("renewDue(on)") !== -1 && sweep.indexOf("renewDue(on)") < sweep.indexOf("evaluateLock("));
  assert.ok(!/commitment/i.test(src), "the commitment repayment reason is gone");
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

test("N1: a closed store is locked at once (STORE_CLOSED), whatever its wallet or demo flag", async () => {
  const RID = "64b000000000000000000009";
  const rich = { createdAt: new Date("2026-09-01"), balanceAfterPaise: 900000 };
  for (const override of [null, { billingExempt: true }]) {
    await withAssess({ lastEntry: rich, closed: true, override }, async (svc) => {
      const res = await svc.assessAccount(RID, new Date("2026-09-21"));
      assert.equal(res.shouldLock, true);
      assert.equal(res.code, "STORE_CLOSED");
      assert.deepEqual(res.reasons, [svc.STORE_CLOSED_MESSAGE]);
      assert.equal(res.lockWarning, "");
    });
  }
  // Reopened: the same paid-up store is not locked.
  await withAssess({ lastEntry: rich, closed: false }, async (svc) => {
    const res = await svc.assessAccount(RID, new Date("2026-09-21"));
    assert.equal(res.shouldLock, false);
  });
});

test("N1: the POS gate says a closed store is STORE_CLOSED; other locks are UNPAID", async () => {
  const { BusinessBalance } = require("../models/businessBalanceModel");
  const { enforceAccountLock } = require("../middlewares/accountLock");
  const { STORE_CLOSED_MESSAGE } = require("../services/accountLock");
  assert.equal(STORE_CLOSED_MESSAGE, "This store is closed. Contact KnotKitchen support to reopen.");
  const original = BusinessBalance.findOne;
  const gate = async (lockedReason) => {
    BusinessBalance.findOne = () => ({ select: () => ({ lean: async () => ({ lockedAt: new Date(), lockedReason }) }) });
    let body = null;
    let status = null;
    await enforceAccountLock(
      { user: { restaurantId: "r1" }, baseUrl: "/api/order", path: "/" },
      { status: (s) => ((status = s), { json: (b) => (body = b) }) },
      () => {},
    );
    return { status, body };
  };
  try {
    const closed = await gate(STORE_CLOSED_MESSAGE);
    assert.equal(closed.status, 402);
    assert.deepEqual([closed.body.code, closed.body.reason, closed.body.message], ["ACCOUNT_LOCKED", "STORE_CLOSED", STORE_CLOSED_MESSAGE]);
    assert.equal((await gate("The subscription expired and the grace period has passed.")).body.reason, "UNPAID");
  } finally {
    BusinessBalance.findOne = original;
  }
});
