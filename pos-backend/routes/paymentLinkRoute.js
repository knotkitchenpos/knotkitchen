const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requirePermission } = require("../middlewares/requirePermission");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const {
  createPaymentLink,
  getPaymentLink,
  verifyAndCaptureLinkPayment,
  listPaymentLinks,
  listPaymentTransactions,
} = require("../controllers/paymentLinkController");

// POS endpoints
router.route("/").get(isVerifiedUser, requirePermission("PAYMENT_VIEW"), listPaymentLinks);
router.route("/").post(isVerifiedUser, requirePermission("PAYMENT_CREATE"), createPaymentLink);
router.route("/transactions").get(isVerifiedUser, requirePermission("PAYMENT_VIEW"), listPaymentTransactions);

/**
 * Public endpoints (customer opens shareable link) — unauthenticated, and so
 * rate limited. `/verify` is the sharper of the two: it is the endpoint that
 * settles a payment, and it was reachable without any throttle at all.
 *
 * Both are keyed per link token as well as per IP, so hammering one link
 * cannot lock another customer out of paying theirs.
 */
const linkReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => `paylink:${req.params.token}:${clientIp(req)}`,
});

const linkVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  keyGenerator: (req) => `paylink-verify:${req.params.token}:${clientIp(req)}`,
  message: "Too many payment attempts for this link. Please wait a moment before trying again.",
});

router.route("/:token").get(linkReadLimiter, getPaymentLink);
router.route("/:token/verify").post(linkVerifyLimiter, verifyAndCaptureLinkPayment);

module.exports = router;