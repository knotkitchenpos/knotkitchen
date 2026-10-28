/**
 * What a store's plan and add-ons unlock. Three separate things: the plan
 * (core features, here), the add-ons (here), and Rules & Charges (open on
 * every plan; charges apply at bill time whatever the plan).
 *
 * The plan (PlatformSubscription.planCode; "" or unknown is the POS plan):
 *   pos      The POS plan: the whole POS. The Billing plan ("BILLING") is
 *            billing only: middlewares/planGate refuses everything outside
 *            its allow-list, and the order toggles read Collection only
 *            (effectiveOrderToggles), never written, so an upgrade restores
 *            the store's own switches.
 *   tableQr  = pos. Manage Tables, table orders, diners scanning a table QR
 *            to order and pay, and minting those QRs. Part of the POS plan
 *            since 2026-10-16; the QR Table Ordering add-on (TABLE_QR) that
 *            used to unlock it is retired (services/subscription retired).
 *   paymentGateway  new payment links: the POS plan, or the Website add-on on
 *            the Billing plan. Setting up the store's own gateway keys is open
 *            to every store. Money already in flight (link verify, webhooks,
 *            refunds) is never gated, so a lapsed add-on cannot strand a payment.
 *   websiteHours  Website Timing & Holidays: the POS plan, or the Website
 *            add-on on the Billing plan (its site would otherwise be stuck
 *            on the default hours).
 *   onlineOrdering  = pos. Compatibility only, for installed app builds that
 *            still lock on it; no server gate reads it.
 * The one add-on that unlocks something, on either plan:
 *   website  Manage Website and the storefront itself with its table booking
 *            (so "Website Enabled" is effectively OFF, whatever the stored
 *            switch says; adding the Website add-on brings it back).
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
const { isBilling } = require("./plans");

const addonLive = (subscription, feature, on) =>
  (subscription?.addons || []).some(
    (a) =>
      a.feature === feature &&
      (!a.endsAt || new Date(a.endsAt) > new Date(on)) &&
      (!a.paidUntil || new Date(a.paidUntil) > new Date(on)),
  );

const ALL_FEATURES = Object.freeze({ pos: true, website: true, tableQr: true, paymentGateway: true, websiteHours: true, onlineOrdering: true });

const featuresFor = ({ subscription, exempt, on = new Date() } = {}) => {
  if (exempt) return { ...ALL_FEATURES };
  const pos = !isBilling(subscription?.planCode);
  const website = addonLive(subscription, "website", on);
  return { pos, website, tableQr: pos, paymentGateway: pos || website, websiteHours: pos || website, onlineOrdering: pos };
};

/**
 * Fails open, like the account lock: a database hiccup must not take a paying
 * restaurant's website down. (Also keeps tests with mocked models off the DB.)
 */
// ponytail: two indexed reads per storefront call; cache per restaurant if storefront traffic makes it matter.
const featuresOf = async (restaurantId, storeId) => {
  if (!restaurantId || mongoose.connection?.readyState !== 1) return { ...ALL_FEATURES };
  try {
    const [subscription, override] = await Promise.all([
      PlatformSubscription.findOne({ restaurantId }).select("addons planCode").lean(),
      getOverride(restaurantId, storeId ? { storeId } : {}),
    ]);
    return featuresFor({ subscription, exempt: override?.billingExempt });
  } catch (err) {
    console.warn("[planFeatures] check failed, allowing:", err && err.message);
    return { ...ALL_FEATURES };
  }
};

const hasFeature = async (restaurantId, feature, storeId) => (await featuresOf(restaurantId, storeId))[feature];

const hasWebsite = (restaurantId, storeId) => hasFeature(restaurantId, "website", storeId);

/** The order types the till may take: the stored switches, but Collection only on the Billing plan. */
const effectiveOrderToggles = (stored, features) =>
  features?.pos === false
    ? { collection: true, delivery: false, table: false }
    : { collection: stored?.collection !== false, delivery: stored?.delivery !== false, table: stored?.table !== false };

