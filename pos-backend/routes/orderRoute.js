const express = require("express");
const {
  addOrder,
  getOrders,
  getOrderById,
  updateOrder,
  markOrderReady,
  getPopularItems,
  getOrdersReport,
} = require("../controllers/orderController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();


router.route("/").post(isVerifiedUser, addOrder);
router.route("/").get(isVerifiedUser, getOrders);
// POS redesign: store-specific popular products powered by order history.
// Declared before "/:id" so "popular-items" is never read as an order id.
router.route("/popular-items").get(isVerifiedUser, getPopularItems);
// Module 5 — dedicated reports payload with pre-computed category buckets
// (System / Website / Outside / Paid / Unpaid / Delivery / Collection /
// Table / Pay-by-Link). Declared before "/:id" so "report" is never
// interpreted as an order id.
router.route("/report").get(isVerifiedUser, getOrdersReport);
router.route("/:id").get(isVerifiedUser, getOrderById);
router.route("/:id").put(isVerifiedUser, updateOrder);
// Module 4 §2 — dedicated "mark ready" action. Declared as a sub-path
// (:id/ready) so the existing PUT /:id endpoint keeps its generic
// status-update behaviour for KDS / Cancel flows.
router.route("/:id/ready").put(isVerifiedUser, markOrderReady);

module.exports = router;
