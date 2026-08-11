const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requirePermission } = require("../middlewares/requirePermission");
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

// Public endpoints (customer opens shareable link)
router.route("/:token").get(getPaymentLink);
router.route("/:token/verify").post(verifyAndCaptureLinkPayment);

module.exports = router;