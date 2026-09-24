/**
 * The website, table QR ordering and online payments are add-ons: a store
 * gets each one only while it has the add-on (a stopped add-on keeps working
 * until its paid period ends). Demo stores get everything.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

const WEBSITE = { code: "WEBSITE", feature: "website", endsAt: null };
const TABLE_QR = { code: "TABLE_QR", feature: "tableQr", endsAt: null };
const GMB = { code: "GMB", feature: "", endsAt: null };
const CATALOG = {
  addons: [
    { code: "TABLE_QR", feature: "tableQr", pricePaise: 20000, isActive: true },
    { code: "WEBSITE", feature: "website", pricePaise: 30000, isActive: true },
  ],
};

/** planFeatures with a connected DB holding one subscription and override. */
const load = ({ addons = [], exempt = false } = {}) => {
  const orig = Module._load;
  Module._load = function (request) {
    if (request === "mongoose") return { connection: { readyState: 1 } };
    if (request === "../models/platformSubscriptionModel") {
      return { PlatformSubscription: { findOne: () => ({ select: () => ({ lean: async () => ({ addons }) }) }) } };
    }
    if (request === "./pricing") {
      return { getOverride: async () => ({ billingExempt: exempt }), getPlatformConfig: async () => CATALOG };
    }
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
  let json = null;
  let passed = false;
  await mw(
    { user: { restaurantId: "r1" }, body },
    { status: (s) => ((status = s), { json: (j) => (json = j) }) },
    () => (passed = true),
  );
  return { status, passed, json };
};
const outcome = async (mw, body) => {
  const { status, passed } = await call(mw, body);
  return { status, passed };
};

test("features come from the add-ons, not from a plan name", () => {
  const { featuresFor } = load();
  const none = { website: false, tableQr: false, paymentGateway: false };
  assert.deepEqual(featuresFor({ subscription: null }), none, "no add-ons, nothing");
  assert.deepEqual(featuresFor({ subscription: { planCode: "POS", addons: [GMB] } }), none, "GMB is a service, not a switch");
  assert.deepEqual(featuresFor({ subscription: { addons: [TABLE_QR] } }), { ...none, tableQr: true });
  // Online payments come with the website.
  assert.deepEqual(featuresFor({ subscription: { addons: [WEBSITE] } }), { website: true, tableQr: false, paymentGateway: true });
  assert.deepEqual(
    featuresFor({ subscription: { addons: [] }, exempt: true }),
    { website: true, tableQr: true, paymentGateway: true },
    "a CSD demo store gets everything",
  );
});

test("a stopped add-on works until its endsAt, and not after", () => {
  const { featuresFor } = load();
  const endsAt = new Date("2026-10-01T00:00:00+05:30");
  const subscription = { addons: [{ ...WEBSITE, endsAt }] };
  assert.equal(featuresFor({ subscription, on: new Date("2026-09-30T23:59:00+05:30") }).website, true);
  assert.equal(featuresFor({ subscription, on: endsAt }).website, false);
  assert.equal(featuresFor({ subscription, on: endsAt }).paymentGateway, false);
});

test("a CSD-made add-on unlocks by its feature, whatever its code", () => {
  const { featuresFor } = load();
  assert.equal(featuresFor({ subscription: { addons: [{ code: "WEB_PLUS", feature: "website" }] } }).website, true);
});

test("table QR ordering: diners and QR printing are refused without the add-on", async () => {
  const without = load({ addons: [GMB] });
  assert.equal(await without.hasFeature("r1", "tableQr"), false);
  const refused = await call(without.requireTableQrPlan, {});
  assert.equal(refused.status, 403);
  assert.equal(refused.json.code, "PLAN_UPGRADE_REQUIRED", "the code clients branch on is unchanged");
  assert.match(refused.json.message, /QR Table Ordering is an add-on \(₹200\.00 \+ GST a month\)\. Add it in Settings → Billing & Subscription\./);

  const withQr = load({ addons: [TABLE_QR] });
  assert.deepEqual(await outcome(withQr.requireTableQrPlan, {}), { status: null, passed: true });

  assert.match(SRC("middlewares", "tokenVerification.js"), /hasFeature\(req\.scope\.restaurantId, "tableQr"\)\)\) \{\s*return next\(createHttpError\(403,/);
  const qrRoutes = SRC("routes", "tableQRRoute.js");
  assert.match(qrRoutes, /requirePermission\("TABLE_READ"\), requireTableQrPlan, getOrCreateQr/);
  assert.match(qrRoutes, /requirePermission\("TABLE_UPDATE"\), requireTableQrPlan, regenerateQr/);
});

test("without the Website add-on: no Manage Website or website hours, but the POS settings on the same endpoint still save", async () => {
  const { requireWebsitePlan } = load({ addons: [TABLE_QR] });
  for (const body of [{ enabled: true }, { holidays: [] }, { channelHours: {} }, { closed: true }, { ordering: {}, enabled: true }]) {
    assert.deepEqual(await outcome(requireWebsitePlan, body), { status: 403, passed: false }, JSON.stringify(body));
  }
  const refused = await call(requireWebsitePlan, { enabled: true });
  assert.match(refused.json.message, /^The website is an add-on \(₹300\.00 \+ GST a month\)\. Add it in Settings/);
  // Order Toggles and Rules & Charges write these through /api/website/settings.
  for (const body of [{ ordering: { autoReadyMinutes: {} } }, { couponsConfig: [] }, { freeItemConfig: [] }]) {
    assert.deepEqual(await outcome(requireWebsitePlan, body), { status: null, passed: true }, JSON.stringify(body));
  }
});

test("the Website add-on and demo stores pass", async () => {
  for (const opts of [{ addons: [WEBSITE] }, { addons: [], exempt: true }]) {
    const { requireWebsitePlan, hasWebsite } = load(opts);
    assert.equal(await hasWebsite("r1"), true);
    assert.deepEqual(await outcome(requireWebsitePlan, { enabled: true }), { status: null, passed: true });
  }
});

test("REGRESSION: a database hiccup never takes a paying store's website down", async () => {
  const orig = Module._load;
  Module._load = function (request) {
    if (request === "mongoose") return { connection: { readyState: 1 } };
    if (request === "../models/platformSubscriptionModel") {
      return { PlatformSubscription: { findOne: () => ({ select: () => ({ lean: async () => { throw new Error("db down"); } }) }) } };
    }
    if (request === "./pricing") return { getOverride: async () => null, getPlatformConfig: async () => CATALOG };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../services/planFeatures")];
  try {
    assert.equal(await require("../services/planFeatures").hasFeature("r1", "website"), true);
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve("../services/planFeatures")];
  }
});

test("SOURCE: the gate is on every website write, the storefront, and the POS status", () => {
  const routes = SRC("routes", "restaurantRoute.js");
  for (const r of ["timings", "holidays", "closed-for-today"]) {
    assert.match(routes, new RegExp(`"/${r}"\\)\\.put\\(isVerifiedUser, requireProtectedAction, requireWebsitePlan,`), r);
  }
  assert.match(SRC("routes", "websiteRoute.js"), /requireProtectedAction, requireWebsitePlan, updateWebsiteSettings/);
  assert.match(SRC("services", "storefrontResolver.js"), /if \(!\(await hasWebsite\(restaurantId, settings\.storeId\)\)\) \{\s*return \{ ok: false, status: 403, reason: "WEBSITE_DISABLED"/);
  assert.match(SRC("services", "subscription.js"), /features: featuresFor\(\{ subscription, exempt, on \}\),/);
});

test("the payment gateway comes with the Website add-on", async () => {
  const gatewayBody = { paymentGateways: { activeGateway: "cashfree" } };
  const without = load({ addons: [TABLE_QR] });
  assert.deepEqual(await outcome(without.requireWebsitePlan, gatewayBody), { status: 403, passed: false });
  const refused = await call(without.requirePaymentGatewayPlan, {});
  assert.equal(refused.status, 403);
  assert.match(refused.json.message, /Online payments come with the Website add-on \(₹300\.00 \+ GST a month\)/);
  const withSite = load({ addons: [WEBSITE] });
  assert.deepEqual(await outcome(withSite.requireWebsitePlan, gatewayBody), { status: null, passed: true }, "gateway-only save");
  assert.deepEqual(await outcome(withSite.requirePaymentGatewayPlan, {}), { status: null, passed: true });

  assert.match(SRC("routes", "websiteRoute.js"), /requireOwnerOnly, requirePaymentGatewayPlan, validateGatewayCredentials/);
  assert.match(SRC("routes", "paymentLinkRoute.js"), /requirePermission\("PAYMENT_CREATE"\), requirePaymentGatewayPlan, createPaymentLink/);
  // Money already in flight is never gated.
  assert.ok(!/requirePaymentGatewayPlan, verifyAndCaptureLinkPayment/.test(SRC("routes", "paymentLinkRoute.js")));
});
