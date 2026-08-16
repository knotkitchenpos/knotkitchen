const express = require("express");
const router = express.Router();
const config = require("../config/config");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const {
  getStorefront,
  getStorefrontMenu,
  getStorefrontProduct,
  createStorefrontOrder,
  trackStorefrontOrder,
} = require("../controllers/storefrontController");

/**
 * PUBLIC storefront routes (§30) — no authentication.
 * Rate limits are deliberately stricter on the write path.
 */

const readLimiter = rateLimit({
  windowMs: config.storefrontReadRateWindowMs,
  max: config.storefrontReadRateMax,
});

// Order limiter is keyed per IP *and* per store so a busy restaurant's
// customers can never exhaust another restaurant's quota.
const orderLimiter = rateLimit({
  windowMs: config.storefrontOrderRateWindowMs,
  max: config.storefrontOrderRateMax,
  keyGenerator: (req) => `order:${req.params.slug}:${clientIp(req)}`,
  message: "Too many order attempts. Please wait a moment before trying again.",
});

router.get("/:slug", readLimiter, getStorefront);
router.get("/:slug/menu", readLimiter, getStorefrontMenu);
router.get("/:slug/products/:id", readLimiter, getStorefrontProduct);
router.post("/:slug/orders", orderLimiter, createStorefrontOrder);
router.get("/:slug/orders/:orderId", readLimiter, trackStorefrontOrder);

module.exports = router;
