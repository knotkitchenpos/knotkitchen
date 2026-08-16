const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const {
  listOnlineOrders,
  getOnlineOrder,
  updateOnlineOrderStatus,
  getOnlineOrderStats,
} = require("../controllers/onlineOrderController");

/**
 * POS-facing online order routes. Every handler scopes its query to the
 * authenticated user's restaurant, so these are safe without an explicit
 * tenant parameter.
 */

// Declared before "/:id" so "stats" is never parsed as an order id.
router.get("/stats/summary", isVerifiedUser, getOnlineOrderStats);

router.get("/", isVerifiedUser, listOnlineOrders);
router.get("/:id", isVerifiedUser, getOnlineOrder);
router.put("/:id/status", isVerifiedUser, updateOnlineOrderStatus);

module.exports = router;
