const express = require("express");
const {
  addOrder,
  getOrders,
  getOrderById,
  updateOrder,
  getPopularItems,
} = require("../controllers/orderController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();


router.route("/").post(isVerifiedUser, addOrder);
router.route("/").get(isVerifiedUser, getOrders);
// POS redesign: store-specific popular products powered by order history.
// Declared before "/:id" so "popular-items" is never read as an order id.
router.route("/popular-items").get(isVerifiedUser, getPopularItems);
router.route("/:id").get(isVerifiedUser, getOrderById);
router.route("/:id").put(isVerifiedUser, updateOrder);

module.exports = router;
