/**
 * What each plan unlocks.
 *
 * Growth and Scale unlock everything. Essential, Connect and a store with no
 * plan do not get:
 *   website  Manage Website, Website Timing & Holidays, and the storefront
 *            itself with its table booking (so "Website Enabled" is
 *            effectively OFF on them, whatever the stored switch says;
 *            upgrading brings it back).
 *   tableQr  Table QR ordering: diners scanning a table QR to order and pay,
 *            and minting those QRs in Manage Tables.
 * And Essential (the first plan), or no plan, does not get:
 *   paymentGateway  the store's own online payments: setting up its
 *            Cashfree / PhonePe keys, and new payment links. Connect has it.
 *            Money already in flight (link verify, webhooks, refunds) is
 *            never gated, so a downgrade cannot strand a payment.
 * Demo stores set in CSD (billingExempt) get everything.
 */

const mongoose = require("mongoose");
const { PlatformSubscription } = require("../models/platformSubscriptionModel");
const { getOverride } = require("./pricing");

const FULL_PLANS = new Set(["GROWTH", "SCALE"]);
const GATEWAY_PLANS = new Set(["CONNECT", "GROWTH", "SCALE"]);

// CSD saves plan codes lowercased; the seeded catalogue is uppercase.
const featuresFor = ({ planCode, exempt }) => {
  const code = String(planCode || "").toUpperCase();
  const full = Boolean(exempt) || FULL_PLANS.has(code);
  return { website: full, tableQr: full, paymentGateway: Boolean(exempt) || GATEWAY_PLANS.has(code) };
};

/**
 * Fails open, like the account lock: a database hiccup must not take a paying
 * restaurant's website down. (Also keeps tests with mocked models off the DB.)
 */
// ponytail: two indexed reads per storefront call; cache per restaurant if storefront traffic makes it matter.
const hasFeature = async (restaurantId, feature, storeId) => {
  if (!restaurantId || mongoose.connection?.readyState !== 1) return true;
  try {
    const [subscription, override] = await Promise.all([
      PlatformSubscription.findOne({ restaurantId }).select("planCode").lean(),
      getOverride(restaurantId, storeId ? { storeId } : {}),
    ]);
    return featuresFor({ planCode: subscription?.planCode, exempt: override?.billingExempt })[feature];
  } catch (err) {
    console.warn(`[planFeatures] ${feature} check failed, allowing:`, err && err.message);
    return true;
  }
};

const hasWebsite = (restaurantId, storeId) => hasFeature(restaurantId, "website", storeId);

const upgradeRequired = (res, feature, message) =>
  res.status(403).json({
    success: false,
    code: "PLAN_UPGRADE_REQUIRED",
    feature,
    message: `${message} Upgrade in Settings → Billing & Subscription.`,
    billingPath: "/settings/billing",
  });

const WEBSITE_MSG = "The website is included in the Growth and Scale plans.";
const GATEWAY_MSG = "Online payments (payment gateway) are not included in the Essential plan.";

// Order Toggles and Rules & Charges write these through /api/website/settings;
// they run the POS, not the website, so every plan keeps them.
const POS_KEYS = new Set(["ordering", "couponsConfig", "freeItemConfig"]);

/**
 * PUT /api/website/settings serves several screens. POS keys pass on any
 * plan; a gateway-only save needs the paymentGateway feature; anything else
 * is Manage Website and needs the website.
 */
const requireWebsitePlan = async (req, res, next) => {
  const keys = Object.keys(req.body || {});
  const rest = keys.filter((k) => !POS_KEYS.has(k));
  if (keys.length && !rest.length) return next();
  const gatewayOnly = rest.length > 0 && rest.every((k) => k === "paymentGateways");
  if (gatewayOnly) {
    return (await hasFeature(req.user?.restaurantId, "paymentGateway")) ? next() : upgradeRequired(res, "paymentGateway", GATEWAY_MSG);
  }
  if (await hasWebsite(req.user?.restaurantId)) return next();
  return upgradeRequired(res, "website", WEBSITE_MSG);
};

/** Saving gateway keys, and opening new payment links. */
const requirePaymentGatewayPlan = async (req, res, next) =>
  (await hasFeature(req.user?.restaurantId, "paymentGateway")) ? next() : upgradeRequired(res, "paymentGateway", GATEWAY_MSG);

/** Minting and reprinting table QRs in Manage Tables. */
const requireTableQrPlan = async (req, res, next) =>
  (await hasFeature(req.user?.restaurantId, "tableQr"))
    ? next()
    : upgradeRequired(res, "tableQr", "Table QR ordering is included in the Growth and Scale plans.");

module.exports = {
  FULL_PLANS,
  GATEWAY_PLANS,
  featuresFor,
  hasFeature,
  hasWebsite,
  requireWebsitePlan,
  requireTableQrPlan,
  requirePaymentGatewayPlan,
};
