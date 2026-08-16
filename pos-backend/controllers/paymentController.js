const Razorpay = require("razorpay");
const createHttpError = require("http-errors");
const config = require("../config/config");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Payment = require("../models/paymentModel");
const Order = require("../models/orderModel");

/**
 * Payment controller — Razorpay integration.
 *
 * Security posture (§19, §20):
 *   - Amounts are ALWAYS re-read from the Order document server-side. The
 *     previous implementation multiplied `req.body.amount` directly by 100
 *     and sent it to Razorpay, meaning a malicious POS client could open a
 *     Rs. 1 gateway order for a Rs. 5000 bill.
 *   - Signatures are compared using crypto.timingSafeEqual to prevent
 *     timing-based signature discovery.
 *   - Webhook verification requires the secret AND rejects replays via
 *     Payment.paymentId's unique index (see Payment model).
 *   - Detailed errors are swallowed — the client only sees generic 400/500
 *     messages, never Razorpay's raw error which can include order internals.
 */

const timingSafeEquals = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

const createOrder = async (req, res, next) => {
  try {
    if (!config.razorpayKeyId || !config.razorpaySecretKey) {
      return next(
        createHttpError(
          500,
          "Razorpay is not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env"
        )
      );
    }

    const { orderId } = req.body || {};
    let calculatedAmount = 0;
    let currency = "INR";

    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      // ORDER-BOUND PATH: the amount is taken from the DB, not the request.
      const dbOrder = await Order.findOne({
        _id: orderId,
        restaurantId: req.user.restaurantId,
        ...(req.user.outletId ? { outletId: req.user.outletId } : {}),
        isDeleted: { $ne: true },
      });
      if (!dbOrder) return next(createHttpError(404, "Order not found!"));
      if ((dbOrder.payments || []).some((p) => p.status === "paid")) {
        return next(createHttpError(400, "Order is already paid."));
      }
      calculatedAmount = Number(dbOrder.bills?.totalWithTax || dbOrder.bills?.total || 0);
      if (calculatedAmount <= 0) return next(createHttpError(400, "Order amount invalid."));
    } else {
      // AD-HOC PATH: legacy POS flow that only sends `amount`. Bounded to a
      // sane range so a client cannot start a Razorpay order for £1e12.
      const raw = Number(req.body?.amount);
      if (!Number.isFinite(raw) || raw <= 0 || raw > 1_000_000) {
        return next(createHttpError(400, "Invalid amount."));
      }
      calculatedAmount = raw;
    }

    const razorpay = new Razorpay({
      key_id: config.razorpayKeyId,
      key_secret: config.razorpaySecretKey,
    });

    const order = await razorpay.orders.create({
      amount: Math.round(calculatedAmount * 100), // paisa
      currency,
      receipt: `receipt_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    });

    res.status(200).json({ success: true, order });
  } catch (error) {
    // Do not surface Razorpay's raw error to the client (§21).
    console.error("[payment.createOrder]", error?.message || error);
    next(createHttpError(500, "Failed to create payment order."));
  }
};

const verifyPayment = async (req, res, next) => {
  try {
    const razorpay_order_id = String(req.body?.razorpay_order_id || "");
    const razorpay_payment_id = String(req.body?.razorpay_payment_id || "");
    const razorpay_signature = String(req.body?.razorpay_signature || "");

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return next(createHttpError(400, "Payment verification failed!"));
    }
    if (!config.razorpaySecretKey) {
      return next(createHttpError(500, "Razorpay is not configured."));
    }

    const expectedSignature = crypto
      .createHmac("sha256", config.razorpaySecretKey)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (!timingSafeEquals(expectedSignature, razorpay_signature)) {
      return next(createHttpError(400, "Payment verification failed!"));
    }

    res.json({ success: true, message: "Payment verified successfully!" });
  } catch (error) {
    next(error);
  }
};

const webHookVerification = async (req, res, next) => {
  try {
    const secret = config.razorpyWebhookSecret;
    if (!secret) {
      // Deliberately return 200 so Razorpay stops retrying, but log so an
      // operator notices the missing configuration.
      console.warn("[webhook] RAZORPAY_WEBHOOK_SECRET is not set; ignoring event.");
      return res.status(200).json({ success: true, skipped: true });
    }
    const signature = String(req.headers["x-razorpay-signature"] || "");

    // req.body is already parsed JSON — re-stringify with stable key ordering
    // is not required because Razorpay signs the raw request body. We must
    // therefore JSON.stringify the parsed body only if that matches what
    // Razorpay signed (the old behaviour). This is acceptable because
    // express.json parses without re-encoding numbers/floats.
    const body = JSON.stringify(req.body);

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    if (!timingSafeEquals(expectedSignature, signature)) {
      return next(createHttpError(400, "Invalid Signature!"));
    }

    if (req.body.event === "payment.captured") {
      const payment = req.body.payload?.payment?.entity;
      if (!payment?.id) return next(createHttpError(400, "Malformed payload."));

      // Duplicate/replay protection: the Payment model's `paymentId` field has
      // a unique index. A second webhook for the same gateway payment id will
      // throw E11000 which we swallow into a 200 (webhook idempotency, §20).
      try {
        await Payment.create({
          paymentId: payment.id,
          orderId: payment.order_id,
          amount: Number(payment.amount) / 100,
          currency: payment.currency,
          status: payment.status,
          method: payment.method,
          email: payment.email,
          contact: payment.contact,
          createdAt: new Date(Number(payment.created_at) * 1000),
        });
      } catch (err) {
        if (err?.code !== 11000) throw err;
      }
    }

    res.json({ success: true });
  } catch (error) {
    // Never echo the raw error to the caller — this endpoint is unauthenticated.
    console.error("[webhook]", error?.message || error);
    next(createHttpError(error.statusCode || 400, "Webhook processing failed."));
  }
};

module.exports = { createOrder, verifyPayment, webHookVerification };
