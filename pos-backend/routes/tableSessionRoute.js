const express = require("express");
const {
  addItemsToSession,
  addItemsToExistingSession,
  getSessions,
  getSessionById,
  requestBill,
  markPaymentPending,
  getSessionBill,
  recordSessionPayment,
  closeSessionWithoutPayment,
  cancelSessionItem,
  setServiceCharge,
  moveSession,
  mergeSessions,
} = require("../controllers/tableSessionController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();

router.route("/").get(isVerifiedUser, getSessions);
router.route("/:id").get(isVerifiedUser, getSessionById);
router.route("/").post(isVerifiedUser, addItemsToSession);
router.route("/:id/items").post(isVerifiedUser, addItemsToExistingSession);
router.route("/:id/request-bill").post(isVerifiedUser, requestBill);
router.route("/:id/payment-pending").post(isVerifiedUser, markPaymentPending);
router.route("/:id/bill").get(isVerifiedUser, getSessionBill);
router.route("/:id/payment").post(isVerifiedUser, recordSessionPayment);
router.route("/:id/close").post(isVerifiedUser, closeSessionWithoutPayment);
// The party changes table, or two tables become one tab.
router.route("/:id/move").post(isVerifiedUser, moveSession);
router.route("/:id/merge").post(isVerifiedUser, mergeSessions);
// Pull one dish off a live table order (out of stock, sent back). The
// diner's QR page reads the same session, so it shows there too.
router.route("/:id/items/:itemId/cancel").post(isVerifiedUser, cancelSessionItem);
router.route("/:id/service-charge").post(isVerifiedUser, setServiceCharge);

module.exports = router;