const express = require("express");
const {
  addItemsToSession,
  addItemsToExistingSession,
  getSessionById,
  requestBill,
  markPaymentPending,
  getSessionBill,
  recordSessionPayment,
  closeSessionWithoutPayment,
  cancelSessionItem,
  setServiceCharge,
  setDiscount,
  moveSession,
  mergeSessions,
} = require("../controllers/tableSessionController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requireProtectedAction } = require("../middlewares/requirePermission");
const router = express.Router();

router.route("/:id").get(isVerifiedUser, getSessionById);
router.route("/").post(isVerifiedUser, addItemsToSession);
router.route("/:id/items").post(isVerifiedUser, addItemsToExistingSession);
router.route("/:id/request-bill").post(isVerifiedUser, requestBill);
router.route("/:id/payment-pending").post(isVerifiedUser, markPaymentPending);
router.route("/:id/bill").get(isVerifiedUser, getSessionBill);
router.route("/:id/payment").post(isVerifiedUser, recordSessionPayment);
// Closing an unpaid table, voiding a dish and discounting the bill all take
// money off the table: staff need the Security PIN, as for an order void.
router.route("/:id/close").post(isVerifiedUser, requireProtectedAction, closeSessionWithoutPayment);
// The party changes table, or two tables become one tab.
router.route("/:id/move").post(isVerifiedUser, moveSession);
router.route("/:id/merge").post(isVerifiedUser, mergeSessions);
// Pull one dish off a live table order (out of stock, sent back). The
// diner's QR page reads the same session, so it shows there too.
router.route("/:id/items/:itemId/cancel").post(isVerifiedUser, requireProtectedAction, cancelSessionItem);
router.route("/:id/service-charge").post(isVerifiedUser, setServiceCharge);
router.route("/:id/discount").post(isVerifiedUser, requireProtectedAction, setDiscount);

module.exports = router;