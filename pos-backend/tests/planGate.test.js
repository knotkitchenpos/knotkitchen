/**
 * The Billing plan (planCode "BILLING") is billing only: middlewares/planGate
 * refuses every staff API outside its allow-list with 403
 * PLAN_UPGRADE_REQUIRED. POS-plan and demo stores always pass; Website Timing &
 * Holidays open on the Billing plan with the Website add-on; a DB error lets
 * the request through, like the account lock.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const { enforcePlan, isBillingOpen, BILLING_OPEN, BILLING_WITH_ADDON } = require("../middlewares/planGate");
const { ALWAYS_OPEN } = require("../middlewares/accountLock");

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const WEBSITE = { code: "WEBSITE", feature: "website", endsAt: null };
const TABLE_QR = { code: "TABLE_QR", feature: "tableQr", endsAt: null };

/** enforcePlan for one store, its subscription read through a spy. */
const gate = async ({ planCode, addons = [], exempt = false, fail = false, user = { restaurantId: "r1", storeId: "100001" } }, baseUrl, reqPath) => {
  let reads = 0;
  const orig = Module._load;
  Module._load = function (request) {
    if (request === "mongoose") return { connection: { readyState: 1 } };
    if (request === "../models/platformSubscriptionModel") {
      const lean = async () => {
        reads += 1;
        if (fail) throw new Error("db down");
        return { planCode, addons };
      };
      return { PlatformSubscription: { findOne: () => ({ select: () => ({ lean }) }) } };
    }
    if (request === "./pricing") return { getOverride: async () => ({ billingExempt: exempt }), getPlatformConfig: async () => ({}) };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../services/planFeatures")];
  let status = null;
  let json = null;
  let passed = false;
  try {
    await enforcePlan(
      { user, baseUrl, path: reqPath },
      { status: (s) => ((status = s), { json: (j) => (json = j) }) },
      () => (passed = true),
    );
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve("../services/planFeatures")];
  }
  return { status, passed, json, reads };
};

// The owner's ₹199 list: Product page, Orders, Reports, Help & Support, Manage
// Cache, Device Configuration, Store Properties, Manage Menu, Manage Staff,
// Billing & Subscription, Logout -- and what those screens call.
const OPEN = [
  "/api/user/logout", "/api/user/refresh",
  "/api/business-balance", "/api/subscription", "/api/subscription/plan", "/api/subscription/addons",
  "/api/support/requests", "/api/csd/anything", "/api/payment/webhook/cashfree",
  "/api/restaurant/me", "/api/restaurant/verify-pin", "/health", "/ready", "/r/abc", "/uploads/logo.png",
  "/api/order", "/api/order/report", "/api/order/popular-items", "/api/order/abc/cancel",
  "/api/offline/orders/sync",
  "/api/menu", "/api/menu/publish/system", "/api/menu/publish/website", "/api/menu/abc/dish/def/availability",
  "/api/media", "/api/receipts/send-ebill", "/api/online-orders/abc/status",
  "/api/restaurant/properties", "/api/restaurant/change-pin", "/api/restaurant/pos-settings",
  "/api/restaurant/staff", "/api/restaurant/staff/abc",
  "/api/website/settings", "/api/website/validate-gateway",
  "/api/payment-link", "/api/payment-link/abc",
  // A table still open when the move down takes effect is settled from Orders.
  "/api/table-session/abc", "/api/table-session/abc/bill", "/api/table-session/abc/payment", "/api/table-session/abc/close",
];
// Everything else on the Billing plan.
const LOCKED = [
  "/api/restaurant/order-toggles", "/api/restaurant/timings", "/api/restaurant/holidays", "/api/restaurant/closed-for-today",
  "/api/website/knot-eats",
  "/api/table", "/api/table/settings", "/api/table/abc", "/api/table/abc/qr/regenerate",
  "/api/table-sessions",
  "/api/table-bookings", "/api/table-bookings/abc",
  "/api/table-qr/table/abc", "/api/qr/tables/abc/generate", "/api/qr/waiter-call/abc/dismiss",
  "/api/marketplace/stream", "/api/shift", "/api/shift/close", "/api/inventory", "/api/inventory/items",
  // Prefix lookalikes are not the open paths.
  "/api/orders", "/api/menus", "/api/restaurant/staffing", "/api/website/settingsx",
];

test("the Billing plan's allow-list: the owner's screens open, everything else locked", () => {
  for (const p of OPEN) assert.ok(isBillingOpen(p), `${p} should be open`);
  for (const p of LOCKED) assert.ok(!isBillingOpen(p), `${p} should be locked`);
  for (const p of ALWAYS_OPEN) assert.ok(BILLING_OPEN.includes(p), `${p}: whatever the lock leaves open, the plan does too`);
  assert.deepEqual(BILLING_WITH_ADDON, [
    ["/api/restaurant/timings", "websiteHours"], ["/api/restaurant/holidays", "websiteHours"], ["/api/restaurant/closed-for-today", "websiteHours"],
  ]);
});

test("POS-plan, unchosen and demo stores always pass", async () => {
  for (const opts of [{ planCode: "POS" }, { planCode: "" }, { planCode: undefined }, { planCode: "BILLING", exempt: true }]) {
    for (const [base, p] of [["/api/table", "/"], ["/api/restaurant", "/order-toggles"], ["/api/marketplace", "/stream"]]) {
      const out = await gate(opts, base, p);
      assert.deepEqual([out.status, out.passed], [null, true], `${JSON.stringify(opts)} ${base}${p}`);
    }
  }
  assert.equal((await gate({ planCode: "POS" }, "/api/table", "/")).reads, 1, "one indexed read for a POS store");
});

