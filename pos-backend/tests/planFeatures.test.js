/**
 * "For the Essential Plan, Website Enabled should be OFF by default. Manage
 * Website, Website Timing and Holidays should remain locked. Only the Growth
 * and Scale plans should have all features fully unlocked."
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

/** planFeatures with a connected DB holding one subscription and override. */
const load = ({ planCode = "", exempt = false } = {}) => {
  const orig = Module._load;
  Module._load = function (request) {
    if (request === "mongoose") return { connection: { readyState: 1 } };
    if (request === "../models/platformSubscriptionModel") {
      return { PlatformSubscription: { findOne: () => ({ select: () => ({ lean: async () => ({ planCode }) }) }) } };
    }
    if (request === "./pricing") return { getOverride: async () => ({ billingExempt: exempt }) };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../services/planFeatures")];
  try {
    return require("../services/planFeatures");
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve("../services/planFeatures")];
  }
};

const call = async (mw, body) => {
  let status = null;
  let passed = false;
  await mw({ user: { restaurantId: "r1" }, body }, { status: (s) => ((status = s), { json: () => {} }) }, () => (passed = true));
  return { status, passed };
};

test("only Growth and Scale (and demo stores) get the website and table QR ordering", () => {
  const { featuresFor } = load();
  const none = { website: false, tableQr: false, paymentGateway: false };
  const all = { website: true, tableQr: true, paymentGateway: true };
  for (const planCode of ["ESSENTIAL", "", undefined]) assert.deepEqual(featuresFor({ planCode }), none, String(planCode));
  // Connect: no website, but its own payment gateway.
  assert.deepEqual(featuresFor({ planCode: "CONNECT" }), { ...none, paymentGateway: true });
  for (const planCode of ["GROWTH", "SCALE", "growth"]) assert.deepEqual(featuresFor({ planCode }), all, planCode);
  assert.deepEqual(featuresFor({ planCode: "ESSENTIAL", exempt: true }), all, "a CSD demo store gets everything");
});

test("table QR ordering: diners and QR printing are refused below Growth", async () => {
  const essential = load({ planCode: "ESSENTIAL" });
  assert.equal(await essential.hasFeature("r1", "tableQr"), false);
  assert.deepEqual(await call(essential.requireTableQrPlan, {}), { status: 403, passed: false });
  const growth = load({ planCode: "GROWTH" });
  assert.deepEqual(await call(growth.requireTableQrPlan, {}), { status: null, passed: true });

  assert.match(SRC("middlewares", "tokenVerification.js"), /hasFeature\(req\.scope\.restaurantId, "tableQr"\)\)\) \{\s*return next\(createHttpError\(403,/);
  const qrRoutes = SRC("routes", "tableQRRoute.js");
  assert.match(qrRoutes, /requirePermission\("TABLE_READ"\), requireTableQrPlan, getOrCreateQr/);
  assert.match(qrRoutes, /requirePermission\("TABLE_UPDATE"\), requireTableQrPlan, regenerateQr/);
});

test("Essential cannot change Manage Website or the website's hours, but keeps the POS settings on the same endpoint", async () => {
  const { requireWebsitePlan } = load({ planCode: "ESSENTIAL" });
  for (const body of [{ enabled: true }, { holidays: [] }, { channelHours: {} }, { closed: true }, { ordering: {}, enabled: true }]) {
    assert.deepEqual(await call(requireWebsitePlan, body), { status: 403, passed: false }, JSON.stringify(body));
  }
  // Order Toggles and Rules & Charges write these through /api/website/settings.
  for (const body of [{ ordering: { autoReadyMinutes: {} } }, { couponsConfig: [] }, { freeItemConfig: [] }]) {
    assert.deepEqual(await call(requireWebsitePlan, body), { status: null, passed: true }, JSON.stringify(body));
  }
});

test("Growth, Scale and demo stores pass", async () => {
  for (const opts of [{ planCode: "GROWTH" }, { planCode: "SCALE" }, { planCode: "ESSENTIAL", exempt: true }]) {
    const { requireWebsitePlan, hasWebsite } = load(opts);
    assert.equal(await hasWebsite("r1"), true);
    assert.deepEqual(await call(requireWebsitePlan, { enabled: true }), { status: null, passed: true });
  }
});

test("SOURCE: the gate is on every website write, the storefront, and the POS status", () => {
  const routes = SRC("routes", "restaurantRoute.js");
  for (const r of ["timings", "holidays", "closed-for-today"]) {
    assert.match(routes, new RegExp(`"/${r}"\\)\\.put\\(isVerifiedUser, requireProtectedAction, requireWebsitePlan,`), r);
  }
  assert.match(SRC("routes", "websiteRoute.js"), /requireProtectedAction, requireWebsitePlan, updateWebsiteSettings/);
  assert.match(SRC("services", "storefrontResolver.js"), /if \(!\(await hasWebsite\(restaurantId, settings\.storeId\)\)\) \{\s*return \{ ok: false, status: 403, reason: "WEBSITE_DISABLED"/);
  assert.match(SRC("services", "subscription.js"), /features: featuresFor\(\{ planCode: subscription\.planCode, exempt: override\?\.billingExempt \}\),/);
});

test("the payment gateway: not on Essential, yes on Connect and above", async () => {
  // "Payment gateway will not be available in the first plan."
  const gatewayBody = { paymentGateways: { activeGateway: "cashfree" } };
  const essential = load({ planCode: "ESSENTIAL" });
  assert.deepEqual(await call(essential.requireWebsitePlan, gatewayBody), { status: 403, passed: false });
  assert.deepEqual(await call(essential.requirePaymentGatewayPlan, {}), { status: 403, passed: false });
  const connect = load({ planCode: "CONNECT" });
  assert.deepEqual(await call(connect.requireWebsitePlan, gatewayBody), { status: null, passed: true }, "gateway-only save");
  assert.deepEqual(await call(connect.requireWebsitePlan, { ...gatewayBody, enabled: true }), { status: 403, passed: false }, "not the website");
  assert.deepEqual(await call(connect.requirePaymentGatewayPlan, {}), { status: null, passed: true });

  assert.match(SRC("routes", "websiteRoute.js"), /requireOwnerOnly, requirePaymentGatewayPlan, validateGatewayCredentials/);
  assert.match(SRC("routes", "paymentLinkRoute.js"), /requirePermission\("PAYMENT_CREATE"\), requirePaymentGatewayPlan, createPaymentLink/);
  // Money already in flight is never gated.
  assert.ok(!/requirePaymentGatewayPlan, verifyAndCaptureLinkPayment/.test(SRC("routes", "paymentLinkRoute.js")));
});
