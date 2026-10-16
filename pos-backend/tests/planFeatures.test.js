/**
 * The plan unlocks the core (the Billing plan is billing only). Since
 * 2026-10-16 the POS plan includes tables, table QR ordering and payment
 * links; the website is the one add-on that unlocks anything: a store gets it
 * only while it has the add-on (a stopped add-on keeps working until its paid
 * period ends), and on the Billing plan it also brings payment links and
 * website hours. Demo stores get everything.
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
    { code: "WEBSITE", feature: "website", pricePaise: 360000, periodDays: 365, isActive: true },
  ],
};

/** planFeatures with a connected DB holding one subscription and override. */
const load = ({ addons = [], exempt = false, planCode } = {}) => {
  const orig = Module._load;
  Module._load = function (request) {
    if (request === "mongoose") return { connection: { readyState: 1 } };
    if (request === "../models/platformSubscriptionModel") {
      return { PlatformSubscription: { findOne: () => ({ select: () => ({ lean: async () => ({ addons, planCode }) }) }) } };
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

test("features come from the plan (pos) and the add-ons", () => {
  const { featuresFor, ALL_FEATURES } = load();
  // The POS plan ("" or missing is POS) with no add-ons: everything but the website (changed 2026-10-16:
  // tables, table QR ordering and payment links were add-on features).
  const pos = { pos: true, website: false, tableQr: true, paymentGateway: true, websiteHours: true, onlineOrdering: true };
  assert.deepEqual(featuresFor({ subscription: null }), pos, "no subscription row reads as the POS plan");
  assert.deepEqual(featuresFor({ subscription: { planCode: "", addons: [] } }), pos);
  assert.deepEqual(featuresFor({ subscription: { planCode: "POS", addons: [GMB] } }), pos, "GMB is a service, not a switch");
  assert.deepEqual(featuresFor({ subscription: { planCode: "POS", addons: [TABLE_QR] } }), pos, "a retired QR add-on adds nothing");
  assert.deepEqual(featuresFor({ subscription: { planCode: "POS", addons: [WEBSITE] } }), { ...pos, website: true });
  // The Billing plan: billing only. The Website add-on still works and brings website hours; QR Table Ordering does not.
  const billing = { pos: false, website: false, tableQr: false, paymentGateway: false, websiteHours: false, onlineOrdering: false };
  assert.deepEqual(featuresFor({ subscription: { planCode: "BILLING", addons: [GMB] } }), billing);
  assert.deepEqual(featuresFor({ subscription: { planCode: "billing", addons: [] } }), billing, "the code is read case-blind");
  assert.deepEqual(featuresFor({ subscription: { planCode: "BILLING", addons: [TABLE_QR] } }), billing, "no table orders on the Billing plan");
  assert.deepEqual(
    featuresFor({ subscription: { planCode: "BILLING", addons: [WEBSITE] } }),
    { ...billing, website: true, paymentGateway: true, websiteHours: true },
  );
  assert.deepEqual(featuresFor({ subscription: { planCode: "BILLING", addons: [] }, exempt: true }), { ...ALL_FEATURES }, "a CSD demo store gets everything");
  assert.deepEqual(ALL_FEATURES, { pos: true, website: true, tableQr: true, paymentGateway: true, websiteHours: true, onlineOrdering: true });
});

test("featuresOf reads the plan and add-ons, and fails open to everything", async () => {
  assert.deepEqual(await load({ planCode: "BILLING", addons: [WEBSITE] }).featuresOf("r1"), {
    pos: false, website: true, tableQr: false, paymentGateway: true, websiteHours: true, onlineOrdering: false,
  });
  const { featuresOf, ALL_FEATURES } = load({ planCode: "BILLING" });
  assert.deepEqual(await featuresOf(null), { ...ALL_FEATURES }, "no store, nothing to gate");
  assert.equal(await load({ planCode: "BILLING", exempt: true }).hasFeature("r1", "pos"), true, "demo store");
  assert.equal(await load({ planCode: "BILLING" }).hasFeature("r1", "pos"), false);
  assert.equal(await load({ planCode: "POS" }).hasFeature("r1", "pos"), true);
});

test("effective order toggles: Collection only on the Billing plan, the stored switches otherwise", () => {
  const { effectiveOrderToggles } = load();
  const off = { collection: false, delivery: false, table: false };
  const collectionOnly = { collection: true, delivery: false, table: false };
  for (const stored of [undefined, null, {}, off, { collection: true, delivery: true, table: true }]) {
    assert.deepEqual(effectiveOrderToggles(stored, { pos: false }), collectionOnly, JSON.stringify(stored));
  }
  assert.deepEqual(effectiveOrderToggles(undefined, { pos: true }), { collection: true, delivery: true, table: true }, "missing means on");
  assert.deepEqual(effectiveOrderToggles({ delivery: false }, { pos: true }), { collection: true, delivery: false, table: true });
  assert.deepEqual(effectiveOrderToggles(off, { pos: true }), off, "an upgrade gets the store's own switches back");
  assert.deepEqual(effectiveOrderToggles({ table: false }, undefined), { collection: true, delivery: true, table: false }, "no features: stored");
});

test("orderTogglesFor reads the store's switches and plan now, and fails open", async () => {
  const run = async ({ planCode, stored, restaurantThrows = false }) => {
    const orig = Module._load;
    Module._load = function (request) {
      if (request === "mongoose") return { connection: { readyState: 1 } };
      if (request === "../models/platformSubscriptionModel") {
        return { PlatformSubscription: { findOne: () => ({ select: () => ({ lean: async () => ({ addons: [], planCode }) }) }) } };
      }
      if (request === "./pricing") return { getOverride: async () => null, getPlatformConfig: async () => CATALOG };
      if (request === "../models/restaurantModel") {
        return { findById: () => ({ select: () => ({ lean: async () => { if (restaurantThrows) throw new Error("db down"); return { orderTypeToggles: stored }; } }) }) };
      }
      return orig.apply(this, arguments);
    };
    delete require.cache[require.resolve("../services/planFeatures")];
    try {
      return await require("../services/planFeatures").orderTogglesFor("r1", "100001");
    } finally {
      Module._load = orig;
      delete require.cache[require.resolve("../services/planFeatures")];
    }
  };
  const stored = { collection: true, delivery: false, table: true };
  assert.deepEqual(await run({ planCode: "POS", stored }), stored);
  assert.deepEqual(await run({ planCode: "BILLING", stored }), { collection: true, delivery: false, table: false });
  assert.deepEqual(await run({ planCode: "POS", stored, restaurantThrows: true }), { collection: true, delivery: true, table: true });
});

test("a stopped add-on works until its endsAt, and not after", () => {
  const { featuresFor } = load();
  const endsAt = new Date("2026-10-01T00:00:00+05:30");
  // On the Billing plan, where payment links come with the website (on the POS plan they are the plan's).
  const subscription = { planCode: "BILLING", addons: [{ ...WEBSITE, endsAt }] };
  assert.equal(featuresFor({ subscription, on: new Date("2026-09-30T23:59:00+05:30") }).website, true);
  assert.equal(featuresFor({ subscription, on: new Date("2026-09-30T23:59:00+05:30") }).paymentGateway, true);
  assert.equal(featuresFor({ subscription, on: endsAt }).website, false);
  assert.equal(featuresFor({ subscription, on: endsAt }).paymentGateway, false);
});

test("a yearly add-on works until its paidUntil: a renewal the wallet could not cover switches it off", () => {
  const { featuresFor } = load();
  const paidUntil = new Date("2027-10-01T00:00:00+05:30");
  const subscription = { addons: [{ ...WEBSITE, periodDays: 365, paidUntil }, GMB] };
  assert.equal(featuresFor({ subscription, on: new Date("2027-09-30T23:59:00+05:30") }).website, true);
  const lapsed = featuresFor({ subscription, on: paidUntil });
  assert.deepEqual([lapsed.website, lapsed.paymentGateway, lapsed.tableQr], [false, true, true], "only that add-on: the POS plan keeps its own");
  const billing = featuresFor({ subscription: { ...subscription, planCode: "BILLING" }, on: paidUntil });
  assert.deepEqual([billing.website, billing.paymentGateway, billing.websiteHours], [false, false, false], "on the Billing plan what it brought goes with it");
});

test("a CSD-made add-on unlocks by its feature, whatever its code", () => {
  const { featuresFor } = load();
  assert.equal(featuresFor({ subscription: { addons: [{ code: "WEB_PLUS", feature: "website" }] } }).website, true);
});

// Changed 2026-10-16 (was: refused without the QR Table Ordering add-on, quoting its ₹200 price).
test("table QR ordering: the POS plan has it with no add-on; the Billing plan is refused with the plan upgrade", async () => {
  for (const addons of [[], [GMB], [TABLE_QR]]) {
    const pos = load({ addons, planCode: "POS" });
    assert.equal(await pos.hasFeature("r1", "tableQr"), true, JSON.stringify(addons));
    assert.deepEqual(await outcome(pos.requireTableQrPlan, {}), { status: null, passed: true }, JSON.stringify(addons));
  }
  for (const addons of [[], [TABLE_QR], [WEBSITE]]) {
    const billing = load({ addons, planCode: "BILLING" });
    assert.equal(await billing.hasFeature("r1", "tableQr"), false, JSON.stringify(addons));
    const refused = await call(billing.requireTableQrPlan, {});
    assert.equal(refused.status, 403);
    assert.deepEqual(
      { code: refused.json.code, feature: refused.json.feature, upgradeTo: refused.json.upgradeTo, billingPath: refused.json.billingPath },
      { code: "PLAN_UPGRADE_REQUIRED", feature: "tableQr", upgradeTo: "POS", billingPath: "/settings/billing" },
      "the code clients branch on is unchanged",
    );
    assert.match(refused.json.message, /Upgrade to the POS plan in Settings → Billing & Subscription\./);
    assert.doesNotMatch(refused.json.message, /add-on|₹/);
  }
  assert.deepEqual(await outcome(load({ planCode: "BILLING", exempt: true }).requireTableQrPlan, {}), { status: null, passed: true }, "demo store");

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
  assert.match(refused.json.message, /^The website is an add-on \(₹3,600\.00 \+ GST \/ year\)\. Add it in Settings/);
  // Order Toggles and Rules & Charges write these through /api/website/settings.
  for (const body of [{ ordering: { autoReadyMinutes: {} } }, { couponsConfig: [] }, { freeItemConfig: [] }]) {
    assert.deepEqual(await outcome(requireWebsitePlan, body), { status: null, passed: true }, JSON.stringify(body));
  }
});

test("POS plan alone: Order Toggles and Rules & Charges are open; managing tables keeps its tableQr gate", async () => {
  const rulesBodies = [{ ordering: { taxPercent: 5, serviceChargePercent: 0 } }, { couponsConfig: [] }, { freeItemConfig: [] }];
  const autoReadyBodies = [{ ordering: { autoReadyMinutes: {} } }, { ordering: { autoReadyEnabled: true } }, { ordering: { autoCompleteMinutes: {} } }];
  for (const planCode of ["POS", "", undefined]) {
    const pos = load({ addons: [GMB], planCode });
    for (const body of [...rulesBodies, ...autoReadyBodies]) {
      assert.deepEqual(await outcome(pos.requireWebsitePlan, body), { status: null, passed: true }, `${planCode} ${JSON.stringify(body)}`);
    }
  }
  // The Billing plan: Rules & Charges stay open (GST, charges); writing the auto-ready settings needs the POS plan.
  for (const addons of [[], [WEBSITE]]) {
    const billing = load({ addons, planCode: "BILLING" });
    for (const body of rulesBodies) {
      assert.deepEqual(await outcome(billing.requireWebsitePlan, body), { status: null, passed: true }, JSON.stringify(body));
    }
    for (const body of [...autoReadyBodies, { ordering: { taxPercent: 5, autoReadyEnabled: false } }]) {
      const refused = await call(billing.requireWebsitePlan, body);
      assert.equal(refused.status, 403, JSON.stringify(body));
      assert.deepEqual(
        { code: refused.json.code, feature: refused.json.feature, upgradeTo: refused.json.upgradeTo, billingPath: refused.json.billingPath },
        { code: "PLAN_UPGRADE_REQUIRED", feature: "pos", upgradeTo: "POS", billingPath: "/settings/billing" },
      );
      assert.match(refused.json.message, /Upgrade to the POS plan in Settings → Billing & Subscription\./);
    }
  }
  assert.deepEqual(await outcome(load({ planCode: "BILLING", exempt: true }).requireWebsitePlan, autoReadyBodies[0]), { status: null, passed: true }, "demo store");
  // REGRESSION: another key next to them does not carry the auto-ready keys past the plan on the Website add-on.
  const withSite = load({ addons: [WEBSITE], planCode: "BILLING" });
  for (const body of [{ ordering: { autoReadyEnabled: true, autoReadyMinutes: { collection: 5 } }, enabled: true }, { ordering: { autoCompleteMinutes: {} }, branding: {} }]) {
    const refused = await call(withSite.requireWebsitePlan, body);
    assert.deepEqual([refused.status, refused.json.feature], [403, "pos"], JSON.stringify(body));
  }
  // Manage Website's whole-document save echoes `version` (the controller then never writes ordering): still the add-on's.
  assert.deepEqual(await outcome(withSite.requireWebsitePlan, { ordering: { autoReadyEnabled: true }, enabled: true, version: 3 }), { status: null, passed: true });
  assert.deepEqual(await outcome(load({ planCode: "BILLING" }).requireWebsitePlan, { ordering: { autoReadyEnabled: true }, enabled: true, version: 3 }), { status: 403, passed: false });
  assert.match(SRC("controllers", "websiteSettingsController.js"), /if \(body\.ordering && body\.version === undefined\) \{/);
  assert.equal(load().requireOnlineOrderingPlan, undefined, "the add-on gate on the POS settings is gone");
  assert.match(SRC("routes", "restaurantRoute.js"), /"\/order-toggles"\)\.put\(isVerifiedUser, requireTypedPin\(\), updateOrderToggles\)/);
  assert.doesNotMatch(SRC("routes", "restaurantRoute.js"), /requireOnlineOrderingPlan/);
  const tables = SRC("routes", "tableRoute.js");
  for (const h of ["addTable", "updateTableSettings", "updateTable", "deleteTable"]) {
    const guard = h === "updateTableSettings" ? "requireTypedPin\\(\\)" : "requireProtectedAction";
    assert.match(tables, new RegExp(`${guard}, requireTableQrPlan, ${h}\\)`), h);
  }
  assert.match(tables, /\.get\(isVerifiedUser, getTables\)/, "reading tables stays open");
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
  // REGRESSION: the table QR obeys "Restaurant Time", so a QR-only store must
  // be able to set it; requireWebsitePlan held it to the 4 PM default. Now open
  // on the POS plan; on the Billing plan only with the Website add-on (planGate).
  const { BILLING_WITH_ADDON } = require("../middlewares/planGate");
  for (const [r, handler] of [["timings", "updateChannelTimings"], ["holidays", "updateHolidays"], ["closed-for-today", "toggleClosedForToday"]]) {
    assert.match(routes, new RegExp(`"/${r}"\\)\\.put\\(isVerifiedUser, requireTypedPin\\(\\), ${handler}\\)`), r);
    assert.ok(BILLING_WITH_ADDON.some(([p, f]) => p === `/api/restaurant/${r}` && f === "websiteHours"), r);
  }
  assert.match(SRC("routes", "websiteRoute.js"), /requireTypedPin\(\), requireWebsitePlan, updateWebsiteSettings/);
  assert.match(SRC("services", "storefrontResolver.js"), /if \(!\(await hasWebsite\(restaurantId, settings\.storeId\)\)\) return \{ reason: "WEBSITE_DISABLED" \};/);
  assert.match(SRC("services", "subscription.js"), /features: featuresFor\(\{ subscription, exempt, on \}\),/);
});

// Changed 2026-10-16 (was: payment links needed the Website add-on on every plan).
test("the gateway set-up is open to every store; payment links come with the POS plan, or the Website add-on on the Billing plan", async () => {
  const gatewayBody = { paymentGateways: { activeGateway: "cashfree" } };
  for (const planCode of ["POS", "BILLING"]) {
    assert.deepEqual(await outcome(load({ addons: [], planCode }).requireWebsitePlan, gatewayBody), { status: null, passed: true }, `${planCode} gateway-only save`);
  }
  assert.deepEqual(await outcome(load({ addons: [], planCode: "POS" }).requirePaymentGatewayPlan, {}), { status: null, passed: true }, "POS plan, no add-on");
  for (const addons of [[TABLE_QR], []]) {
    const without = load({ addons, planCode: "BILLING" });
    assert.deepEqual(await outcome(without.requireWebsitePlan, gatewayBody), { status: null, passed: true }, "gateway-only save");
    // Anything beyond the gateway is still Manage Website.
    assert.deepEqual(await outcome(without.requireWebsitePlan, { branding: {} }), { status: 403, passed: false });
    assert.deepEqual(await outcome(without.requireWebsitePlan, { ...gatewayBody, branding: {} }), { status: 403, passed: false });
    // REGRESSION: a gateway key riding along with POS keys skipped the add-on check.
    assert.deepEqual(await outcome(without.requireWebsitePlan, { ordering: { taxPercent: 5 }, paymentGateways: {} }), { status: 403, passed: false });
    const refused = await call(without.requirePaymentGatewayPlan, {});
    assert.equal(refused.status, 403);
    assert.match(refused.json.message, /Payment links come with the Website add-on \(₹3,600\.00 \+ GST \/ year\)/);
  }
  const withSite = load({ addons: [WEBSITE], planCode: "BILLING" });
  assert.deepEqual(await outcome(withSite.requireWebsitePlan, gatewayBody), { status: null, passed: true }, "gateway-only save");
  assert.deepEqual(await outcome(withSite.requirePaymentGatewayPlan, {}), { status: null, passed: true });

  const websiteRoute = SRC("routes", "websiteRoute.js");
  assert.match(websiteRoute, /requireOwnerOnly, validateGatewayCredentials\)/);
  assert.doesNotMatch(websiteRoute, /requirePaymentGatewayPlan/);
  assert.match(SRC("routes", "paymentLinkRoute.js"), /requirePermission\("PAYMENT_CREATE"\), requirePaymentGatewayPlan, createPaymentLink/);
  // Money already in flight is never gated.
  assert.ok(!/requirePaymentGatewayPlan, verifyAndCaptureLinkPayment/.test(SRC("routes", "paymentLinkRoute.js")));
});

test("SOURCE: the till, store properties and new tables all read the effective order toggles", () => {
  const order = SRC("controllers", "orderController.js");
  const addOrder = order.slice(order.indexOf("const addOrder = async"), order.indexOf("\n};", order.indexOf("const addOrder = async")));
  assert.match(addOrder, /const toggles = effectiveOrderToggles\(restaurant\?\.orderTypeToggles, features\);/);
  assert.match(addOrder, /if \(!features\.pos && key !== "collection"\) \{\s*return next\(createHttpError\(400, "Only Collection orders are on the Billing plan\./);
  assert.match(addOrder, /require\("\.\.\/services\/planFeatures"\)/, "lazy, inside the existing try");

  const props = SRC("controllers", "restaurantController.js");
  const getProps = props.slice(props.indexOf("const getStoreProperties"), props.indexOf("\n};", props.indexOf("const getStoreProperties")));
  assert.match(getProps, /orderTypeToggles: effectiveOrderToggles\(restaurant\.orderTypeToggles, await featuresOf\(restaurant\._id, settings\?\.storeId\)\),/);

  const sessions = SRC("controllers", "tableSessionController.js");
  const addItems = sessions.slice(sessions.indexOf("const addItemsToSession"), sessions.indexOf("\n};", sessions.indexOf("const addItemsToSession")));
  const newTable = addItems.slice(addItems.indexOf("if (!session) {"), addItems.indexOf("TableSession.create("));
  assert.match(newTable, /orderTogglesFor\(req\.user\?\.restaurantId, req\.user\?\.storeId\)\)\.table === false/, "checked before a table opens");
  assert.match(newTable, /catch \(err\) \{ console\.warn\("\[tableSession\] toggle check failed, allowing:"/, "fails open");
  assert.match(newTable, /if \(tableOff\) throw createHttpError\(400, "Table orders are currently disabled in Store Settings\."\);/);
});

test("addOrder: the Billing plan takes Collection only; the POS plan keeps the store's own switches", async () => {
  const { runAddOrder } = require("./addOrderHarness");
  const BILL = { subtotal: 105, total: 105, tax: 0, totalWithTax: 105 };
  const order = (orderType, mocks) => runAddOrder({ body: { orderType, paymentMethod: "cash", bills: BILL }, mocks });
  // Warm up with the real mongoose, so only orderController itself sees the "connected" one below.
  assert.equal((await order("Collection")).status, 201);
  const connected = Object.create(require("mongoose"), { connection: { value: { readyState: 1 } } });
  Object.defineProperty(connected, "default", { value: connected }); // orderController reads `{ default: mongoose }`
  const { effectiveOrderToggles } = load();
  const store = (pos, stored) => ({
    mongoose: connected,
    "../models/restaurantModel": { findById: async () => ({ orderTypeToggles: stored }) },
    "../services/planFeatures": { featuresOf: async () => ({ pos }), effectiveOrderToggles },
  });
  const allOn = { collection: true, delivery: true, table: true };
  for (const type of ["Collection", "takeaway"]) {
    const out = await order(type, store(false, { collection: false, delivery: true, table: true }));
    assert.equal(out.status, 201, `${type}: ${out.error?.message}`);
  }
  for (const type of ["Delivery", "dine-in", "Table Service", "online", "marketplace", "anything"]) {
    const out = await order(type, store(false, allOn));
    assert.equal(out.error?.status, 400, type);
    assert.match(out.error.message, /^(Only Collection orders are on the Billing plan\.|(Delivery|Table) orders are currently disabled)/, type);
    assert.equal(out.saved.length, 0, type);
  }
  assert.match((await order("online", store(false, allOn))).error.message, /Only Collection orders are on the Billing plan\. Upgrade in Settings → Billing & Subscription\./);
  // POS plan: the stored switches, as before.
  assert.equal((await order("online", store(true, allOn))).status, 201, "no plan rule on the POS plan");
  assert.match((await order("Delivery", store(true, { delivery: false }))).error.message, /Delivery orders are currently disabled in Store Settings\./);
});

// The owner, 2026-10-16: "everything except the Managed Website" on the ₹499 plan, with no add-on.
test("REGRESSION: the POS plan without any add-on opens tables, QR minting, diner QR, payment links, order toggles, timings and rules; Manage Website still needs the Website add-on", async () => {
  for (const planCode of ["POS", "", undefined]) {
    const pos = load({ addons: [], planCode });
    const f = await pos.featuresOf("r1");
    assert.deepEqual(
      [f.pos, f.tableQr, f.paymentGateway, f.websiteHours, f.website],
      [true, true, true, true, false],
      `${planCode}: everything but the website`,
    );
    // Manage Tables (add/edit/delete/settings) and QR minting (/api/table-qr, /api/qr/.../generate) share this gate.
    assert.deepEqual(await outcome(pos.requireTableQrPlan, {}), { status: null, passed: true }, `${planCode} tables / QR minting`);
    assert.deepEqual(await outcome(pos.requirePaymentGatewayPlan, {}), { status: null, passed: true }, `${planCode} payment links`);
    // Order Toggles & Auto-Ready, and Rules, Charges & Promotions, save through /api/website/settings.
    for (const body of [{ ordering: { autoReadyEnabled: true, autoReadyMinutes: { collection: 5 } } }, { ordering: { taxPercent: 5 } }, { couponsConfig: [] }, { freeItemConfig: [] }, { paymentGateways: {} }]) {
      assert.deepEqual(await outcome(pos.requireWebsitePlan, body), { status: null, passed: true }, `${planCode} ${JSON.stringify(body)}`);
    }
    // Manage Website's own settings stay locked without the add-on.
    for (const body of [{ enabled: true }, { branding: {} }, { holidays: [] }, { channelHours: {} }, { ordering: {}, enabled: true }, { enabled: true, version: 3 }]) {
      const refused = await call(pos.requireWebsitePlan, body);
      assert.equal(refused.status, 403, `${planCode} ${JSON.stringify(body)}`);
      assert.deepEqual([refused.json.code, refused.json.feature], ["PLAN_UPGRADE_REQUIRED", "website"]);
      assert.match(refused.json.message, /^The website is an add-on/);
    }
  }
  // Diners scanning a table QR are let in on exactly this feature.
  assert.match(SRC("middlewares", "tokenVerification.js"), /hasFeature\(req\.scope\.restaurantId, "tableQr"\)/);
  // The Billing plan is unchanged: no tables, no payment links without the Website add-on.
  const billing = await load({ addons: [], planCode: "BILLING" }).featuresOf("r1");
  assert.deepEqual(billing, { pos: false, website: false, tableQr: false, paymentGateway: false, websiteHours: false, onlineOrdering: false });
});
