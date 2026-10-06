const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const {
  listOnlineOrders,
  updateOnlineOrderStatus,
  listPrepDueOrders,
  listAwaitingOrders,
  listPendingAdditions,
  startPreparingOrder,
  resolveAddedItems,
} = require("../controllers/onlineOrderController");

/**
 * POS-facing online order routes. Every handler scopes its query to the
 * authenticated user's restaurant, so these are safe without an explicit
 * tenant parameter.
 */

router.get("/", isVerifiedUser, listOnlineOrders);
router.get("/prep-due", isVerifiedUser, listPrepDueOrders);
router.get("/awaiting", isVerifiedUser, listAwaitingOrders);
// Diner additions nobody has reviewed yet: the Added Items card catches up from it.
router.get("/added-items", isVerifiedUser, listPendingAdditions);
router.post("/:id/start-preparing", isVerifiedUser, startPreparingOrder);
router.put("/:id/status", isVerifiedUser, updateOnlineOrderStatus);

// Accept or reject the items a diner added to a table already mid-meal.
router.put("/:id/items", isVerifiedUser, resolveAddedItems);

module.exports = router;
