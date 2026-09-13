const WebsiteSettings = require("../models/websiteSettingsModel");
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
 * @param {object} params { identifier, host }
 * @returns {Promise<{ok:boolean, status?:number, reason?:string, settings?, store?, restaurant?, restaurantId?, storeId?, timezone?}>}
 */
const resolveStorefront = async ({ identifier, host } = {}) => {
  let settings = await findSettingsByIdentifier(identifier);

  // Host-based resolution (future subdomain/custom domain deployments).
  if (!settings && host) settings = await findSettingsByHost(host);

  if (!settings) return { ok: false, status: 404, reason: "STORE_NOT_FOUND" };

  const store = await Store.findOne({ storeId: settings.storeId, isDeleted: { $ne: true } });
  if (!store) return { ok: false, status: 404, reason: "STORE_NOT_FOUND" };

  // A store suspended/closed by the platform admin must not serve a storefront,
  // regardless of the restaurant's own website toggle.
  if (["suspended", "deleted", "pending"].includes(store.status)) {
    return { ok: false, status: 403, reason: "STORE_UNAVAILABLE", settings, store };
  }
  if (store.status === "closed_temporarily") {
    return { ok: false, status: 403, reason: "STORE_CLOSED", settings, store };
  }
  if (store.status === "closed_until" && store.closedUntil && new Date(store.closedUntil) > new Date()) {
    return { ok: false, status: 403, reason: "STORE_CLOSED", settings, store };
  }

  // Restaurant-controlled website switch (§20).
  if (!settings.enabled) {
    return { ok: false, status: 403, reason: "WEBSITE_DISABLED", settings, store };
  }

  const restaurantId = settings.restaurantId || store.restaurantId;
  const restaurant = restaurantId ? await Restaurant.findById(restaurantId) : null;

  if (restaurant && (restaurant.isActive === false || restaurant.isDeleted)) {
    return { ok: false, status: 403, reason: "STORE_UNAVAILABLE", settings, store };
  }

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

/** Friendly, non-leaking messages for each failure reason. */
const REASON_MESSAGES = {
  STORE_NOT_FOUND: "We couldn't find this restaurant.",
  STORE_UNAVAILABLE: "Online ordering is currently unavailable. Please try again later.",
  STORE_CLOSED: "This restaurant is temporarily closed. Please try again later.",
  WEBSITE_DISABLED: "Online ordering is currently unavailable. Please try again later.",
};

module.exports = { resolveStorefront, findSettingsByIdentifier, findSettingsByHost, REASON_MESSAGES };
