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

module.exports = router;