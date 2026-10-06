const WebsiteSettings = require("../models/websiteSettingsModel");
const { applyPublishedSnapshot } = require("./websitePublish");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const config = require("../config/config");

/**
 * Storefront tenant resolver (§18, §37).
 *
 * A single entry point that turns an incoming public request into a fully
 * resolved tenant context. Today the identifier arrives as a path parameter
 * (/store/:slug); tomorrow it can arrive as a Host header. Because every
 * consumer calls resolveStorefront() rather than querying WebsiteSettings
 * directly, adding subdomain/custom-domain support required no changes to any
 * controller — only the lookup order below.
 *
 * Resolution order:
 *   1. customDomain  (www.abcrestaurant.com)
 *   2. subdomain     (abc-restaurant.knotkitchen.com)
 *   3. slug          (/store/abc-restaurant)
 *   4. storeId       (/store/482193) — legacy/QR-friendly numeric fallback
 */

const findSettingsByIdentifier = async (identifier) => {
  if (!identifier) return null;
  const value = String(identifier).trim().toLowerCase();
  if (!value || value.length > 120) return null;

  // Numeric → permanent store id. Keeps existing /store/482193 links working.
  if (/^\d{6}$/.test(value)) {
    return WebsiteSettings.findOne({ storeId: value, isDeleted: { $ne: true } });
  }

  return WebsiteSettings.findOne({ slug: value, isDeleted: { $ne: true } });
};

const findSettingsByHost = async (host) => {
  if (!host) return null;
  const hostname = String(host).split(":")[0].toLowerCase();

  // 1. Match customDomain (e.g. www.restaurant.com -> restaurant.com)
  const byCustomDomain = await WebsiteSettings.findOne({
    customDomain: hostname.replace(/^www\./, ""),
    isDeleted: { $ne: true },
  });
  if (byCustomDomain) return byCustomDomain;

  // 2. Match exact subdomain field
  const bySubdomain = await WebsiteSettings.findOne({ subdomain: hostname, isDeleted: { $ne: true } });
  if (bySubdomain) return bySubdomain;

  // 3. Match StoreID.<base> or <slug>.<base>, where <base> is whichever base
  // domain(s) this deployment is actually served under (BASE_DOMAIN / legacy
  // fallbacks), so a fresh deployment under a new domain works with zero code
  // changes — only an env var.
  // `knotkitchen.com` stays listed so the platform domain resolves even if
  // BASE_DOMAIN is unset.
  const bases = [
    config.baseDomain,
    "knotkitchen.com",
    "localhost",
  ].filter(Boolean);
  const baseSuffix = bases.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const subMatch = baseSuffix ? hostname.match(new RegExp(`^([a-z0-9-]+)\\.(?:${baseSuffix})$`, "i")) : null;
  if (subMatch) {
    const sub = subMatch[1];
    if (/^\d{6}$/.test(sub)) {
      return WebsiteSettings.findOne({ storeId: sub, isDeleted: { $ne: true } });
    }
    return WebsiteSettings.findOne({ slug: sub, isDeleted: { $ne: true } });
  }

  return null;
};

/**
 * Resolve the full storefront context.
 *
 * `honourPaid` is for settling a checkout the customer has ALREADY paid: the
 * store is found but none of the "unavailable" refusals apply (closed, locked,
 * website off). Money taken online is always honoured with the order; only new
 * checkouts are refused.
 *
 * `knotEats` skips only the website checks (switch and Website add-on): Knot
 * Eats sells without the website. Store status and the account lock still apply.
 *
 * @param {object} params { identifier, host, honourPaid, knotEats }
 * @returns {Promise<{ok:boolean, status?:number, reason?:string, settings?, store?, restaurant?, restaurantId?, storeId?, timezone?}>}
 */
const resolveStorefront = async ({ identifier, host, honourPaid = false, knotEats = false } = {}) => {
  let settings = await findSettingsByIdentifier(identifier);

  // Host-based resolution (future subdomain/custom domain deployments).
  if (!settings && host) settings = await findSettingsByHost(host);

  if (!settings) return { ok: false, status: 404, reason: "STORE_NOT_FOUND" };

  // The public site shows what was last published from Manage Cache, not the
  // Manage Website draft. Operational fields (enabled, hours, gateways) stay
  // live; see PUBLISHED_FIELDS.
  applyPublishedSnapshot(settings);

  const store = await Store.findOne({ storeId: settings.storeId, isDeleted: { $ne: true } });
  if (!store) return { ok: false, status: 404, reason: "STORE_NOT_FOUND" };

  const restaurantId = settings.restaurantId || store.restaurantId;
  const restaurant = restaurantId ? await Restaurant.findById(restaurantId) : null;
  const refusal = honourPaid ? null : await unavailableReason({ settings, store, restaurant, restaurantId, knotEats });
  if (refusal) return { ok: false, status: 403, ...refusal, settings, store };

  return {
    ok: true,
    settings,
    store,
    restaurant,
    restaurantId: restaurantId || null,
    outletId: settings.outletId || null,
    storeId: settings.storeId,
    timezone: restaurant?.timezone || "Asia/Kolkata",
  };
};

/** Why this store may not serve its website or take a new order, or null. */
const unavailableReason = async ({ settings, store, restaurant, restaurantId, knotEats = false }) => {
  // A store suspended/closed by the platform admin must not serve a storefront,
  // regardless of the restaurant's own website toggle.
  if (["suspended", "deleted", "pending", "closed"].includes(store.status)) {
    return { reason: "STORE_UNAVAILABLE" };
  }
  if (store.status === "closed_temporarily") return { reason: "STORE_CLOSED" };
  if (store.status === "closed_until" && store.closedUntil && new Date(store.closedUntil) > new Date()) {
    return { reason: "STORE_CLOSED" };
  }

  // Knot Eats sells without the website (no Website add-on, switch off); set
  // only by the Eats routes (routes/knotEatsRoute viaKnotEats), always with the
  // listing check.
  if (!knotEats) {
    // Restaurant-controlled website switch (§20).
    if (!settings.enabled) return { reason: "WEBSITE_DISABLED" };

    // The add-ons decide too: the website is the Website add-on, so without it
    // the site is off whatever the switch says.
    // Required here, for the same reason as accountLock below.
    const { hasWebsite } = require("./planFeatures");
    if (!(await hasWebsite(restaurantId, settings.storeId))) return { reason: "WEBSITE_DISABLED" };
  }

  if (restaurant && (restaurant.isActive === false || restaurant.isDeleted)) {
    return { reason: "STORE_UNAVAILABLE" };
  }

  // Locked (unpaid past the grace period, or never activated): the website is
  // down, and with it ordering and table booking. `locked` lets a client say
  // "temporarily unavailable" rather than "not found".
  // Required here: accountLock pulls in billing services this module must not
  // load for every storefront import.
  const { isOrderingLocked } = require("./accountLock");
  if (await isOrderingLocked(restaurantId)) return { reason: "STORE_UNAVAILABLE", locked: true };

  return null;
};

/** Friendly, non-leaking messages for each failure reason. */
const REASON_MESSAGES = {
  STORE_NOT_FOUND: "We couldn't find this restaurant.",
  STORE_UNAVAILABLE: "This restaurant's online store is temporarily unavailable. Please try again later.",
  STORE_CLOSED: "This restaurant is temporarily closed. Please try again later.",
  WEBSITE_DISABLED: "Online ordering is currently unavailable. Please try again later.",
};

module.exports = { resolveStorefront, findSettingsByIdentifier, findSettingsByHost, unavailableReason, REASON_MESSAGES };
