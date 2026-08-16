const WebsiteSettings = require("../models/websiteSettingsModel");

// Words that would collide with existing/planned platform routes if used as a
// storefront slug (e.g. /store/api). Reserved regardless of availability.
const RESERVED_SLUGS = new Set([
  "api", "admin", "auth", "login", "logout", "signup", "register", "store",
  "stores", "storefront", "www", "app", "dashboard", "pos", "kds", "orders",
  "order", "menu", "media", "settings", "static", "assets", "public", "help",
  "support", "about", "contact", "terms", "privacy", "checkout", "cart", "pay",
]);

/**
 * Convert an arbitrary store name into a URL-safe slug.
 *   "ABC Restaurant & Café!" -> "abc-restaurant-cafe"
 * Diacritics are folded, non-alphanumerics collapse to single hyphens.
 */
const slugify = (value) => {
  const base = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
  return base;
};

const isValidSlug = (slug) =>
  typeof slug === "string" && /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/.test(slug);

/**
 * Generate a slug that is unique across all storefronts.
 *
 * Collision strategy:
 *   1. "abc-restaurant"
 *   2. "abc-restaurant-2", "-3", ... (up to 50)
 *   3. fall back to "abc-restaurant-<storeId>" which is guaranteed unique
 *      because storeId itself is unique.
 *
 * @param {string} name      store/restaurant display name
 * @param {string} storeId   permanent 6-digit store id (used as final fallback)
 * @param {object} deps      { Model } — injectable for tests
 */
const generateUniqueSlug = async (name, storeId, deps = {}) => {
  const Model = deps.Model || WebsiteSettings;
  let base = slugify(name);

  // Empty or reserved base (e.g. a store literally named "Admin") gets prefixed.
  if (!base || base.length < 2 || RESERVED_SLUGS.has(base)) {
    base = base ? `${base}-store` : `store-${storeId}`;
  }

  const existing = await Model.findOne({ slug: base, isDeleted: { $ne: true } });
  if (!existing) return base;
  // Re-provisioning the same store must be idempotent, not create a new slug.
  if (existing.storeId === storeId) return base;

  for (let i = 2; i <= 50; i += 1) {
    const candidate = `${base}-${i}`;
    if (RESERVED_SLUGS.has(candidate)) continue;
    const taken = await Model.findOne({ slug: candidate, isDeleted: { $ne: true } });
    if (!taken) return candidate;
    if (taken.storeId === storeId) return candidate;
  }

  return `${base}-${storeId}`;
};

module.exports = { slugify, isValidSlug, generateUniqueSlug, RESERVED_SLUGS };
