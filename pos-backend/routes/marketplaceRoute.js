const express = require("express");
const {
  streamNewOrders,
  webhookMarketplaceOrder,
  manualMarketplaceOrder,
  markOrderSeen,
} = require("../controllers/marketplaceController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();

// SSE stream for real-time pop-ups (authenticated dashboard)
router.route("/stream").get(isVerifiedUser, streamNewOrders);

// Webhook for external Swiggy/Zomato bridge services. No user session: the
// bridge proves itself with x-marketplace-secret (MARKETPLACE_WEBHOOK_SECRET).
router.route("/webhook").post(webhookMarketplaceOrder);

// Manual marketplace order entry (authenticated)
router.route("/manual").post(isVerifiedUser, manualMarketplaceOrder);

// Mark order notification as seen
router.route("/:id/seen").put(isVerifiedUser, markOrderSeen);

module.exports = router;