const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { sendEBill } = require("../controllers/receiptController");

router.route("/send-ebill").post(isVerifiedUser, sendEBill);

module.exports = router;