test("the Billing plan: a locked API is refused with 403 PLAN_UPGRADE_REQUIRED and the way to Billing", async () => {
  for (const addons of [[], [WEBSITE], [TABLE_QR]]) {
    for (const full of LOCKED.filter((p) => !BILLING_WITH_ADDON.some(([a]) => p === a))) {
      const out = await gate({ planCode: "BILLING", addons }, "", full);
      assert.equal(out.status, 403, full);
      assert.equal(out.passed, false, full);
      assert.deepEqual(
        { code: out.json.code, feature: out.json.feature, upgradeTo: out.json.upgradeTo, billingPath: out.json.billingPath },
        { code: "PLAN_UPGRADE_REQUIRED", feature: "pos", upgradeTo: "POS", billingPath: "/settings/billing" },
        full,
      );
      assert.match(out.json.message, /Upgrade to the POS plan in Settings → Billing & Subscription\./);
    }
  }
  // Matched on the full path, as the account lock is (req.path is relative to the router).
  assert.equal((await gate({ planCode: "BILLING" }, "/api/restaurant", "/order-toggles")).status, 403);
  assert.equal((await gate({ planCode: "billing" }, "/api/table", "/")).status, 403, "the code is read case-blind");
});

test("the Billing plan: Website Timing & Holidays open with the Website add-on, and only with it", async () => {
  for (const p of ["/timings", "/holidays", "/closed-for-today"]) {
    const withSite = await gate({ planCode: "BILLING", addons: [WEBSITE] }, "/api/restaurant", p);
    assert.deepEqual([withSite.status, withSite.passed], [null, true], p);
    for (const addons of [[], [TABLE_QR]]) {
      const without = await gate({ planCode: "BILLING", addons }, "/api/restaurant", p);
      assert.equal(without.status, 403, p);
      assert.equal(without.json.feature, "websiteHours");
      assert.equal(without.json.code, "PLAN_UPGRADE_REQUIRED");
      assert.match(without.json.message, /come with the Website add-on or the POS plan/);
    }
  }
  // The Website add-on opens its own hours, not the rest of the POS.
  assert.equal((await gate({ planCode: "BILLING", addons: [WEBSITE] }, "/api/restaurant", "/order-toggles")).status, 403);
  assert.equal((await gate({ planCode: "BILLING", addons: [WEBSITE] }, "/api/website", "/knot-eats")).status, 403);
});

test("an open path is decided without a database read; no store, nothing to gate", async () => {
  for (const p of OPEN) {
    const out = await gate({ planCode: "BILLING" }, "", p);
    assert.deepEqual([out.status, out.passed, out.reads], [null, true, 0], p);
  }
  const anon = await gate({ planCode: "BILLING", user: null }, "/api/table", "/");
  assert.deepEqual([anon.passed, anon.reads], [true, 0]);
});

test("REGRESSION: a database error lets the request through (fails open, like the account lock)", async () => {
  const out = await gate({ planCode: "BILLING", fail: true }, "/api/table", "/");
  assert.deepEqual([out.status, out.passed, out.reads], [null, true, 1]);
});

test("SOURCE: the plan gate runs inside isVerifiedUser, after the account lock", () => {
  const auth = SRC("middlewares", "tokenVerification.js");
  assert.match(auth, /return enforceAccountLock\(req, res, \(\) => enforcePlan\(req, res, next\)\);/);
  assert.match(auth, /const \{ enforcePlan \} = require\("\.\/planGate"\);/);
  // Only the account lock at the top: tests load tokenVerification with mocked models.
  const src = SRC("middlewares", "planGate.js");
  const top = src.slice(0, src.indexOf("const enforcePlan"));
  assert.deepEqual(top.match(/require\([^)]*\)/g), ['require("./accountLock")']);
  const catchBlock = src.slice(src.indexOf("} catch (err) {"));
  assert.match(catchBlock, /return next\(\);/, "fails open");
});

test("REGRESSION: a table open when the Billing plan starts can still be settled; a new one is refused by the Table toggle", async () => {
  for (const p of ["/:id", "/:id/bill", "/:id/payment", "/:id/payment-pending", "/:id/request-bill", "/:id/close"].map((x) => x.replace(":id", "s1"))) {
    const out = await gate({ planCode: "BILLING" }, "/api/table-session", p);
    assert.deepEqual([out.status, out.passed], [null, true], p);
  }
  // New tables: the Table toggle, computed off on the Billing plan (planFeatures.test.js pins the check).
  const sessions = SRC("controllers", "tableSessionController.js");
  const addItems = sessions.slice(sessions.indexOf("const addItemsToSession"), sessions.indexOf("// Create new session"));
  assert.match(addItems, /if \(!session\) \{[\s\S]*orderTogglesFor\(req\.user\?\.restaurantId, req\.user\?\.storeId\)\)\.table === false[\s\S]*if \(tableOff\) throw createHttpError\(400/);
});

// The owner, 2026-10-16: the ₹499 plan has everything but Manage Website, with no add-on.
test("REGRESSION: the POS plan with no add-on passes every path the Billing plan locks (tables, QR, toggles, timings)", async () => {
  for (const planCode of ["POS", ""]) {
    for (const full of LOCKED) {
      const out = await gate({ planCode, addons: [] }, "", full);
      assert.deepEqual([out.status, out.passed], [null, true], `${planCode} ${full}`);
    }
  }
});
