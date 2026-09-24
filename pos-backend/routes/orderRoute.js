const express = require("express");
const {
  addOrder,
  getOrders,
  getOrderById,
  updateOrder,
  markOrderReady,
  cancelOrder,
  refundOrder,
  syncOrderRefund,
  getPopularItems,
  getOrdersReport,
} = require("../controllers/orderController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requireProtectedAction, requireManager, requireOwnerOnly } = require("../middlewares/requirePermission");
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
router.route("/report").get(isVerifiedUser, requireProtectedAction, getOrdersReport);
router.route("/:id").get(isVerifiedUser, getOrderById);
router.route("/:id").put(isVerifiedUser, updateOrder);
// Module 4 §2 — dedicated "mark ready" action. Declared as a sub-path
// (:id/ready) so the existing PUT /:id endpoint keeps its generic
// status-update behaviour for KDS / Cancel flows.
router.route("/:id/ready").put(isVerifiedUser, markOrderReady);
// A void needs a reason and, for staff, the Security PIN. A refund moves
// money (through Cashfree when the order was paid online) and is for the
// store owner or a manager only: no PIN lets other staff do it. The generic PUT /:id can
// still cancel (KDS / reject flows) but records no money movement.
router.route("/:id/cancel").put(isVerifiedUser, requireProtectedAction, cancelOrder);
router.route("/:id/refund").post(isVerifiedUser, requireOwnerOnly, refundOrder);
router.route("/:id/refund/sync").post(isVerifiedUser, requireManager, syncOrderRefund);

module.exports = router;