/** effectiveOrderToggles for a store, read now. Fails open (all on), like featuresOf. */
const orderTogglesFor = async (restaurantId, storeId) => {
  try {
    const Restaurant = require("../models/restaurantModel");
    const [restaurant, features] = await Promise.all([
      restaurantId && mongoose.connection?.readyState === 1
        ? Restaurant.findById(restaurantId).select("orderTypeToggles").lean()
        : null,
      featuresOf(restaurantId, storeId),
    ]);
    return effectiveOrderToggles(restaurant?.orderTypeToggles, features);
  } catch (err) {
    console.warn("[planFeatures] order toggles check failed, allowing:", err && err.message);
    return { collection: true, delivery: true, table: true };
  }
};

const PLAN_MSG = "This is not on the Billing plan. Upgrade to the POS plan in Settings → Billing & Subscription.";
const HOURS_MSG = "Website Timing & Holidays come with the Website add-on or the POS plan. Add one in Settings → Billing & Subscription.";

/** Refused by the plan, not an add-on: the Billing plan needs an upgrade. */
const planRequired = (res, feature, message = PLAN_MSG) =>
  res.status(403).json({ success: false, code: "PLAN_UPGRADE_REQUIRED", feature, upgradeTo: "POS", message, billingPath: "/settings/billing" });

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
const GATEWAY_MSG = "Payment links come with the Website add-on";

// Rules & Charges and Order Toggles' auto-ready settings write these through
// /api/website/settings; they run the POS, not the website, so they need no
// add-on. Rules & Charges is open on every plan.
const POS_KEYS = new Set(["ordering", "couponsConfig", "freeItemConfig"]);
const AUTO_READY_KEYS = ["autoReadyEnabled", "autoReadyMinutes", "autoCompleteMinutes"]; // Order Toggles & Auto-Ready

/**
 * PUT /api/website/settings serves several screens. The auto-ready keys need
 * the POS plan whatever else the body carries (stored values keep applying on
 * the Billing plan; only writing them is refused) -- unless it is a
 * whole-document save (Manage Website echoes `version`), which never writes
 * ordering. Other POS keys pass; a gateway-only save always passes (owner-only
 * in the controller); anything else is Manage Website and needs the website.
 */
const requireWebsitePlan = async (req, res, next) => {
  const body = req.body || {};
  const keys = Object.keys(body);
  const autoReady = body.version === undefined && Object.keys(body.ordering || {}).some((k) => AUTO_READY_KEYS.includes(k));
  if (autoReady && !(await hasFeature(req.user?.restaurantId, "pos"))) return planRequired(res, "pos");
  if (keys.length && keys.every((k) => POS_KEYS.has(k))) return next(); // Rules, Charges & Promotions: every plan
  // Every key, not just the non-POS ones: { ordering, paymentGateways } is not
  // a gateway save and must not skip the website check. The owner's PIN rides
  // along with a gateway change (websiteSettingsController, gatewayPinOk).
  const gatewayOnly = keys.includes("paymentGateways") && keys.every((k) => k === "paymentGateways" || k === "pin");
  if (gatewayOnly) return next();
  if (await hasWebsite(req.user?.restaurantId)) return next();
  return addonRequired(res, "website", WEBSITE_MSG);
};

/** Opening new payment links: the POS plan, or the Website add-on on the Billing plan. */
const requirePaymentGatewayPlan = async (req, res, next) =>
  (await hasFeature(req.user?.restaurantId, "paymentGateway")) ? next() : addonRequired(res, "paymentGateway", GATEWAY_MSG);

/** Managing tables and minting table QRs: the POS plan (no add-on since 2026-10-16). */
const requireTableQrPlan = async (req, res, next) =>
  (await hasFeature(req.user?.restaurantId, "tableQr")) ? next() : planRequired(res, "tableQr");

module.exports = {
  featuresFor,
  featuresOf,
  hasFeature,
  hasWebsite,
  effectiveOrderToggles,
  orderTogglesFor,
  planRequired,
  PLAN_MSG,
  HOURS_MSG,
  ALL_FEATURES,
  requireWebsitePlan,
  requireTableQrPlan,
  requirePaymentGatewayPlan,
};
