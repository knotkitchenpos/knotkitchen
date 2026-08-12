const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const {
  getReceiptForOrder,
  getReceiptForSession,
  sendEBill,
} = require("../controllers/receiptController");

// Public or protected receipt routes
router.route("/order/:orderId").get(isVerifiedUser, getReceiptForOrder);
router.route("/session/:sessionId").get(isVerifiedUser, getReceiptForSession);
router.route("/send-ebill").post(isVerifiedUser, sendEBill);

module.exports = router;
