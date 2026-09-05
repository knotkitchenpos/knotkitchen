const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { createOrder, verifyPayment, webHookVerification } = require("../controllers/paymentController");
const { cashfreeWebhook } = require("../controllers/cashfreeWebhookController");
 
router.route("/create-order").post(isVerifiedUser , createOrder);
router.route("/verify-payment").post(isVerifiedUser , verifyPayment);
router.route("/webhook-verification").post(webHookVerification);
// Cashfree posts here. Its signature scheme and headers are its own, so it
// gets its own handler rather than another branch inside the Razorpay one.
router.route("/cashfree/webhook").post(cashfreeWebhook);


module.exports = router;