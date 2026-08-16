const WebsiteSettings = require("../models/websiteSettingsModel");

/**
 * Automatic storefront provisioning for newly registered stores (§35).
 *
 * ⚠️  Must stay behaviourally in sync with
 *     pos-backend/services/websiteProvisioningService.js
 * (both write the same shared WebsiteSettings collection).
 *
 * Idempotent: re-running for an existing storeId returns the existing document
 * rather than creating a duplicate or changing the public slug.
 */

const RESERVED_SLUGS = new Set([
  "api", "admin", "auth", "login", "logout", "signup", "register", "store",
  "stores", "storefront", "www", "app", "dashboard", "pos", "kds", "orders",
  "order", "menu", "media", "settings", "static", "assets", "public", "help",
  "support", "about", "contact", "terms", "privacy", "checkout", "cart", "pay",
]);

const slugify = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);

const generateUniqueSlug = async (name, storeId) => {
  let base = slugify(name);
  if (!base || base.length < 2 || RESERVED_SLUGS.has(base)) {
    base = base ? `${base}-store` : `store-${storeId}`;
  }

  const existing = await WebsiteSettings.findOne({ slug: base, isDeleted: { $ne: true } });
  if (!existing) return base;
  if (existing.storeId === String(storeId)) return base;

  for (let i = 2; i <= 50; i += 1) {
    const candidate = `${base}-${i}`;
    if (RESERVED_SLUGS.has(candidate)) continue;
    const taken = await WebsiteSettings.findOne({ slug: candidate, isDeleted: { $ne: true } });
    if (!taken || taken.storeId === String(storeId)) return candidate;
  }

  return `${base}-${storeId}`;
};

const DEFAULT_OPENING_HOURS = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  isOpen: true,
  openTime: "09:00",
  closeTime: "22:00",
}));

// Default theme — mirrors themeRegistry's "default-restaurant" defaults.
const DEFAULT_THEME = {
  themeKey: "default-restaurant",
  colors: {
    primary: "#e2571e",
    secondary: "#0d1526",
    accent: "#f5a524",
    background: "#ffffff",
    surface: "#f7f8fa",
    text: "#12161f",
    muted: "#6b7280",
    button: "#e2571e",
    buttonText: "#ffffff",
  },
  typography: { headingFont: "Poppins", bodyFont: "Inter", baseSize: 16 },
  layout: {
    heroStyle: "classic",
    productCardStyle: "grid",
    categoryNavStyle: "pills",
    productImagePosition: "top",
    buttonStyle: "rounded",
    headerStyle: "standard",
    footerStyle: "standard",
  },
  sections: {
    showOffers: true,
    showAbout: true,
    showContact: true,
    showGallery: false,
    showHours: true,
  },
};

const provisionWebsiteForStore = async ({ storeId, storeName, restaurantId, contact, currency }) => {
  if (!storeId) throw new Error("provisionWebsiteForStore: storeId is required");

  const existing = await WebsiteSettings.findOne({ storeId: String(storeId), isDeleted: { $ne: true } });
  if (existing) return existing;

  const slug = await generateUniqueSlug(storeName || `store-${storeId}`, String(storeId));
  const rootDomain = process.env.STOREFRONT_ROOT_DOMAIN || "";

  try {
    return await WebsiteSettings.create({
      storeId: String(storeId),
      restaurantId,
      slug,
      subdomain: rootDomain ? `${slug}.${rootDomain}` : "",
      enabled: true,
      displayName: storeName || "",
      branding: {
        siteTitle: storeName ? `${storeName} — Order Online` : "Order Online",
        siteDescription: storeName
          ? `Order delicious food online from ${storeName}. Fast pickup and delivery.`
          : "",
        tagline: "Freshly prepared, delivered to you.",
        aboutText: "",
        logo: {}, favicon: {}, coverImage: {},
      },
      theme: DEFAULT_THEME,
      ordering: {
        pickupEnabled: true,
        deliveryEnabled: false,
        currency: currency || "INR",
        currencySymbol: currency === "GBP" ? "£" : currency === "USD" ? "$" : "₹",
        acceptPreOrders: true,
        prepTimeMinutes: 30,
        specialInstructionsEnabled: true,
      },
      contact: contact || {},
      openingHours: DEFAULT_OPENING_HOURS,
      useBusinessHours: false,
      status: "published",
      publishedAt: new Date(),
    });
  } catch (err) {
    // Concurrent provisioning race — return the winning document.
    if (err && err.code === 11000) {
      const winner = await WebsiteSettings.findOne({ storeId: String(storeId) });
      if (winner) return winner;
    }
    throw err;
  }
};

const buildStorefrontUrl = (settings) => {
  if (!settings) return "";
  if (settings.customDomain) return `https://${settings.customDomain}`;
  const rootDomain = process.env.STOREFRONT_ROOT_DOMAIN || "";
  if (settings.subdomain && rootDomain) return `https://${settings.subdomain}`;
  const base = (process.env.STOREFRONT_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
  return `${base}/store/${settings.slug}`;
};

module.exports = { provisionWebsiteForStore, buildStorefrontUrl, slugify, generateUniqueSlug };
