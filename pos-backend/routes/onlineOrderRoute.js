const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const {
  listOnlineOrders,
  getOnlineOrder,
  updateOnlineOrderStatus,
  listPrepDueOrders,
  listAwaitingOrders,
  startPreparingOrder,
  resolveAddedItems,
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
router.get("/prep-due", isVerifiedUser, listPrepDueOrders);
router.get("/awaiting", isVerifiedUser, listAwaitingOrders);
router.post("/:id/start-preparing", isVerifiedUser, startPreparingOrder);
router.get("/:id", isVerifiedUser, getOnlineOrder);
router.put("/:id/status", isVerifiedUser, updateOnlineOrderStatus);

// Accept or reject the items a diner added to a table already mid-meal.
router.put("/:id/items", isVerifiedUser, resolveAddedItems);

module.exports = router;
