const express = require("express");
const router = express.Router();
const { cashfreeWebhook } = require("../controllers/cashfreeWebhookController");

/**
 * Payments.
 *
 * Razorpay is gone. Its /create-order and /verify-payment endpoints were dead
 * code -- nothing in the POS ever called them -- and its webhook was the only
 * other thing here. What remains is Cashfree's webhook, which needs no auth
 * (the provider posts to it) and authenticates itself by signature instead.
 *
 * Payment links are created and captured under /api/payment-link; table
 * payments under /api/qr. Both resolve their gateway through
 * services/paymentGateway.
 */
router.route("/cashfree/webhook").post(cashfreeWebhook);

module.exports = router;
