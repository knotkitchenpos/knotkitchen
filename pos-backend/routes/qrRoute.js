const express = require("express");
const { isVerifiedUser, resolveTableScope } = require("../middlewares/tokenVerification");
const { requirePermission } = require("../middlewares/requirePermission");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const config = require("../config/config");
const qr = require("../controllers/qrController");
const router = express.Router();

/**
 * Rate limits for the PUBLIC half of this router.
 *
 * Every endpoint below that takes a `:token` is unauthenticated. The token is
 * a table's QR, which anyone who has eaten at that table — or photographed the
 * card stuck to it — keeps indefinitely. None of them were throttled, so a
 * single person could place unlimited orders onto a live table's bill, or hold
 * the waiter alarm on permanently.
 *
 * Reads are keyed per IP and generous: a diner's phone polls the session while
 * they sit there, and throttling that would break the page for a paying
 * customer. Writes are keyed per TABLE as well as per IP, so one table cannot
 * exhaust another's allowance, and switching networks does not reset the count
 * for the table being abused.
 */
const qrReadLimiter = rateLimit({
  windowMs: config.qrReadRateWindowMs,
  max: config.qrReadRateMax,
});

const qrWriteLimiter = rateLimit({
  windowMs: config.qrOrderRateWindowMs,
  max: config.qrOrderRateMax,
  keyGenerator: (req) => `qr:${req.params.token}:${clientIp(req)}`,
  message: "Too many requests for this table. Please wait a moment, or ask a member of staff.",
});

// The waiter call rings until somebody walks over and clears it, so this is
// the tightest limit in the app — and keyed on the TABLE alone, because the
// harm is to the staff, not to the caller.
const qrWaiterLimiter = rateLimit({
  windowMs: config.qrWaiterCallRateWindowMs,
  max: config.qrWaiterCallRateMax,
  keyGenerator: (req) => `qr-waiter:${req.params.token}`,
  message: "Your table has already called for a waiter. Someone is on their way.",
});

router.route("/tables/:tableId/generate").post(isVerifiedUser, requirePermission("TABLE_UPDATE"), qr.generateTableQr);
router.route("/table/:token").get(qrReadLimiter, resolveTableScope, qr.getTableByToken);
router.route("/session/:token").get(qrReadLimiter, resolveTableScope, qr.getSessionByToken);
router.route("/session/items/:token").post(qrWriteLimiter, resolveTableScope, qr.addSessionItems);
router.route("/request-bill/:token").post(qrWriteLimiter, resolveTableScope, qr.requestBill);
router.route("/payment-intent/:token").post(qrWriteLimiter, resolveTableScope, qr.paymentIntent);
router.route("/payment-verify/:token").post(qrWriteLimiter, resolveTableScope, qr.paymentVerify);
router.route("/order/:token").post(qrWriteLimiter, resolveTableScope, qr.placeLegacyOrder);
router.route("/waiter-call/:token").post(qrWaiterLimiter, resolveTableScope, qr.callWaiter);
router.route("/pay-request/:token").post(qrWriteLimiter, resolveTableScope, qr.payRequest);
router.route("/waiter-call/:tableId/dismiss").post(isVerifiedUser, qr.dismissWaiterCall);

module.exports = router;
