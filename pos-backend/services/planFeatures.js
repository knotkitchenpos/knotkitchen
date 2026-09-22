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
 * Demo stores set in CSD (billingExempt) get everything.
 */

const mongoose = require("mongoose");
const { PlatformSubscription } = require("../models/platformSubscriptionModel");
const { getOverride } = require("./pricing");

const FULL_PLANS = new Set(["GROWTH", "SCALE"]);

// CSD saves plan codes lowercased; the seeded catalogue is uppercase.
const featuresFor = ({ planCode, exempt }) => {
  const full = Boolean(exempt) || FULL_PLANS.has(String(planCode || "").toUpperCase());
  return { website: full, tableQr: full };
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

const upgradeRequired = (res, feature, what) =>
  res.status(403).json({
    success: false,
    code: "PLAN_UPGRADE_REQUIRED",
    feature,
    message: `${what} is included in the Growth and Scale plans. Upgrade in Settings → Billing & Subscription.`,
    billingPath: "/settings/billing",
  });

// Order Toggles and Rules & Charges write these through /api/website/settings;
// they run the POS, not the website, so every plan keeps them.
const NOT_WEBSITE = new Set(["ordering", "couponsConfig", "freeItemConfig"]);

const requireWebsitePlan = async (req, res, next) => {
  const keys = Object.keys(req.body || {});
  if (keys.length && keys.every((k) => NOT_WEBSITE.has(k))) return next();
  if (await hasWebsite(req.user?.restaurantId)) return next();
  return upgradeRequired(res, "website", "The website");
};

/** Minting and reprinting table QRs in Manage Tables. */
const requireTableQrPlan = async (req, res, next) =>
  (await hasFeature(req.user?.restaurantId, "tableQr")) ? next() : upgradeRequired(res, "tableQr", "Table QR ordering");

module.exports = { FULL_PLANS, featuresFor, hasFeature, hasWebsite, requireWebsitePlan, requireTableQrPlan };
