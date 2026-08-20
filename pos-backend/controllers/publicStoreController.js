const createHttpError = require("http-errors");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const Menu = require("../models/menuModel");
const { resolveStorefront, REASON_MESSAGES } = require("../services/storefrontResolver");

const getPublicStoreInfo = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    if (!storeId || !/^\d{6}$/.test(String(storeId).trim())) {
      const error = createHttpError(400, "Invalid 6-digit Store ID format.");
      return next(error);
    }

    const store = await Store.findOne({
      storeId: String(storeId).trim(),
      isDeleted: { $ne: true },
    });

    if (!store) {
      const error = createHttpError(404, "Store not found.");
      return next(error);
    }

    let restaurant = null;
    if (store.restaurantId) {
      restaurant = await Restaurant.findById(store.restaurantId);
    }

    res.status(200).json({
      success: true,
      data: {
        storeId: store.storeId,
        storeName: store.storeName,
        ownerName: store.ownerName,
        status: store.status,
        currency: restaurant?.currency || "GBP",
        address: restaurant?.address || {},
        branding: restaurant?.branding || {},
      },
    });
  } catch (error) {
    next(error);
  }
};

const getPublicStoreMenu = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    if (!storeId || !/^\d{6}$/.test(String(storeId).trim())) {
      const error = createHttpError(400, "Invalid 6-digit Store ID format.");
      return next(error);
    }

    const store = await Store.findOne({
      storeId: String(storeId).trim(),
      isDeleted: { $ne: true },
    });

    if (!store) {
      const error = createHttpError(404, "Store not found.");
      return next(error);
    }

    if (!store.restaurantId) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    // Strict multi-tenant query: ONLY menus belonging to this restaurantId
    const menus = await Menu.find({
      restaurantId: store.restaurantId,
      isDeleted: { $ne: true },
      published: true,
    });

    res.status(200).json({
      success: true,
      data: menus,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/public/store/by-domain/:slug
 *
 * The bootstrap endpoint for the hostname-driven customer website. Given a
 * slug (or a full hostname passed as ?host=), returns just enough public
 * metadata for the browser to render the site shell (title, favicon, theme
 * colors, branding) while it fetches the full storefront in parallel.
 *
 * Security:
 * - Uses resolveStorefront(), so a slug pointing at a suspended / closed /
 *   website-disabled store returns 404 with the same friendly message as any
 *   unknown slug. Never leaks the existence of a private store.
 * - Never exposes ownerPhone, employee data, internal ids beyond storeId, or
 *   any private setting.
 */
const getPublicStoreByDomain = async (req, res, next) => {
  try {
    const identifier = String(req.params.slug || "").trim();
    // Optional ?host= parameter lets the client pass the raw browser hostname
    // so the resolver can also match customDomain / subdomain records.
    const host = String(req.query.host || req.headers.host || "").trim();

    if (!identifier && !host) {
      return next(createHttpError(400, "Store identifier is required."));
    }

    const result = await resolveStorefront({ identifier, host });

    if (!result.ok) {
      // Collapse "found but disabled/closed" into a generic 404 to avoid
      // leaking which subdomains are registered.
      const status = result.status === 403 ? 404 : (result.status || 404);
      const error = createHttpError(status, REASON_MESSAGES[result.reason] || "Store not found.");
      return next(error);
    }

    const { settings, store, restaurant } = result;

    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.status(200).json({
      success: true,
      data: {
        // Public identity — safe to expose.
        storeId: settings.storeId,
        slug: settings.slug,
        subdomain: settings.subdomain || "",
        customDomain: settings.customDomain || "",

        // Display / SEO metadata.
        name: settings.displayName || store.storeName || restaurant?.name || "",
        siteTitle: settings.branding?.siteTitle || "",
        siteDescription: settings.branding?.siteDescription || "",
        tagline: settings.branding?.tagline || "",

        // Assets needed to paint the first frame.
        logoUrl: settings.branding?.logo?.url || "",
        faviconUrl: settings.branding?.favicon?.url || "",
        coverImageUrl: settings.branding?.coverImage?.url || "",

        // Just the theme identity + top-level colors — the theme renderer will
        // fetch the full palette from /api/storefront/:slug.
        themeKey: settings.theme?.themeKey || "default-restaurant",
        primaryColor: settings.theme?.colors?.primary || "",
        secondaryColor: settings.theme?.colors?.secondary || "",

        // Ordering summary — lets the shell disable "Order now" CTAs before
        // the full storefront finishes loading.
        websiteEnabled: settings.enabled !== false,
        pickupEnabled: settings.ordering?.pickupEnabled !== false,
        deliveryEnabled: Boolean(settings.ordering?.deliveryEnabled),
        currency: settings.ordering?.currency || restaurant?.currency || "GBP",
        currencySymbol: settings.ordering?.currencySymbol || "£",
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPublicStoreInfo,
  getPublicStoreMenu,
  getPublicStoreByDomain,
};
