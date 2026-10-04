const express = require("express");
const router = express.Router();
const createHttpError = require("http-errors");
const config = require("../config/config");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const {
  getConfig,
  listStores,
  getStore,
  getStoreReviews,
  getOrder,
  postReview,
} = require("../controllers/knotEatsController");
const { UNAVAILABLE_MESSAGE } = require("../services/knotEats");

/**
 * PUBLIC Knot Eats routes (eats.<base>) -- no authentication.
 *
 * Every limiter key is prefixed: the limiter's buckets are process-wide, so an
 * unprefixed IP key would share one count with every other public route.
 */
const limiter = (name, windowMs, max, message) =>
  rateLimit({ windowMs, max, keyGenerator: (req) => `eats-${name}:${clientIp(req)}`, message });

const readLimiter = limiter("read", config.storefrontReadRateWindowMs, config.storefrontReadRateMax);
const listLimiter = limiter("list", 60 * 1000, 60);
const verifyLimiter = limiter("verify", 10 * 60 * 1000, 30);
const orderViewLimiter = limiter("order", 60 * 1000, 60);
const reviewLimiter = limiter(
  "review",
  10 * 60 * 1000,
  5,
  "Too many review attempts. Please wait a few minutes and try again.",
);

// The SAME key as the store website's order limiter (routes/storefrontRoute),
// so one diner gets one checkout budget per store across both front doors.
const orderLimiter = rateLimit({
  windowMs: config.storefrontOrderRateWindowMs,
  max: config.storefrontOrderRateMax,
  keyGenerator: (req) => `order:${req.params.slug}:${clientIp(req)}`,
  message: "Too many order attempts. Please wait a moment before trying again.",
});

/**
 * Marks a checkout as Knot Eats. The flag comes from the ROUTE only, never
 * the body, and only a 6-digit storeId gets this far. Whether the store is
 * actually listed is checked inside buildStorefrontOrder, after the tenant
 * is resolved.
 */
const viaKnotEats = (req, res, next) => {
  if (!/^\d{6}$/.test(String(req.params.slug || ""))) {
    return next(Object.assign(createHttpError(404, UNAVAILABLE_MESSAGE), { code: "KNOT_EATS_UNAVAILABLE" }));
  }
  req.knotEats = true;
  next();
};

// Lazy: storefrontController loads the whole order stack.
const storefront = () => require("../controllers/storefrontController");

router.get("/config", readLimiter, getConfig);
router.get("/stores", listLimiter, listStores);
router.get("/stores/:storeId", readLimiter, getStore);
router.get("/stores/:storeId/reviews", readLimiter, getStoreReviews);
// Param MUST be `slug`: the reused website checkout reads req.params.slug.
router.post("/stores/:slug/checkout", orderLimiter, viaKnotEats, (req, res, next) =>
  storefront().startStorefrontCheckout(req, res, next),
);
router.post("/checkout/:token/verify", verifyLimiter, (req, res, next) =>
  storefront().verifyKnotEatsCheckout(req, res, next),
);
router.get("/orders/:token", orderViewLimiter, getOrder);
router.post("/orders/:token/review", reviewLimiter, postReview);

module.exports = router;
module.exports.viaKnotEats = viaKnotEats;
