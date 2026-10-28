const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const bcrypt = require("bcrypt");

/**
 * The payment gateway is PIN-protected like Store Properties (owner,
 * 2026-10-29): a till left signed in as the owner cannot change where the
 * restaurant's money goes without the PIN.
 */
const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const owner = { _id: "507f1f77bcf86cd799439022", role: "Owner", restaurantId: RESTAURANT_ID, storeId: "123456" };

const load = async (settings) => {
  const securityPin = await bcrypt.hash("4321", 4);
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/websiteSettingsModel") return { findOne: async () => settings };
    if (r === "../models/restaurantModel") return { findOne: async () => ({ _id: RESTAURANT_ID, securityPin }), updateOne: async () => {} };
    if (r === "../models/storeModel") return {};
    if (r === "../models/mediaAssetModel") return {};
    if (r === "../services/auditService") return { logActivity: async () => {} };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  const controller = require("../controllers/websiteSettingsController");
  return { controller, restore: () => { Module._load = orig; } };
};

const run = async (handler, body) => {
  let err = null;
  let json = null;
  const res = { status: () => res, json: (j) => { json = j; } };
  await handler({ user: owner, body }, res, (e) => { err = e; });
  return { err, json };
};

const gateways = () => ({
  storeId: "123456",
  restaurantId: RESTAURANT_ID,
  version: 1,
  branding: {},
  paymentGateways: {
    activeGateway: "cashfree",
    cashfree: { clientId: "CF_APP_1", environment: "TEST", isConfigured: true },
    phonepe: { merchantId: "M1", saltIndex: "1", environment: "UAT", isConfigured: true },
  },
  save: async () => {},
});

test("switching the active gateway asks for the PIN, and takes the right one", async (t) => {
  const settings = gateways();
  const { controller, restore } = await load(settings);
  t.after(restore);

  const none = await run(controller.updateWebsiteSettings, { paymentGateways: { activeGateway: "phonepe" } });
  assert.equal(none.err?.status, 401);
  assert.equal(none.err.message, "Enter your PIN to change the payment gateway.");
  const wrong = await run(controller.updateWebsiteSettings, { paymentGateways: { activeGateway: "phonepe" }, pin: "1111" });
  assert.equal(wrong.err?.status, 401);
  assert.equal(settings.paymentGateways.activeGateway, "cashfree", "nothing changed");

  const right = await run(controller.updateWebsiteSettings, { paymentGateways: { activeGateway: "phonepe" }, pin: "4321" });
  assert.equal(right.err, null);
  assert.equal(settings.paymentGateways.activeGateway, "phonepe");
});

test("new keys need the PIN; the stored values echoed back do not", async (t) => {
  const settings = gateways();
  const { controller, restore } = await load(settings);
  t.after(restore);

  const keys = await run(controller.updateWebsiteSettings, { paymentGateways: { cashfree: { clientId: "CF_APP_2" } } });
  assert.equal(keys.err?.status, 401);
  assert.equal(settings.paymentGateways.cashfree.clientId, "CF_APP_1");

  const echo = await run(controller.updateWebsiteSettings, {
    paymentGateways: { activeGateway: "cashfree", cashfree: { clientId: "CF_APP_1", environment: "TEST" } },
  });
  assert.equal(echo.err, null, "an unchanged gateway block is not a change");
});

test("Verify & Save refuses keys without the PIN, before asking the gateway anything", async (t) => {
  const { controller, restore } = await load(gateways());
  t.after(restore);
  const out = await run(controller.validateGatewayCredentials, { gateway: "cashfree", clientId: "CF_APP_2", clientSecret: "secret-123456" });
  assert.equal(out.err?.status, 401);
  assert.equal(out.err.message, "Enter your PIN to change the payment gateway.");
});

test("a gateway save carrying the PIN is still a gateway-only save for the plan check", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "services", "planFeatures.js"), "utf8");
  assert.match(src, /const gatewayOnly = keys\.includes\("paymentGateways"\) && keys\.every\(\(k\) => k === "paymentGateways" \|\| k === "pin"\);/);
});
