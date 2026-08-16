const WebsiteSettings = require("../models/websiteSettingsModel");
const { generateUniqueSlug } = require("./slugService");
const { DEFAULT_THEME_KEY, getDefaultTheme } = require("./themeRegistry");
const config = require("../config/config");

/**
 * Automatic website provisioning (§35, §36).
 *
 * Called whenever a store comes into existence — from the admin portal's
 * createStore, from POS store signup, and from the backfill script. It is
 * IDEMPOTENT: calling it repeatedly for the same storeId returns the existing
 * configuration instead of creating duplicates or churning the slug (which
 * would break links that customers have already saved).
 */

const DEFAULT_OPENING_HOURS = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  isOpen: true,
  openTime: "09:00",
  closeTime: "22:00",
}));

/**
 * @param {object} params
 *   storeId      {string}  required — permanent 6-digit id
 *   storeName    {string}  used for slug + display name
 *   restaurantId {ObjectId}
 *   currency/currencySymbol/contact — optional seed values
 * @param {object} deps  { Model } injectable for tests
 */
const provisionWebsiteForStore = async (params, deps = {}) => {
  const Model = deps.Model || WebsiteSettings;
  const { storeId, storeName, restaurantId, outletId, currency, currencySymbol, contact } = params || {};

  if (!storeId) throw new Error("provisionWebsiteForStore: storeId is required");

  // Already provisioned → return as-is (idempotent).
  const existing = await Model.findOne({ storeId: String(storeId), isDeleted: { $ne: true } });
  if (existing) return existing;

  const slug = await generateUniqueSlug(storeName || `store-${storeId}`, String(storeId), { Model });
  const themeDefaults = (getDefaultTheme() || {}).defaults || {};

  const doc = {
    storeId: String(storeId),
    restaurantId: restaurantId || undefined,
    outletId: outletId || null,
    slug,
    // Reserved for future DNS automation; the resolver already understands it.
    subdomain: config.storefrontRootDomain ? `${slug}.${config.storefrontRootDomain}` : "",
    customDomain: "",
    enabled: true,
    displayName: storeName || "",
    branding: {
      siteTitle: storeName ? `${storeName} — Order Online` : "Order Online",
      siteDescription: storeName
        ? `Order delicious food online from ${storeName}. Fast pickup and delivery.`
        : "",
      tagline: "Freshly prepared, delivered to you.",
      aboutText: "",
    },
    theme: {
      themeKey: DEFAULT_THEME_KEY,
      ...(themeDefaults.colors ? { colors: themeDefaults.colors } : {}),
      ...(themeDefaults.typography ? { typography: themeDefaults.typography } : {}),
      ...(themeDefaults.layout ? { layout: themeDefaults.layout } : {}),
    },
    ordering: {
      pickupEnabled: true,
      deliveryEnabled: false,
      currency: currency || "INR",
      currencySymbol: currencySymbol || (currency === "GBP" ? "£" : currency === "USD" ? "$" : "₹"),
    },
    contact: contact || {},
    openingHours: DEFAULT_OPENING_HOURS,
    useBusinessHours: false, // opt-in, so a new store is never accidentally "closed"
    status: "published",
    publishedAt: new Date(),
  };

  try {
    return await Model.create(doc);
  } catch (err) {
    // Race: another request provisioned the same store between our findOne and
    // create. Return the winner rather than surfacing a duplicate key error.
    if (err && err.code === 11000) {
      const winner = await Model.findOne({ storeId: String(storeId) });
      if (winner) return winner;
    }
    throw err;
  }
};

/** Build the public URL for a storefront (§18). */
const buildStorefrontUrl = (settings) => {
  if (!settings) return "";
  if (settings.customDomain) return `https://${settings.customDomain}`;
  if (settings.subdomain && config.storefrontRootDomain) return `https://${settings.subdomain}`;
  return `${config.storefrontBaseUrl}/store/${settings.slug}`;
};

module.exports = { provisionWebsiteForStore, buildStorefrontUrl, DEFAULT_OPENING_HOURS };
