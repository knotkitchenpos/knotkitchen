const express = require("express");
const {
  createKDSOrder, getKDSOrders, updateItemStatus,
  updateKDSStatus, getKDSAnalytics,
} = require("../controllers/kdsController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();

router.route("/").post(isVerifiedUser, createKDSOrder);
router.route("/").get(isVerifiedUser, getKDSOrders);
router.route("/analytics").get(isVerifiedUser, getKDSAnalytics);
router.route("/:kdsOrderId/status").patch(isVerifiedUser, updateKDSStatus);
router.route("/:kdsOrderId/items/:itemId").patch(isVerifiedUser, updateItemStatus);

module.exports = router;