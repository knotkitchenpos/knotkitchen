const createHttpError = require("http-errors");
const { AUDIENCES, projectMenus } = require("../services/menuCache");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const Menu = require("../models/menuModel");
const { resolveStorefront, REASON_MESSAGES, findSettingsByHost } = require("../services/storefrontResolver");
const { buildLandingPayload } = require("../services/landingPayload");

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
    // Visibility is decided by the PUBLISHED flags inside projectMenus.
    const menuDocs = await Menu.find({
      restaurantId: store.restaurantId,
      isDeleted: { $ne: true },
    });

    // Anonymous, customer-facing: serves the Website Published snapshot, the
    // same copy the storefront renders. Returning the raw documents here
    // published every unsaved draft edit to anyone who asked.
    res.status(200).json({
      success: true,
      data: projectMenus(menuDocs, AUDIENCES.WEBSITE),
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

    // Short, and deliberately WITHOUT stale-while-revalidate.
    //
    // This response carries the landing page design. `stale-while-revalidate`
    // tells the browser it may serve the old body immediately and refresh in
    // the background, so for a minute after an edit the owner reloads and sees
    // the previous design -- which reads as "it did not switch".
    res.set("Cache-Control", "public, max-age=5");
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

        // The landing page is what this response paints, so it ships here
        // rather than waiting for the full storefront payload.
        landing: buildLandingPayload(settings, restaurant, store),

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

/**
 * GET /api/public/tls-ask?domain=<hostname>
 *
 * Consumed by Caddy's `on_demand_tls { ask ... }` directive so a wildcard
 * cert never has to be issued: Caddy asks this endpoint before requesting a
 * cert for an arbitrary subdomain, and we only say yes for a hostname that
 * resolves to a real, non-deleted store. Intentionally returns bare 200/404
 * with no body — this is a yes/no gate, not a data endpoint, and it must not
 * leak *why* a hostname was rejected (suspended vs. never existed).
 */
const tlsAsk = async (req, res) => {
  const domain = String(req.query.domain || "").trim();
  if (!domain) return res.sendStatus(400);

  const settings = await findSettingsByHost(domain);
  return res.sendStatus(settings ? 200 : 404);
};

module.exports = {
  getPublicStoreInfo,
  getPublicStoreMenu,
  getPublicStoreByDomain,
  tlsAsk,
};
