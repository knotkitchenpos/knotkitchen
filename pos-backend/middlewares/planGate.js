const { ALWAYS_OPEN } = require("./accountLock");

/**
 * Gate the POS for a store on the Billing plan (planCode "BILLING"): billing
 * only. The same shape as the account lock, and it runs right after it inside
 * isVerifiedUser: auth, then 402 lock, then 403 plan, then any route PIN
 * guard. Default-deny with an allow-list, so a route added later is locked on
 * the Billing plan until someone opens it here on purpose.
 *
 * POS-plan and demo stores always pass. Add-ons are not decided here: they
 * keep their own per-route gates (services/planFeatures), on either plan.
 *
 * Models and services are required inside enforcePlan, not at the top: many
 * tests load tokenVerification with mocked models.
 */

// Open on the Billing plan: the till (Product page), Orders, Reports, Help &
// Support, Manage Cache, Device Configuration, Store Properties, Manage Menu,
// Manage Staff, Billing & Subscription and signing out. Rules & Charges and the
// store's gateway keys save through /api/website/settings (requireWebsitePlan
// decides per key); payment links need the Website add-on on this plan.
// Table sessions: a table left open when CSD's move down takes effect is still
// read, settled or closed from Orders; new tables are refused by the Table
// toggle (always off on this plan) in addItemsToSession.
const BILLING_OPEN = [ ...ALWAYS_OPEN,
  "/api/order", "/api/offline", "/api/menu", "/api/media", "/api/receipts", "/api/online-orders", "/api/table-session",
  "/api/restaurant/properties", "/api/restaurant/change-pin", "/api/restaurant/pos-settings", "/api/restaurant/staff",
  "/api/website/settings", "/api/website/validate-gateway",
  "/api/payment-link",
];
// Open on the Billing plan only with this feature (an add-on brings it).
const BILLING_WITH_ADDON = [
  ["/api/restaurant/timings", "websiteHours"], ["/api/restaurant/holidays", "websiteHours"], ["/api/restaurant/closed-for-today", "websiteHours"],
];

const matchIn = (list, path) => list.find((p) => path === p || path.startsWith(`${p}/`));
const isBillingOpen = (path) => Boolean(matchIn(BILLING_OPEN, path));

/** Applied after authentication and the account lock, so `req.user` is set. */
const enforcePlan = async (req, res, next) => {
  try {
    const restaurantId = req.user?.restaurantId;
    if (!restaurantId) return next();
    // Full path, as in the account lock: req.path is relative to the router.
    const path = `${req.baseUrl || ""}${req.path}`;
    if (isBillingOpen(path)) return next(); // no DB read
    const { PlatformSubscription } = require("../models/platformSubscriptionModel");
    const { isBilling } = require("../services/plans");
    const { featuresOf, planRequired, HOURS_MSG } = require("../services/planFeatures");
    const sub = await PlatformSubscription.findOne({ restaurantId }).select("planCode").lean();
    if (!isBilling(sub?.planCode)) return next(); // POS stores: one indexed read
    const features = await featuresOf(restaurantId, req.user.storeId);
    const addon = BILLING_WITH_ADDON.find(([p]) => path === p || path.startsWith(`${p}/`));
    if (features.pos || (addon && features[addon[1]])) return next(); // a demo store, or the add-on
    return addon ? planRequired(res, addon[1], HOURS_MSG) : planRequired(res, "pos");
  } catch (err) {
    // Fails open, like the account lock: a database hiccup must not stop a store trading.
    console.warn("[PlanGate] check failed, allowing through:", err && err.message);
    return next();
  }
};

module.exports = { enforcePlan, BILLING_OPEN, BILLING_WITH_ADDON, isBillingOpen };
