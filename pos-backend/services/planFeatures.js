/**
 * What a store's add-ons unlock.
 *
 * The POS plan itself unlocks the POS. Everything below is an add-on, and a
 * store without it does not get:
 *   website  Manage Website, Website Timing & Holidays, and the storefront
 *            itself with its table booking (so "Website Enabled" is
 *            effectively OFF, whatever the stored switch says; adding the
 *            Website add-on brings it back).
 *   tableQr  Table QR ordering: diners scanning a table QR to order and pay,
 *            and minting those QRs in Manage Tables.
 *   paymentGateway  new payment links (comes with the Website add-on).
 *            Setting up the store's own gateway keys is open to every store.
 *            Money already in flight (link verify, webhooks, refunds) is never
 *            gated, so a lapsed add-on cannot strand a payment.
 * An add-on counts while it is on the subscription, not past its endsAt (a
 * stopped add-on keeps working until the period it was paid for ends) and,
 * when it has its own period (the yearly Website), not past its paidUntil: a
 * renewal the wallet could not cover switches off that add-on alone, never
 * the POS. Demo stores set in CSD (billingExempt) get everything.
 */

const mongoose = require("mongoose");
const { PlatformSubscription } = require("../models/platformSubscriptionModel");
const { getOverride, getPlatformConfig } = require("./pricing");
const { formatINR } = require("./money");

const addonLive = (subscription, feature, on) =>
  (subscription?.addons || []).some(
    (a) =>
      a.feature === feature &&
      (!a.endsAt || new Date(a.endsAt) > new Date(on)) &&
      (!a.paidUntil || new Date(a.paidUntil) > new Date(on)),
  );

// onlineOrdering: Order Toggles & Auto-Ready and Rules, Charges & Promotions
// are settings for online orders, so they come with either ordering add-on
// (Website or QR Table Ordering) and are locked on the POS plan alone.
const featuresFor = ({ subscription, exempt, on = new Date() } = {}) => {
  if (exempt) return { website: true, tableQr: true, paymentGateway: true, onlineOrdering: true };
  const website = addonLive(subscription, "website", on);
  const tableQr = addonLive(subscription, "tableQr", on);
  return { website, tableQr, paymentGateway: website, onlineOrdering: website || tableQr };
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
      PlatformSubscription.findOne({ restaurantId }).select("addons").lean(),
      getOverride(restaurantId, storeId ? { storeId } : {}),
    ]);
    return featuresFor({ subscription, exempt: override?.billingExempt })[feature];
  } catch (err) {
    console.warn(`[planFeatures] ${feature} check failed, allowing:`, err && err.message);
    return true;
  }
};

const hasWebsite = (restaurantId, storeId) => hasFeature(restaurantId, "website", storeId);

/**
 * "The website is an add-on (₹3,600.00 + GST / year)." The price and its
 * period are read from the catalogue, so the message cannot quote a price CSD
 * has since changed.
 */
const addonRequired = async (res, feature, what) => {
  let price = "";
  try {
    const config = await getPlatformConfig();
    const addon = (config.addons || []).find(
      (a) => a.isActive !== false && a.feature === (feature === "paymentGateway" ? "website" : feature),
    );
    const days = Number(addon?.periodDays) || config.subscriptionDays || 30;
    if (addon) price = ` (${formatINR(addon.pricePaise)} + GST / ${days === 365 ? "year" : `${days} days`})`;
  } catch {
    // The refusal matters, not the price in it.
  }
  return res.status(403).json({
    success: false,
    code: "PLAN_UPGRADE_REQUIRED",
    feature,
    message: `${what}${price}. Add it in Settings → Billing & Subscription.`,
    billingPath: "/settings/billing",
  });
};

const WEBSITE_MSG = "The website is an add-on";
const ONLINE_MSG = "Order toggles, rules, charges and promotions come with the Website or QR Table Ordering add-on";
const GATEWAY_MSG = "Payment links come with the Website add-on";

// Order Toggles and Rules & Charges write these through /api/website/settings;
// they run the POS, not the website, so every store keeps them.
const POS_KEYS = new Set(["ordering", "couponsConfig", "freeItemConfig"]);

/**
 * PUT /api/website/settings serves several screens. POS keys always pass; a
 * gateway-only save always passes (owner-only in the controller); anything
 * else is Manage Website and needs the website.
 */
const requireWebsitePlan = async (req, res, next) => {
  const keys = Object.keys(req.body || {});
  const rest = keys.filter((k) => !POS_KEYS.has(k));
  if (keys.length && !rest.length) {
    return (await hasFeature(req.user?.restaurantId, "onlineOrdering")) ? next() : addonRequired(res, "onlineOrdering", ONLINE_MSG);
  }
  // Every key, not just the non-POS ones: { ordering, paymentGateways } is not
  // a gateway save and must not skip the ordering add-on check.
  const gatewayOnly = keys.length > 0 && keys.every((k) => k === "paymentGateways");
  if (gatewayOnly) return next();
  if (await hasWebsite(req.user?.restaurantId)) return next();
  return addonRequired(res, "website", WEBSITE_MSG);
};

/** Opening new payment links. */
const requirePaymentGatewayPlan = async (req, res, next) =>
  (await hasFeature(req.user?.restaurantId, "paymentGateway")) ? next() : addonRequired(res, "paymentGateway", GATEWAY_MSG);

/** Minting and reprinting table QRs in Manage Tables. */
const requireOnlineOrderingPlan = async (req, res, next) =>
  (await hasFeature(req.user?.restaurantId, "onlineOrdering")) ? next() : addonRequired(res, "onlineOrdering", ONLINE_MSG);

const requireTableQrPlan = async (req, res, next) =>
  (await hasFeature(req.user?.restaurantId, "tableQr"))
    ? next()
    : addonRequired(res, "tableQr", "QR Table Ordering is an add-on");

module.exports = {
  featuresFor,
  hasFeature,
  hasWebsite,
  requireWebsitePlan,
  requireTableQrPlan,
  requireOnlineOrderingPlan,
  requirePaymentGatewayPlan,
};
