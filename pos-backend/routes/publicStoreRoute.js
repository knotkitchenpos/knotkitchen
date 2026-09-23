const express = require("express");
const router = express.Router();
const {
  getPublicStoreInfo,
  getPublicStoreMenu,
  getPublicStoreByDomain,
} = require("../controllers/publicStoreController");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const config = require("../config/config");

/**
 * Public store lookup (§9 of the production spec).
 *
 * These endpoints are consumed by the customer website when it is served from
 * a per-store subdomain (burger-house.knotkitchen.com) and needs to bootstrap
 * itself before it has a `slug` in the URL path. They intentionally overlap in
 * responsibility with /api/storefront/* but return a smaller, cheaper payload
 * — enough for the customer-web bootstrap, then it fetches the full storefront
 * via /api/storefront/:slug.
 *
 * Rate-limited generously to survive the very first-render burst from many
 * concurrent visitors of the same store.
 */
const bootstrapLimiter = rateLimit({
  windowMs: config.storefrontReadRateWindowMs,
  max: config.storefrontReadRateMax,
  keyGenerator: (req) => `by-domain:${req.params.slug || req.params.storeId || clientIp(req)}`,
});

// Legacy 6-digit endpoints (kept for backwards compatibility with QR codes /
// receipts printed with the numeric store id).
router.get("/store/:storeId", bootstrapLimiter, getPublicStoreInfo);
router.get("/store/:storeId/menu", bootstrapLimiter, getPublicStoreMenu);

/**
 * GET /api/public/store/by-domain/:slug
 *
 * Resolves a public-domain identifier (slug OR customDomain OR subdomain host)
 * to the minimal public metadata needed to render the site shell. Returns 404
 * if the store is deleted / suspended / has its website disabled — never leaks
 * the difference between "does not exist" and "not published" (§9).
 */
router.get("/store/by-domain/:slug", bootstrapLimiter, getPublicStoreByDomain);

module.exports = router;
